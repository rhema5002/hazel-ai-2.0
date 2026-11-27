import 'dotenv/config';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import { createServer as createHttpServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  FinishReason,
  GoogleGenAI,
  Modality,
  ThinkingLevel,
  Type,
  type Content,
  type FunctionDeclaration,
  type LiveServerMessage,
  type Part,
} from '@google/genai';
import { registerAdminRoutes } from './server/adminRoutes.ts';
import {
  consumeGuestWsTicket,
  getWorkspacePolicy,
  hydrateAdminStateFromSupabase,
  recordAuditEvent,
} from './server/adminStore.ts';
import {
  isSupabaseConfigured,
  registerSupabaseAuthRoutes,
  resolveLiveSessionContext,
  resolveRequestAuthContext,
} from './server/supabaseAuth.ts';
import {
  forgetMemoryForContext,
  formatMemoriesPromptBlock,
  loadMemoriesForContext,
  registerSupabaseSyncRoutes,
  sanitizeMemories,
  saveMemoryForContext,
  type SyncedMemoryItem,
} from './server/supabaseSync.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function getGenAIClient(apiVersion?: string): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function unwrapJsonErrorMessage(input: string): { code?: number; message: string } {
  let current = input.trim();
  let foundCode: number | undefined;
  for (let depth = 0; depth < 3; depth++) {
    if (!current.startsWith('{')) break;
    try {
      const parsed = JSON.parse(current) as {
        error?: { code?: number; message?: string };
        code?: number;
        message?: string;
      };
      if (typeof parsed?.error?.code === 'number') foundCode = parsed.error.code;
      else if (typeof parsed?.code === 'number') foundCode = parsed.code;

      const nextMsg =
        typeof parsed?.error?.message === 'string'
          ? parsed.error.message.trim()
          : typeof parsed?.message === 'string'
            ? parsed.message.trim()
            : '';
      if (!nextMsg) break;
      current = nextMsg;
    } catch {
      break;
    }
  }
  return { code: foundCode, message: current };
}

function extractGeminiError(
  err: unknown,
  fallbackMessage: string
): { status: number; message: string } {
  const rawStatus =
    typeof (err as { status?: unknown })?.status === 'number'
      ? (err as { status: number }).status
      : 502;
  const rawMessage = err instanceof Error ? err.message.trim() : '';

  const unwrapped = unwrapJsonErrorMessage(rawMessage);
  const resolvedCode = unwrapped.code ?? rawStatus;
  const status = resolvedCode >= 400 && resolvedCode < 600 ? resolvedCode : 502;
  const message = friendlyErrorMessage(
    status,
    unwrapped.message || fallbackMessage
  );

  return { status, message };
}

function isTransientOverloadError(status: number, rawMessage: string): boolean {
  if (status === 503 || status === 502 || status === 504 || status === 500 || status === 429) {
    return true;
  }
  const lower = rawMessage.toLowerCase();
  return (
    lower.includes('high demand') ||
    lower.includes('overloaded') ||
    lower.includes('unavailable') ||
    lower.includes('temporarily') ||
    lower.includes('try again later') ||
    lower.includes('capacity') ||
    lower.includes('deadline exceeded') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('fetch failed')
  );
}

function friendlyErrorMessage(status: number, rawMessage: string): string {
  const lower = rawMessage.toLowerCase();
  if (
    status === 401 ||
    status === 403 ||
    lower.includes('api key') ||
    lower.includes('api_key_invalid') ||
    lower.includes('permission')
  ) {
    return 'Unable to authenticate with the language service. Check the server API key configuration.';
  }
  if (
    status === 503 ||
    lower.includes('high demand') ||
    lower.includes('overloaded') ||
    lower.includes('unavailable')
  ) {
    return 'The AI service is temporarily experiencing high demand. Please tap Try again in a moment.';
  }
  if (status === 429 || lower.includes('quota') || lower.includes('rate limit')) {
    return 'Rate limit or quota exceeded right now. Please wait a moment and try again.';
  }
  return rawMessage;
}

async function generateContentWithRetry(
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI['models']['generateContent']>[0]
) {
  const alternateModel =
    params.model === 'gemini-3.1-flash-lite'
      ? 'gemini-4-hydrogen'
      : 'gemini-3.1-flash-lite';
  const attempts: Array<{ model: string; delayMs: number }> = [
    { model: params.model, delayMs: 0 },
    { model: alternateModel, delayMs: 900 },
    { model: params.model, delayMs: 2000 },
  ];

  let lastErr: unknown;
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    if (attempt.delayMs > 0) {
      await new Promise((r) => setTimeout(r, attempt.delayMs));
    }
    try {
      const nextConfig =
        params.config &&
        attempt.model !== 'gemini-3.1-flash-lite' &&
        params.config.thinkingConfig?.thinkingLevel === ThinkingLevel.MINIMAL
          ? {
              ...params.config,
              thinkingConfig: {
                ...params.config.thinkingConfig,
                thinkingLevel: ThinkingLevel.LOW,
              },
            }
          : params.config;
      return await ai.models.generateContent({
        ...params,
        ...(nextConfig ? { config: nextConfig } : {}),
        model: attempt.model,
      });
    } catch (err) {
      lastErr = err;
      const rawMessage = err instanceof Error ? err.message : '';
      const rawStatus =
        typeof (err as { status?: unknown })?.status === 'number'
          ? (err as { status: number }).status
          : 502;
      const unwrapped = unwrapJsonErrorMessage(rawMessage);
      const code = unwrapped.code ?? rawStatus;
      if (code === 429 && i >= 1) {
        throw err;
      }
      if (!isTransientOverloadError(code, unwrapped.message || rawMessage)) {
        throw err;
      }
    }
  }
  throw lastErr;
}

interface IncomingAttachment {
  name: string;
  mimeType: string;
  kind: 'image' | 'pdf' | 'text';
  base64Data?: string;
  textContent?: string;
}

interface IncomingTurn {
  role: 'user' | 'assistant';
  text: string;
  attachments?: IncomingAttachment[];
}

const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const MAX_ATTACHMENT_COUNT = 12;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT_CHARS = 250_000;
const MAX_TURN_TEXT_CHARS = 500_000;
const MAX_HISTORY_TURNS = 500;
const MAX_TOTAL_HISTORY_CHARS = 1_200_000;
const MAX_STREAM_CONTINUATIONS = 24;
const CONTINUATION_CONTEXT_CHARS = 600_000;

function sanitizeFilename(rawName: unknown, fallback: string): string {
  if (typeof rawName !== 'string') return fallback;
  const cleaned = rawName
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

function validateAttachments(
  raw: unknown
): { ok: true; items: IncomingAttachment[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, items: [] };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'Attachments must be an array.' };
  }
  if (raw.length > MAX_ATTACHMENT_COUNT) {
    return {
      ok: false,
      error: `At most ${MAX_ATTACHMENT_COUNT} attachments are allowed per message.`,
    };
  }

  const items: IncomingAttachment[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!entry || typeof entry !== 'object') {
      return { ok: false, error: 'Each attachment must be an object.' };
    }
    const rec = entry as Record<string, unknown>;
    const kind = rec.kind;
    const rawMime =
      typeof rec.mimeType === 'string' ? rec.mimeType.trim().toLowerCase() : '';
    const name = sanitizeFilename(rec.name, `attachment-${i + 1}`);

    if (kind === 'image') {
      if (!ALLOWED_IMAGE_MIMES.has(rawMime)) {
        return {
          ok: false,
          error: `Unsupported image type "${rawMime || 'unknown'}" for "${name}".`,
        };
      }
      if (typeof rec.base64Data !== 'string' || rec.base64Data.length === 0) {
        return { ok: false, error: `Missing image payload for "${name}".` };
      }
      if (!/^[A-Za-z0-9+/=]+$/.test(rec.base64Data)) {
        return { ok: false, error: `Invalid base64 image data for "${name}".` };
      }
      const byteLength = Buffer.from(rec.base64Data, 'base64').byteLength;
      if (byteLength === 0 || byteLength > MAX_ATTACHMENT_BYTES) {
        return {
          ok: false,
          error: `Image "${name}" exceeds the 8 MB maximum size.`,
        };
      }
      items.push({
        name,
        mimeType: rawMime,
        kind: 'image',
        base64Data: rec.base64Data,
      });
    } else if (kind === 'pdf') {
      if (rawMime !== 'application/pdf') {
        return { ok: false, error: `Invalid PDF type for "${name}".` };
      }
      if (typeof rec.base64Data !== 'string' || rec.base64Data.length === 0) {
        return { ok: false, error: `Missing PDF payload for "${name}".` };
      }
      if (!/^[A-Za-z0-9+/=]+$/.test(rec.base64Data)) {
        return { ok: false, error: `Invalid base64 PDF data for "${name}".` };
      }
      const byteLength = Buffer.from(rec.base64Data, 'base64').byteLength;
      if (byteLength === 0 || byteLength > MAX_ATTACHMENT_BYTES) {
        return {
          ok: false,
          error: `PDF "${name}" exceeds the 8 MB maximum size.`,
        };
      }
      items.push({
        name,
        mimeType: 'application/pdf',
        kind: 'pdf',
        base64Data: rec.base64Data,
      });
    } else if (kind === 'text') {
      if (
        rawMime &&
        !rawMime.startsWith('text/') &&
        rawMime !== 'application/json' &&
        rawMime !== 'application/xml' &&
        rawMime !== 'application/javascript' &&
        rawMime !== 'application/typescript'
      ) {
        return {
          ok: false,
          error: `Unsupported text type "${rawMime}" for "${name}".`,
        };
      }
      if (typeof rec.textContent !== 'string') {
        return { ok: false, error: `Missing text content for "${name}".` };
      }
      items.push({
        name,
        mimeType: rawMime || 'text/plain',
        kind: 'text',
        textContent: rec.textContent.slice(0, MAX_TEXT_ATTACHMENT_CHARS),
      });
    } else {
      return { ok: false, error: `Unsupported attachment kind for "${name}".` };
    }
  }

  return { ok: true, items };
}

function validateTurns(
  rawMessages: unknown
): { ok: true; turns: IncomingTurn[] } | { ok: false; error: string } {
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return { ok: false, error: 'At least one message is required.' };
  }

  const sliced = rawMessages.slice(-MAX_HISTORY_TURNS);
  const parsedReversed: IncomingTurn[] = [];
  let totalHistoryChars = 0;

  for (let idx = sliced.length - 1; idx >= 0; idx--) {
    const item = sliced[idx];
    if (!item || typeof item !== 'object') {
      return { ok: false, error: 'Invalid message entry.' };
    }
    const rec = item as Record<string, unknown>;
    const role = rec.role === 'assistant' ? 'assistant' : rec.role === 'user' ? 'user' : null;
    if (!role) {
      return { ok: false, error: 'Each message must have role "user" or "assistant".' };
    }
    const text =
      typeof rec.text === 'string' ? rec.text.trim().slice(0, MAX_TURN_TEXT_CHARS) : '';
    const attachCheck = validateAttachments(rec.attachments);
    if (!attachCheck.ok) {
      return attachCheck;
    }

    if (!text && attachCheck.items.length === 0) {
      continue;
    }

    const turnCharCost =
      text.length +
      attachCheck.items.reduce(
        (sum, att) => sum + (att.textContent ? att.textContent.length : 0),
        0
      );

    if (
      parsedReversed.length > 0 &&
      totalHistoryChars + turnCharCost > MAX_TOTAL_HISTORY_CHARS
    ) {
      break;
    }

    totalHistoryChars += turnCharCost;
    parsedReversed.push({
      role,
      text,
      attachments: attachCheck.items,
    });
  }

  const turns = parsedReversed.reverse();
  if (turns.length === 0 || turns[turns.length - 1].role !== 'user') {
    return { ok: false, error: 'The latest message must be a non-empty user turn.' };
  }

  return { ok: true, turns };
}

function buildModelContents(turns: IncomingTurn[]): Content[] {
  const contents: Content[] = [];
  // Keep full binary payloads for the most recent 2 user turns; summarize older attachments cleanly
  const latestUserIndex = turns.length - 1;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const parts: Part[] = [];
    const includeBinary = i >= latestUserIndex - 2;

    if (turn.attachments && turn.attachments.length > 0) {
      for (const att of turn.attachments) {
        if (att.kind === 'text' && typeof att.textContent === 'string') {
          parts.push({
            text: `Attached file "${att.name}" (${att.mimeType}):\n\`\`\`\n${att.textContent}\n\`\`\``,
          });
        } else if ((att.kind === 'image' || att.kind === 'pdf') && att.base64Data && includeBinary) {
          parts.push({ text: `Attached ${att.kind === 'pdf' ? 'PDF' : 'image'}: "${att.name}"` });
          parts.push({
            inlineData: {
              mimeType: att.mimeType,
              data: att.base64Data,
            },
          });
        } else {
          parts.push({ text: `[Previously attached ${att.kind}: "${att.name}"]` });
        }
      }
    }

    if (turn.text) {
      parts.push({ text: turn.text });
    }

    const role = turn.role === 'assistant' ? 'model' : 'user';
    if (parts.length === 0) continue;

    const prev = contents[contents.length - 1];
    if (prev && prev.role === role && prev.parts) {
      prev.parts.push(...parts);
    } else {
      contents.push({
        role,
        parts,
      });
    }
  }

  return contents;
}

function isSafeHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function writeSseEvent(res: Response, event: string, data: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function makeWidgetId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const VALID_CHORDS = new Set([
  'C', 'Cm', 'Cmaj7', 'D', 'Dm', 'Dm7', 'E', 'Em', 'Em7',
  'F', 'Fm', 'Fmaj7', 'G', 'Gm', 'G7', 'A', 'Am', 'Am7', 'Bb', 'Bm',
]);
const VALID_DRUM_STYLES = new Set(['lofi', 'pop', 'synthwave', 'ambient', 'rock']);
const VALID_VIDEO_ARCHETYPES = new Set([
  'cosmic-nebula',
  'cyber-rain',
  'ocean-waves',
  'mountain-sunrise',
  'botanical-breeze',
  'geometric-pulse',
]);

const setTimerTool: FunctionDeclaration = {
  name: 'set_timer',
  description:
    'Starts a visual countdown timer widget for the user. Use whenever the user asks to set a timer, alarm, or countdown.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      durationSeconds: {
        type: Type.INTEGER,
        description: 'Duration in seconds (between 1 and 86400). Convert minutes/hours to seconds.',
      },
      label: {
        type: Type.STRING,
        description: 'Short label describing the timer (e.g., "Pasta Timer", "Workout", "10m Timer").',
      },
    },
    required: ['durationSeconds', 'label'],
  },
};

const setReminderTool: FunctionDeclaration = {
  name: 'set_reminder',
  description:
    'Schedules a time-based reminder that triggers an on-screen alert and browser notification when the timer expires. Use whenever the user asks to be reminded in X minutes/seconds/hours OR at a specific clock time.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      label: {
        type: Type.STRING,
        description: 'Short clear reminder title (e.g., "Check the oven", "Call Sarah", "Take a break").',
      },
      durationSeconds: {
        type: Type.INTEGER,
        description:
          'Seconds from now until the reminder triggers (between 1 and 86400). Provide this when a relative duration is requested.',
      },
      timeOfDay: {
        type: Type.STRING,
        description:
          'Optional local clock time such as "3:30 PM", "18:45", "7:00 AM", "noon", or "midnight" when the user specifies an exact clock time.',
      },
    },
    required: ['label'],
  },
};

function resolveReminderArgs(
  args: Record<string, unknown>,
  tzOffsetMinutes: number,
  isReminderDefault: boolean
): {
  durationSeconds: number;
  targetTime: number;
  label: string;
  isReminder: boolean;
} {
  const nowMs = Date.now();
  const safeOffset = Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes : 0;
  let durationSeconds = 60;
  let resolvedFromClock = false;

  const rawTime = typeof args.timeOfDay === 'string' ? args.timeOfDay.trim().toLowerCase() : '';
  if (rawTime) {
    let hour24 = -1;
    let minute = 0;
    if (rawTime === 'noon') {
      hour24 = 12;
    } else if (rawTime === 'midnight') {
      hour24 = 0;
    } else {
      const m = /^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i.exec(rawTime.replace(/\s+/g, ' '));
      if (m) {
        const h = Number.parseInt(m[1], 10);
        const min = m[2] ? Number.parseInt(m[2], 10) : 0;
        const mer = m[3]?.replace(/\./g, '').toLowerCase();
        if (Number.isFinite(h) && Number.isFinite(min) && min >= 0 && min <= 59) {
          if (mer === 'am' || mer === 'pm') {
            if (h >= 1 && h <= 12) {
              hour24 = (h % 12) + (mer === 'pm' ? 12 : 0);
              minute = min;
            }
          } else if (h >= 0 && h <= 23) {
            hour24 = h;
            minute = min;
          }
        }
      }
    }

    if (hour24 >= 0 && hour24 <= 23) {
      // JS Date#getTimezoneOffset() returns (UTC - local) in minutes, so localMs = utcMs - tzOffset * 60000
      const localNow = new Date(nowMs - safeOffset * 60_000);
      const localTarget = new Date(localNow.getTime());
      localTarget.setUTCHours(hour24, minute, 0, 0);
      if (localTarget.getTime() <= localNow.getTime() + 1000) {
        localTarget.setUTCDate(localTarget.getUTCDate() + 1);
      }
      const diffSec = Math.round((localTarget.getTime() - localNow.getTime()) / 1000);
      durationSeconds = Math.max(1, Math.min(86400, diffSec));
      resolvedFromClock = true;
    }
  }

  if (!resolvedFromClock) {
    const rawSec =
      typeof args.durationSeconds === 'number'
        ? args.durationSeconds
        : Number(args.durationSeconds);
    durationSeconds = Number.isFinite(rawSec)
      ? Math.max(1, Math.min(86400, Math.round(rawSec)))
      : 60;
  }

  const label =
    typeof args.label === 'string' && args.label.trim()
      ? args.label.trim().slice(0, 60)
      : isReminderDefault
        ? 'Reminder'
        : 'Timer';

  return {
    durationSeconds,
    targetTime: nowMs + durationSeconds * 1000,
    label,
    isReminder: isReminderDefault,
  };
}

const createSongTool: FunctionDeclaration = {
  name: 'create_song',
  description:
    'Composes and plays an original musical track with chord progression, bassline, melody, BPM, and lyrics when the user asks to create, write, or generate a song or music.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      prompt: {
        type: Type.STRING,
        description: 'Description of the requested song, genre, mood, topic, or style.',
      },
    },
    required: ['prompt'],
  },
};

const createImageTool: FunctionDeclaration = {
  name: 'create_image',
  description:
    'Generates an original layered vector illustration (downloadable as PNG or SVG) when the user asks to create, draw, or generate an image, picture, illustration, or artwork.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      prompt: {
        type: Type.STRING,
        description: 'Visual description of what to illustrate.',
      },
      style: {
        type: Type.STRING,
        description: 'Artistic style (e.g., "flat vector", "anime", "isometric", "watercolor-inspired", "cyberpunk").',
      },
    },
    required: ['prompt'],
  },
};

const createVideoTool: FunctionDeclaration = {
  name: 'create_video',
  description:
    'Creates a looping animated motion scene video clip (exportable as WebM) with timed captions and color palette when the user asks to create or generate a video, animation, or motion clip.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      prompt: {
        type: Type.STRING,
        description: 'Description of the animated scene or video concept.',
      },
    },
    required: ['prompt'],
  },
};

const saveMemoryTool: FunctionDeclaration = {
  name: 'save_memory',
  description:
    'Saves an important fact, preference, name, goal, project detail, or instruction to Hazel’s persistent long-term memory so she remembers it across future conversations. Call this whenever the user asks you to remember, save, or keep something in mind, or shares a lasting personal preference/fact they want remembered.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      content: {
        type: Type.STRING,
        description:
          'Concise, clear statement of what to remember (e.g., "User prefers oat milk lattes", "User’s dog is named Milo", "User is building a SaaS app in TypeScript").',
      },
      category: {
        type: Type.STRING,
        description:
          'Category: one of "preference", "fact", "project", "goal", "person", or "general".',
      },
    },
    required: ['content'],
  },
};

const forgetMemoryTool: FunctionDeclaration = {
  name: 'forget_memory',
  description:
    'Removes matching saved memories from Hazel’s persistent long-term memory when the user asks her to forget, delete, or remove something she previously remembered.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description:
          'Keywords or description of the memory to remove (e.g., "dog name", "coffee preference", "Milo").',
      },
    },
    required: ['query'],
  },
};

async function composeSongWithGemini(ai: GoogleGenAI, prompt: string) {
  const response = await generateContentWithRetry(ai, {
    model: 'gemini-3.1-flash-lite',
    contents: `Compose an original musical arrangement & lyrics for: "${prompt}". Choose chords ONLY from: C, Cm, Cmaj7, D, Dm, Dm7, E, Em, Em7, F, Fm, Fmaj7, G, Gm, G7, A, Am, Am7, Bb, Bm. Pick 4 chords, 8-16 MIDI melody notes (60-84), and 4 MIDI bass notes (36-52) in the same key.`,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          genre: { type: Type.STRING },
          mood: { type: Type.STRING },
          key: { type: Type.STRING },
          bpm: { type: Type.INTEGER },
          chords: { type: Type.ARRAY, items: { type: Type.STRING } },
          melodyNotes: { type: Type.ARRAY, items: { type: Type.INTEGER } },
          bassNotes: { type: Type.ARRAY, items: { type: Type.INTEGER } },
          drumStyle: { type: Type.STRING },
          lyrics: { type: Type.STRING },
        },
        required: [
          'title',
          'genre',
          'mood',
          'key',
          'bpm',
          'chords',
          'melodyNotes',
          'bassNotes',
          'drumStyle',
          'lyrics',
        ],
      },
    },
  });

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(response.text || '{}') as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  const rawChords = Array.isArray(parsed.chords)
    ? parsed.chords.filter((c): c is string => typeof c === 'string' && VALID_CHORDS.has(c))
    : [];
  const rawMelody = Array.isArray(parsed.melodyNotes)
    ? parsed.melodyNotes
        .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
        .map((n) => Math.max(55, Math.min(88, Math.round(n))))
    : [];
  const rawBass = Array.isArray(parsed.bassNotes)
    ? parsed.bassNotes
        .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
        .map((n) => Math.max(33, Math.min(55, Math.round(n))))
    : [];
  const drumStyle =
    typeof parsed.drumStyle === 'string' && VALID_DRUM_STYLES.has(parsed.drumStyle)
      ? (parsed.drumStyle as 'lofi' | 'pop' | 'synthwave' | 'ambient' | 'rock')
      : 'lofi';

  const bpmRaw = typeof parsed.bpm === 'number' ? parsed.bpm : 96;
  return {
    kind: 'song' as const,
    id: makeWidgetId('song'),
    title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : 'Hazel Original',
    genre: typeof parsed.genre === 'string' && parsed.genre.trim() ? parsed.genre.trim() : 'Electronic',
    mood: typeof parsed.mood === 'string' && parsed.mood.trim() ? parsed.mood.trim() : 'Warm',
    key: typeof parsed.key === 'string' && parsed.key.trim() ? parsed.key.trim() : 'Am',
    bpm: Math.max(60, Math.min(160, Math.round(bpmRaw))),
    chords: rawChords.length > 0 ? rawChords.slice(0, 8) : ['Am7', 'Fmaj7', 'C', 'G'],
    melodyNotes: rawMelody.length >= 4 ? rawMelody.slice(0, 16) : [69, 72, 76, 74, 72, 71, 69, 67],
    bassNotes: rawBass.length >= 2 ? rawBass.slice(0, 8) : [45, 41, 36, 43],
    drumStyle,
    lyrics: typeof parsed.lyrics === 'string' ? parsed.lyrics.trim() : '',
    prompt,
  };
}

function buildFallbackSvg(title: string): string {
  const safeTitle = title.replace(/[<>&"']/g, '');
  return `<svg viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#0f172a"/><stop offset="55%" stop-color="#1e3a8a"/><stop offset="100%" stop-color="#38bdf8"/></linearGradient><radialGradient id="glow" cx="50%" cy="38%" r="36%"><stop offset="0%" stop-color="#fef08a" stop-opacity="0.95"/><stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/></radialGradient></defs><rect width="800" height="600" fill="url(#sky)"/><circle cx="400" cy="230" r="190" fill="url(#glow)"/><circle cx="400" cy="230" r="68" fill="#fef9c3"/><path d="M0 440 Q180 330 380 410 T800 390 L800 600 L0 600 Z" fill="#1e293b" opacity="0.85"/><path d="M0 490 Q240 420 510 490 T800 470 L800 600 L0 600 Z" fill="#0f172a"/><text x="40" y="560" fill="#e2e8f0" font-family="sans-serif" font-size="20" opacity="0.75">${safeTitle}</text></svg>`;
}

async function composeImageWithGemini(ai: GoogleGenAI, prompt: string, styleHint?: string) {
  const styleText = styleHint?.trim() || 'vivid layered vector art';
  const response = await generateContentWithRetry(ai, {
    model: 'gemini-3.1-flash-lite',
    contents: `Create a detailed, artistic, multi-layered SVG illustration for: "${prompt}" in style "${styleText}". Requirements: root <svg viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg">, rich <defs> linear/radial gradients, detailed background, midground, and foreground vector shapes/paths, lighting highlights, clean composition, NO script/foreignObject/external image tags.`,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          style: { type: Type.STRING },
          svgMarkup: { type: Type.STRING },
        },
        required: ['title', 'style', 'svgMarkup'],
      },
    },
  });

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(response.text || '{}') as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  const title =
    typeof parsed.title === 'string' && parsed.title.trim()
      ? parsed.title.trim()
      : 'Generated Artwork';
  const style =
    typeof parsed.style === 'string' && parsed.style.trim() ? parsed.style.trim() : styleText;
  const rawSvgRaw = typeof parsed.svgMarkup === 'string' ? parsed.svgMarkup.trim() : '';
  const rawSvg = rawSvgRaw
    .replace(/^```(?:svg|xml|html)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
  const hasValidSvg = rawSvg.includes('<svg') && rawSvg.includes('</svg>');

  return {
    kind: 'image' as const,
    id: makeWidgetId('img'),
    title,
    prompt,
    style,
    svgMarkup: hasValidSvg ? rawSvg : buildFallbackSvg(title),
  };
}

async function composeVideoWithGemini(ai: GoogleGenAI, prompt: string) {
  const response = await generateContentWithRetry(ai, {
    model: 'gemini-3.1-flash-lite',
    contents: `Design a short looping animated motion scene for: "${prompt}". Choose archetype ONLY from: cosmic-nebula, cyber-rain, ocean-waves, mountain-sunrise, botanical-breeze, geometric-pulse. Provide 5 hex colors in palette (#RRGGBB from darkest background to brightest highlight), durationSeconds (6 to 12), and 3 to 5 scenes with short evocative captions.`,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          durationSeconds: { type: Type.INTEGER },
          palette: { type: Type.ARRAY, items: { type: Type.STRING } },
          archetype: { type: Type.STRING },
          scenes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                caption: { type: Type.STRING },
                intensity: { type: Type.NUMBER },
                focus: { type: Type.STRING },
              },
              required: ['caption', 'intensity', 'focus'],
            },
          },
        },
        required: ['title', 'durationSeconds', 'palette', 'archetype', 'scenes'],
      },
    },
  });

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(response.text || '{}') as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  const archetype =
    typeof parsed.archetype === 'string' && VALID_VIDEO_ARCHETYPES.has(parsed.archetype)
      ? (parsed.archetype as
          | 'cosmic-nebula'
          | 'cyber-rain'
          | 'ocean-waves'
          | 'mountain-sunrise'
          | 'botanical-breeze'
          | 'geometric-pulse')
      : 'cosmic-nebula';

  const palette = Array.isArray(parsed.palette)
    ? parsed.palette.filter((c): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c))
    : [];

  const scenes = Array.isArray(parsed.scenes)
    ? parsed.scenes
        .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
        .map((s) => ({
          caption: typeof s.caption === 'string' ? s.caption.trim() : 'Scene',
          intensity: typeof s.intensity === 'number' ? Math.max(0.1, Math.min(1, s.intensity)) : 0.7,
          focus: typeof s.focus === 'string' ? s.focus : 'center',
        }))
    : [];

  const rawDur = typeof parsed.durationSeconds === 'number' ? parsed.durationSeconds : 8;
  return {
    kind: 'video' as const,
    id: makeWidgetId('vid'),
    title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : 'Animated Scene',
    prompt,
    durationSeconds: Math.max(6, Math.min(12, Math.round(rawDur))),
    palette: palette.length >= 4 ? palette.slice(0, 5) : ['#0B1026', '#1D2B64', '#3E64FF', '#7DD3FC', '#F8FAFC'],
    archetype,
    scenes: scenes.length > 0 ? scenes.slice(0, 5) : [{ caption: prompt.slice(0, 60), intensity: 0.8, focus: 'center' }],
  };
}

async function createServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.use('/api/chat/stream', express.json({ limit: '64mb' }));
  app.use('/api/sync/state', express.json({ limit: '24mb' }));
  app.use(express.json({ limit: '512kb' }));

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'Invalid JSON request body.' });
      return;
    }
    if (
      typeof (err as { status?: unknown })?.status === 'number' &&
      (err as { status: number }).status === 413
    ) {
      res.status(413).json({ error: 'Request payload is too large.' });
      return;
    }
    next(err);
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      aiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      authConfigured: isSupabaseConfigured(),
      timestamp: Date.now(),
    });
  });

  await hydrateAdminStateFromSupabase();
  registerSupabaseAuthRoutes(app);
  registerAdminRoutes(app);
  registerSupabaseSyncRoutes(app);

  app.post('/api/chat/stream', async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown> | undefined;
    const rawMode = body?.mode;
    const mode: 'fast' | 'teacher' | 'deep' | 'coder' =
      rawMode === 'coder'
        ? 'coder'
        : rawMode === 'deep'
          ? 'deep'
          : rawMode === 'teacher'
            ? 'teacher'
            : 'fast';
    const view: 'chat' | 'workspace' =
      body?.view === 'workspace' ? 'workspace' : 'chat';

    const authContext = await resolveRequestAuthContext(req, res);
    const authUser = authContext?.user ?? null;
    const policy = getWorkspacePolicy();

    if (view === 'workspace' || mode === 'coder') {
      if (!authUser || !authUser.isAdmin || !authUser.workspaceAccess) {
        recordAuditEvent({
          event: 'workspace_blocked',
          actorEmail: authUser?.email || 'guest',
          actorRole: authUser?.role || 'guest',
          detail: `Blocked ${view === 'workspace' ? 'Workspace Studio' : 'Pro Coder'} prompt request.`,
          allowed: false,
        });
        res.status(403).json({
          error: 'Hazel Workspace is locked. Only an administrator account can access Workspace Studio.',
          code: 'WORKSPACE_LOCKED',
        });
        return;
      }
    } else {
      if (!authUser && !policy.allowGuestChat) {
        res.status(401).json({
          error: 'Sign in is required to use Hazel Chat.',
          code: 'AUTH_REQUIRED',
        });
        return;
      }
      if (authUser && !authUser.isAdmin && !policy.allowStandardChat) {
        res.status(403).json({
          error: 'Chat access for standard accounts is currently paused by the administrator.',
          code: 'CHAT_DISABLED',
        });
        return;
      }
    }

    const turnCheck = validateTurns(body?.messages);
    if (!turnCheck.ok) {
      res.status(400).json({ error: turnCheck.error });
      return;
    }

    const ai = getGenAIClient();
    if (!ai) {
      res.status(503).json({
        error: 'Assistant service is not configured on the server (missing GEMINI_API_KEY).',
      });
      return;
    }

    const webSearch = Boolean(body?.webSearch);
    const skipTimerTool = Boolean(body?.skipTimerTool);
    const tzOffsetMinutes =
      typeof body?.tzOffsetMinutes === 'number' && Number.isFinite(body.tzOffsetMinutes)
        ? body.tzOffsetMinutes
        : 0;

    const chatInstruction = [
      'You are Hazel, a warm, genuine, easygoing friend having a natural everyday conversation.',
      'Use approachable, everyday phrasing and concise pacing without stiff corporate tone or walls of text.',
      'Chat mode scope: stay on friendly everyday conversation. If asked to build an app, debug code, or explore AI/ML architectures, warmly suggest switching to Workspace mode at the top of the screen.',
    ];

    if (view === 'chat') {
      if (mode === 'teacher') {
        chatInstruction.push(
          'Teacher mode: explain clearly with a relatable real-life analogy, simple steps without jargon, and a friendly check-in question.'
        );
      } else if (mode === 'deep') {
        chatInstruction.push(
          'Deep Think mode: help reason thoughtfully and clearly through a real-life decision or idea.'
        );
      }
    }

    const workspaceInstruction = [
      'You are Hazel in Workspace Studio—a Principal Software Architect, Systems Engineer, and AI/ML Research Scientist.',
      'Lead directly with complete, production-ready, zero-placeholder code and clear first-principles explanations. Never abbreviate, omit sections, or write "// ... rest of code"; provide every line in full.',
      'For single-file web apps/websites, emit one complete self-contained ```html block runnable in Workspace Preview. For multi-file apps or Python/ML systems, emit complete files labeled ```lang:path/to/file with explicit tensor shape comments (# [B, T, D]), edge-case guards, and tests.',
      'Never fabricate file contents, API signatures, or citations.',
    ];

    const guestMemories = authContext ? [] : sanitizeMemories(body?.memories);
    const effectiveMemories: SyncedMemoryItem[] = authContext
      ? (await loadMemoriesForContext(authContext)).memories
      : guestMemories;
    const memoriesBlock = formatMemoriesPromptBlock(effectiveMemories);

    const latestUserTurn = [...turnCheck.turns]
      .reverse()
      .find((t) => t.role === 'user');
    const latestTextLower = (latestUserTurn?.text || '').toLowerCase();

    const selectedFunctionDeclarations: FunctionDeclaration[] = [];
    if (
      !skipTimerTool &&
      /\b(timer|countdown|alarm|remind|reminder|wake me|in \d+|minutes?|seconds?|hours?)\b/i.test(
        latestTextLower
      )
    ) {
      selectedFunctionDeclarations.push(setTimerTool, setReminderTool);
    }
    if (/\b(song|music|lyric|lyrics|melody|beat|tune|sing|compose)\b/i.test(latestTextLower)) {
      selectedFunctionDeclarations.push(createSongTool);
    }
    if (/\b(image|picture|draw|sketch|illustrat|artwork|painting|poster|logo|svg)\b/i.test(latestTextLower)) {
      selectedFunctionDeclarations.push(createImageTool);
    }
    if (/\b(video|animation|animate|clip|movie|motion)\b/i.test(latestTextLower)) {
      selectedFunctionDeclarations.push(createVideoTool);
    }
    const wantsMemoryTool =
      /\b(remember|save|note|keep in mind|forget|erase|delete|memory|memories)\b/i.test(
        latestTextLower
      );
    if (wantsMemoryTool) {
      selectedFunctionDeclarations.push(saveMemoryTool, forgetMemoryTool);
    }

    const memoryInstruction =
      selectedFunctionDeclarations.length > 0
        ? 'Call matching tools (`set_timer`, `set_reminder`, `create_song`, `create_image`, `create_video`, `save_memory`, `forget_memory`) when requested.'
        : '';

    if (view === 'workspace') {
      if (mode === 'teacher') {
        workspaceInstruction.push(
          'Teacher Mode: start with clear intuition, walk through worked examples/code step by step, note common pitfalls, and end with a quick check-in.'
        );
      } else if (mode === 'coder') {
        workspaceInstruction.push(
          'Pro Coder mode: verify invariants, edge cases, types, security, and runnable tests with zero stubs.'
        );
      }
      if (memoryInstruction) workspaceInstruction.push(memoryInstruction);
      if (memoriesBlock) workspaceInstruction.push(memoriesBlock);
    } else {
      if (memoryInstruction) chatInstruction.push(memoryInstruction);
      if (memoriesBlock) chatInstruction.push(memoriesBlock);
    }

    const systemInstruction = (
      view === 'workspace' ? workspaceInstruction : chatInstruction
    ).join(' ');
    const contents = buildModelContents(turnCheck.turns);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(': connected\n\n');

    let clientClosed = false;
    res.on('close', () => {
      if (!res.writableEnded) {
        clientClosed = true;
      }
    });

    const seenSourceUrls = new Set<string>();
    const collectedSources: Array<{ title: string; url: string }> = [];
    let emittedTextChars = 0;
    let emittedWidgets = 0;

    const tools: Array<{ googleSearch?: Record<string, never>; functionDeclarations?: FunctionDeclaration[] }> = [];
    if (webSearch) {
      tools.push({ googleSearch: {} });
    }
    if (selectedFunctionDeclarations.length > 0) {
      tools.push({ functionDeclarations: selectedFunctionDeclarations });
    }
    const hasHybridTools = webSearch && selectedFunctionDeclarations.length > 0;

    const sleepWithKeepalive = async (totalMs: number) => {
      let remaining = totalMs;
      while (remaining > 0 && !clientClosed) {
        if (!res.writableEnded) {
          res.write(': keepalive\n\n');
        }
        const slice = Math.min(remaining, 1000);
        await new Promise((r) => setTimeout(r, slice));
        remaining -= slice;
      }
    };

    // Free-tier resilient attempts with progressive backoff
    const streamAttempts: Array<{
      model: string;
      thinkingLevel: ThinkingLevel;
      delayBeforeMs: number;
      includeThoughts: boolean;
      useStreaming: boolean;
    }> =
      mode === 'fast'
        ? [
            {
              model: 'gemini-3.1-flash-lite',
              thinkingLevel: ThinkingLevel.MINIMAL,
              delayBeforeMs: 0,
              includeThoughts: false,
              useStreaming: true,
            },
            {
              model: 'gemini-4-hydrogen',
              thinkingLevel: ThinkingLevel.LOW,
              delayBeforeMs: 1000,
              includeThoughts: false,
              useStreaming: true,
            },
            {
              model: 'gemini-3.1-flash-lite',
              thinkingLevel: ThinkingLevel.MINIMAL,
              delayBeforeMs: 2200,
              includeThoughts: false,
              useStreaming: true,
            },
          ]
        : [
            {
              model: 'gemini-4-hydrogen',
              thinkingLevel:
                mode === 'coder' ? ThinkingLevel.HIGH : ThinkingLevel.MEDIUM,
              delayBeforeMs: 0,
              includeThoughts: true,
              useStreaming: true,
            },
            {
              model: 'gemini-3.1-flash-lite',
              thinkingLevel:
                mode === 'coder' ? ThinkingLevel.HIGH : ThinkingLevel.LOW,
              delayBeforeMs: 1000,
              includeThoughts: false,
              useStreaming: true,
            },
            {
              model: 'gemini-4-hydrogen',
              thinkingLevel: ThinkingLevel.LOW,
              delayBeforeMs: 2200,
              includeThoughts: false,
              useStreaming: true,
            },
          ];

    const processCandidate = (
      candidate: {
        content?: { parts?: Part[] };
        finishReason?: FinishReason | string;
        groundingMetadata?: {
          groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
        };
      } | undefined,
      pendingCallParts: Part[],
      modelTurnParts: Part[],
      onTextChunk: (chunkText: string) => void
    ): { emitted: boolean; finishReason?: FinishReason | string } => {
      let emitted = false;
      const parts = candidate?.content?.parts ?? [];

      for (const part of parts) {
        modelTurnParts.push(part);
        if (part.functionCall) {
          emitted = true;
          pendingCallParts.push(part);
          continue;
        }
        if (typeof part.text !== 'string' || part.text.length === 0) continue;
        emitted = true;
        if (part.thought) {
          writeSseEvent(res, 'thought', { delta: part.text });
        } else {
          emittedTextChars += part.text.length;
          onTextChunk(part.text);
          writeSseEvent(res, 'text', { delta: part.text });
        }
      }

      const groundingChunks = candidate?.groundingMetadata?.groundingChunks;
      if (Array.isArray(groundingChunks) && groundingChunks.length > 0) {
        let added = false;
        for (const gc of groundingChunks) {
          const url = gc?.web?.uri?.trim();
          if (!url || !isSafeHttpUrl(url) || seenSourceUrls.has(url)) continue;
          seenSourceUrls.add(url);
          const title = gc?.web?.title?.trim() || new URL(url).hostname;
          collectedSources.push({ title, url });
          added = true;
        }
        if (added) {
          writeSseEvent(res, 'sources', { sources: collectedSources });
        }
      }

      return { emitted, finishReason: candidate?.finishReason };
    };

    const streamTurn = async (
      turnContents: Content[],
      allowTools: boolean,
      isContinuation = false
    ): Promise<{
      pendingCallParts: Part[];
      modelTurnParts: Part[];
      finishReason?: FinishReason | string;
      turnText: string;
    }> => {
      let lastErr: unknown;

      for (let attemptIdx = 0; attemptIdx < streamAttempts.length; attemptIdx++) {
        if (clientClosed) break;
        const plan = streamAttempts[attemptIdx];
        if (plan.delayBeforeMs > 0) {
          await sleepWithKeepalive(plan.delayBeforeMs);
          if (clientClosed) break;
        }

        const pendingCallParts: Part[] = [];
        const modelTurnParts: Part[] = [];
        let turnText = '';
        let lastFinishReason: FinishReason | string | undefined;
        let sawOutputInAttempt = false;
        const useTools = allowTools && tools.length > 0;
        const requestConfig = {
          systemInstruction,
          thinkingConfig: {
            thinkingLevel: isContinuation ? ThinkingLevel.LOW : plan.thinkingLevel,
            includeThoughts: isContinuation ? false : plan.includeThoughts,
          },
          ...(useTools
            ? {
                tools,
                ...(hasHybridTools
                  ? { toolConfig: { includeServerSideToolInvocations: true } }
                  : {}),
              }
            : {}),
        };

        try {
          if (plan.useStreaming) {
            const stream = await ai.models.generateContentStream({
              model: plan.model,
              contents: turnContents,
              config: requestConfig,
            });

            for await (const chunk of stream) {
              if (clientClosed) break;
              const cand = chunk.candidates?.[0];
              const step = processCandidate(
                cand,
                pendingCallParts,
                modelTurnParts,
                (delta) => {
                  turnText += delta;
                }
              );
              if (step.emitted) {
                sawOutputInAttempt = true;
              }
              if (step.finishReason) {
                lastFinishReason = step.finishReason;
              }
            }
          } else {
            const response = await ai.models.generateContent({
              model: plan.model,
              contents: turnContents,
              config: requestConfig,
            });
            if (!clientClosed) {
              const cand = response.candidates?.[0];
              const step = processCandidate(
                cand,
                pendingCallParts,
                modelTurnParts,
                (delta) => {
                  turnText += delta;
                }
              );
              if (step.finishReason) {
                lastFinishReason = step.finishReason;
              }
              if (step.emitted) {
                sawOutputInAttempt = true;
              } else if (typeof response.text === 'string' && response.text.length > 0) {
                sawOutputInAttempt = true;
                turnText += response.text;
                emittedTextChars += response.text.length;
                writeSseEvent(res, 'text', { delta: response.text });
              }
            }
          }

          return {
            pendingCallParts,
            modelTurnParts,
            finishReason: lastFinishReason,
            turnText,
          };
        } catch (err) {
          lastErr = err;
          if (sawOutputInAttempt || clientClosed) {
            throw err;
          }
          const rawMsg = err instanceof Error ? err.message : '';
          const unwrapped = unwrapJsonErrorMessage(rawMsg);
          const rawStatus =
            typeof (err as { status?: unknown })?.status === 'number'
              ? (err as { status: number }).status
              : 502;
          const resolvedStatus = unwrapped.code ?? rawStatus;
          const msgToCheck = unwrapped.message || rawMsg;

          const isQuota429 =
            resolvedStatus === 429 ||
            /quota|rate limit|resource_exhausted/i.test(msgToCheck);
          // Do not burn retries when Google Search grounding is quota-limited,
          // and allow at most 1 model-bucket switch on regular 429 spikes.
          const canRetry = isQuota429
            ? !webSearch && attemptIdx === 0
            : isTransientOverloadError(resolvedStatus, msgToCheck) ||
              (resolvedStatus === 400 && attemptIdx < streamAttempts.length - 1);

          if (canRetry && attemptIdx < streamAttempts.length - 1) {
            continue;
          }
          throw err;
        }
      }
      if (lastErr) throw lastErr;
      return {
        pendingCallParts: [],
        modelTurnParts: [],
        finishReason: undefined,
        turnText: '',
      };
    };

    const streamWithAutoContinue = async (
      baseContents: Content[],
      allowTools: boolean
    ): Promise<{ pendingCallParts: Part[]; modelTurnParts: Part[] }> => {
      const firstResult = await streamTurn(baseContents, allowTools, false);
      if (clientClosed || firstResult.pendingCallParts.length > 0) {
        return {
          pendingCallParts: firstResult.pendingCallParts,
          modelTurnParts: firstResult.modelTurnParts,
        };
      }

      let fullGeneratedText = firstResult.turnText;
      let finishReason = firstResult.finishReason;
      let continuationCount = 0;

      while (
        !clientClosed &&
        finishReason === FinishReason.MAX_TOKENS &&
        fullGeneratedText.length > 0 &&
        continuationCount < MAX_STREAM_CONTINUATIONS
      ) {
        continuationCount += 1;
        await sleepWithKeepalive(200);
        if (clientClosed) break;

        const contextTail =
          fullGeneratedText.length > CONTINUATION_CONTEXT_CHARS
            ? fullGeneratedText.slice(-CONTINUATION_CONTEXT_CHARS)
            : fullGeneratedText;

        const continuationContents: Content[] = [
          ...baseContents,
          { role: 'model', parts: [{ text: contextTail }] },
          {
            role: 'user',
            parts: [
              {
                text: 'Continue seamlessly from your exact last character. Do not repeat any text you already wrote, do not add any intro, apology, or recap, and finish cleanly.',
              },
            ],
          },
        ];

        const nextResult = await streamTurn(continuationContents, false, true);
        if (!nextResult.turnText) {
          break;
        }
        fullGeneratedText += nextResult.turnText;
        finishReason = nextResult.finishReason;
      }

      return {
        pendingCallParts: [],
        modelTurnParts: firstResult.modelTurnParts,
      };
    };

    try {
      const { pendingCallParts, modelTurnParts } = await streamWithAutoContinue(contents, true);

      if (!clientClosed && pendingCallParts.length > 0) {
        const functionResponseParts: Part[] = [];

        for (const callPart of pendingCallParts) {
          if (clientClosed) break;
          const fc = callPart.functionCall;
          if (!fc?.name) continue;
          const args = (fc.args ?? {}) as Record<string, unknown>;
          let toolResult: Record<string, unknown> = { ok: true };

          if (fc.name === 'set_timer' || fc.name === 'set_reminder') {
            const resolved = resolveReminderArgs(
              args,
              tzOffsetMinutes,
              fc.name === 'set_reminder'
            );

            if (!skipTimerTool) {
              const widget = {
                kind: 'timer' as const,
                id: makeWidgetId(resolved.isReminder ? 'rem' : 'tmr'),
                label: resolved.label,
                durationSeconds: resolved.durationSeconds,
                createdAt: Date.now(),
                targetTime: resolved.targetTime,
                isReminder: resolved.isReminder,
                reminderNote: resolved.isReminder ? resolved.label : undefined,
              };
              writeSseEvent(res, 'widget', { widget });
              emittedWidgets += 1;
            }
            toolResult = {
              status: 'started',
              label: resolved.label,
              durationSeconds: resolved.durationSeconds,
              isReminder: resolved.isReminder,
            };
          } else if (fc.name === 'create_song') {
            const songPrompt =
              typeof args.prompt === 'string' && args.prompt.trim()
                ? args.prompt.trim()
                : 'uplifting instrumental melody';
            const widget = await composeSongWithGemini(ai, songPrompt);
            writeSseEvent(res, 'widget', { widget });
            emittedWidgets += 1;
            toolResult = {
              status: 'created',
              title: widget.title,
              genre: widget.genre,
              bpm: widget.bpm,
              key: widget.key,
              chords: widget.chords,
            };
          } else if (fc.name === 'create_image') {
            const imgPrompt =
              typeof args.prompt === 'string' && args.prompt.trim()
                ? args.prompt.trim()
                : 'abstract luminous horizon';
            const style = typeof args.style === 'string' ? args.style : undefined;
            const widget = await composeImageWithGemini(ai, imgPrompt, style);
            writeSseEvent(res, 'widget', { widget });
            emittedWidgets += 1;
            toolResult = {
              status: 'created',
              title: widget.title,
              style: widget.style,
            };
          } else if (fc.name === 'create_video') {
            const vidPrompt =
              typeof args.prompt === 'string' && args.prompt.trim()
                ? args.prompt.trim()
                : 'cosmic nebula drifting in space';
            const widget = await composeVideoWithGemini(ai, vidPrompt);
            writeSseEvent(res, 'widget', { widget });
            emittedWidgets += 1;
            toolResult = {
              status: 'created',
              title: widget.title,
              durationSeconds: widget.durationSeconds,
              archetype: widget.archetype,
            };
          } else if (fc.name === 'save_memory') {
            const memContent =
              typeof args.content === 'string' ? args.content.trim() : '';
            const memCategory =
              typeof args.category === 'string' ? args.category.trim().toLowerCase() : 'general';
            if (memContent) {
              const saved = await saveMemoryForContext(
                authContext,
                {
                  content: memContent,
                  category: memCategory,
                  source: 'assistant',
                },
                guestMemories
              );
              const widget = {
                kind: 'memory' as const,
                id: makeWidgetId('memw'),
                action: 'saved' as const,
                memoryId: saved.memory.id,
                content: saved.memory.content,
                category: saved.memory.category,
                createdAt: saved.memory.updatedAt,
              };
              writeSseEvent(res, 'widget', { widget });
              writeSseEvent(res, 'memory', {
                action: 'saved',
                memory: saved.memory,
                backend: saved.backend,
                schemaMissing: saved.schemaMissing,
              });
              emittedWidgets += 1;
              toolResult = {
                status: 'saved',
                memoryId: saved.memory.id,
                content: saved.memory.content,
                category: saved.memory.category,
                persistedTo: saved.backend,
              };
            } else {
              toolResult = { status: 'ignored', reason: 'Empty memory content.' };
            }
          } else if (fc.name === 'forget_memory') {
            const query =
              typeof args.query === 'string' ? args.query.trim() : '';
            const removedRes = await forgetMemoryForContext(
              authContext,
              query,
              guestMemories
            );
            if (removedRes.removed.length > 0) {
              const primary = removedRes.removed[0];
              const widget = {
                kind: 'memory' as const,
                id: makeWidgetId('memw'),
                action: 'forgotten' as const,
                memoryId: primary.id,
                content:
                  removedRes.removed.length === 1
                    ? primary.content
                    : `${removedRes.removed.length} matching memories (${primary.content})`,
                category: primary.category,
                createdAt: Date.now(),
              };
              writeSseEvent(res, 'widget', { widget });
              writeSseEvent(res, 'memory', {
                action: 'forgotten',
                removedIds: removedRes.removed.map((m) => m.id),
                removed: removedRes.removed,
                backend: removedRes.backend,
                schemaMissing: removedRes.schemaMissing,
              });
              emittedWidgets += 1;
            }
            toolResult = {
              status: removedRes.removed.length > 0 ? 'forgotten' : 'not_found',
              removedCount: removedRes.removed.length,
              removedContents: removedRes.removed.map((m) => m.content),
            };
          }

          functionResponseParts.push({
            functionResponse: {
              name: fc.name,
              ...(fc.id ? { id: fc.id } : {}),
              response: toolResult,
            },
          });
        }

        if (!clientClosed && functionResponseParts.length > 0) {
          const followUpContents: Content[] = [
            ...contents,
            {
              role: 'model',
              parts: modelTurnParts.length > 0 ? modelTurnParts : pendingCallParts,
            },
            { role: 'user', parts: functionResponseParts },
          ];
          try {
            await streamWithAutoContinue(followUpContents, false);
          } catch (followErr) {
            if (emittedWidgets === 0) {
              throw followErr;
            }
          }
        }
      }

      if (!clientClosed) {
        if (emittedTextChars === 0 && emittedWidgets > 0) {
          const fallback = 'Done — updated above.';
          emittedTextChars += fallback.length;
          writeSseEvent(res, 'text', { delta: fallback });
        }
        if (emittedTextChars === 0) {
          writeSseEvent(res, 'error', {
            status: 502,
            message: 'No response text was generated for this request. Please try rephrasing.',
          });
        } else {
          writeSseEvent(res, 'done', { timestamp: Date.now() });
        }
      }
    } catch (err) {
      if (!clientClosed) {
        const { status, message } = extractGeminiError(
          err,
          'Failed to generate a response. Please try again.'
        );
        const finalMessage =
          webSearch && status === 429
            ? 'Live Web Search grounding reached its free-tier quota limit right now. Turn off Web Search (the globe icon) to continue chatting normally, or check your Gemini API quota.'
            : message;
        writeSseEvent(res, 'error', { status, message: finalMessage });
      }
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
  });

  const httpServer = createHttpServer(app);
  const liveWss = new WebSocketServer({
    noServer: true,
    maxPayload: 4 * 1024 * 1024,
  });
  const VALID_LIVE_VOICES = new Set(['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr']);

  httpServer.on('upgrade', (request, socket, head) => {
    let pathname = '/';
    try {
      pathname = new URL(request.url || '/', 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== '/api/live') {
      if (IS_PRODUCTION) {
        socket.destroy();
      }
      return;
    }

    liveWss.handleUpgrade(request, socket, head, (ws) => {
      liveWss.emit('connection', ws, request);
    });
  });

  liveWss.on('connection', async (clientWs, request) => {
    let closedByClient = false;
    let sentError = false;

    clientWs.on('error', (err) => {
      closedByClient = true;
      console.warn('[Live client WS error]', err.message);
    });

    const ai = getGenAIClient('v1beta');
    if (!ai) {
      if (clientWs.readyState === WebSocket.OPEN) {
        try {
          clientWs.send(
            JSON.stringify({
              type: 'error',
              message: 'Live voice service is unavailable because GEMINI_API_KEY is missing on the server.',
            })
          );
          clientWs.close();
        } catch {
          // Ignore close errors
        }
      }
      return;
    }

    let requestedVoice = 'Zephyr';
    let requestedView: 'chat' | 'workspace' = 'chat';
    let requestedTzOffset = 0;
    try {
      const reqUrl = new URL(request.url || '/', 'http://localhost');
      const v = reqUrl.searchParams.get('voice') || '';
      if (VALID_LIVE_VOICES.has(v)) requestedVoice = v;
      if (reqUrl.searchParams.get('view') === 'workspace') {
        requestedView = 'workspace';
      }
      const tzParam = Number(reqUrl.searchParams.get('tzOffset'));
      if (Number.isFinite(tzParam)) requestedTzOffset = tzParam;
    } catch {
      // Fallback to Zephyr / chat
    }

    const sendToClient = (payload: Record<string, unknown>) => {
      if (!closedByClient && clientWs.readyState === WebSocket.OPEN) {
        try {
          clientWs.send(JSON.stringify(payload));
        } catch {
          closedByClient = true;
        }
      }
    };

    const liveAuthContext = await resolveLiveSessionContext(request.headers, request.url);
    const liveAuthUser = liveAuthContext?.user ?? null;
    const livePolicy = getWorkspacePolicy();
    let liveTicketParam: string | null = null;
    try {
      liveTicketParam = new URL(request.url || '/', 'http://localhost').searchParams.get('ticket');
    } catch {
      liveTicketParam = null;
    }
    let liveGuestMemories: SyncedMemoryItem[] = liveAuthContext
      ? []
      : sanitizeMemories(consumeGuestWsTicket(liveTicketParam));

    if (
      requestedView === 'workspace' &&
      (!liveAuthUser || !liveAuthUser.isAdmin || !liveAuthUser.workspaceAccess)
    ) {
      recordAuditEvent({
        event: 'workspace_live_blocked',
        actorEmail: liveAuthUser?.email || 'guest',
        actorRole: liveAuthUser?.role || 'guest',
        detail: 'Blocked unauthorized Live Voice connection to Hazel Workspace.',
        allowed: false,
      });
      sendToClient({
        type: 'error',
        message: 'Hazel Workspace is locked. Administrator access is required.',
      });
      clientWs.close();
      return;
    }

    if (
      requestedView === 'chat' &&
      !liveAuthUser?.isAdmin &&
      !livePolicy.allowLiveVoiceForNonAdmin
    ) {
      sendToClient({
        type: 'error',
        message: 'Live voice is currently restricted to administrator accounts.',
      });
      clientWs.close();
      return;
    }

    const liveMemories = liveAuthContext
      ? (await loadMemoriesForContext(liveAuthContext)).memories
      : liveGuestMemories;
    const liveMemoriesBlock = formatMemoriesPromptBlock(liveMemories);
    const liveMemoryInstruction =
      'You also have persistent long-term memory across sessions: whenever the user asks you to remember or keep something in mind, call save_memory right away; whenever they ask you to forget something, call forget_memory.';

    const baseLiveInstruction =
      requestedView === 'workspace'
        ? 'You are Hazel in Workspace Studio, a warm, articulate AI engineering and ML partner with deep expertise in building apps, Machine Learning, Deep Learning, NLP, AI Systems Engineering, and code debugging. Speak concisely and naturally as in a real-time conversation unless asked for deep technical detail. When the user turns on their camera or shares their screen, observe what they show carefully (including code, architectures, training curves, or errors) and answer accurately. Whenever the user asks to set a timer, alarm, countdown, or time-based reminder, call set_reminder (for reminders/clock times) or set_timer immediately so an on-screen alert and browser notification will fire when it expires.'
        : 'You are Hazel, a warm, easygoing, relatable friend having a natural real-time conversation about day-to-day life—daily routines, plans, cooking, hobbies, work/life balance, ideas, and everyday questions. Speak casually, warmly, and concisely like a supportive friend. Keep Chat mode focused on friendly everyday conversation and do not steer into building apps, debugging code, or AI/ML technical topics; if the user brings those up, warmly mention they can switch to Workspace mode for coding, app building, and AI/ML tools. When the user shares their camera or screen, respond naturally and warmly to what you see. Whenever the user asks to set a timer, alarm, countdown, or time-based reminder, call set_reminder (for reminders/clock times) or set_timer immediately so an on-screen alert and browser notification will fire when it expires.';

    const liveSystemInstruction = [
      baseLiveInstruction,
      liveMemoryInstruction,
      liveMemoriesBlock,
    ]
      .filter(Boolean)
      .join('\n\n');

    let latestResumptionHandle: string | null = null;
    let readySent = false;
    let resumeCount = 0;
    let isReconnecting = false;
    let activeConnSeq = 0;
    const MAX_LIVE_RESUMES = 25;

    type LiveSessionType = Awaited<ReturnType<typeof ai.live.connect>>;
    let activeSession: LiveSessionType | null = null;

    const connectLiveUpstream = (resumeHandle?: string): Promise<LiveSessionType | null> => {
      const connSeq = ++activeConnSeq;
      let connSession: LiveSessionType | null = null;

      const promise = ai.live
        .connect({
          model: 'gemini-3.8-live',
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: requestedVoice },
              },
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            contextWindowCompression: {
              slidingWindow: {},
            },
            sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
            tools: [
              {
                functionDeclarations: [
                  setTimerTool,
                  setReminderTool,
                  saveMemoryTool,
                  forgetMemoryTool,
                ],
              },
            ],
            systemInstruction: liveSystemInstruction,
          },
          callbacks: {
            onopen: () => {
              if (closedByClient || connSeq !== activeConnSeq) return;
              if (!readySent) {
                readySent = true;
                sendToClient({ type: 'ready', voice: requestedVoice });
              }
            },
            onmessage: (message: LiveServerMessage) => {
              if (closedByClient || connSeq !== activeConnSeq) return;

              if (
                message.sessionResumptionUpdate?.resumable &&
                message.sessionResumptionUpdate?.newHandle
              ) {
                latestResumptionHandle = message.sessionResumptionUpdate.newHandle;
              }

              if (
                message.goAway &&
                latestResumptionHandle &&
                !closedByClient &&
                !isReconnecting &&
                resumeCount < MAX_LIVE_RESUMES
              ) {
                isReconnecting = true;
                resumeCount += 1;
                const oldSess = connSession ?? activeSession;
                const nextPromise = connectLiveUpstream(latestResumptionHandle);
                sessionPromise = nextPromise;
                void nextPromise
                  .then((newSess) => {
                    if (oldSess && oldSess !== newSess) {
                      try {
                        oldSess.close();
                      } catch {
                        // Ignore close on replaced session
                      }
                    }
                  })
                  .finally(() => {
                    isReconnecting = false;
                  });
              }

              if (message.toolCall?.functionCalls?.length) {
                const calls = message.toolCall.functionCalls;
                void (async () => {
                  const responses = await Promise.all(
                    calls.map(async (call) => {
                      const args = (call.args ?? {}) as Record<string, unknown>;
                      if (call.name === 'set_timer' || call.name === 'set_reminder') {
                        const resolved = resolveReminderArgs(
                          args,
                          requestedTzOffset,
                          call.name === 'set_reminder'
                        );

                        sendToClient({
                          type: 'timer',
                          timer: {
                            kind: 'timer',
                            id: makeWidgetId(resolved.isReminder ? 'rem' : 'tmr'),
                            label: resolved.label,
                            durationSeconds: resolved.durationSeconds,
                            createdAt: Date.now(),
                            targetTime: resolved.targetTime,
                            isReminder: resolved.isReminder,
                            reminderNote: resolved.isReminder ? resolved.label : undefined,
                          },
                        });

                        return {
                          id: call.id,
                          name: call.name,
                          response: {
                            result: `${resolved.isReminder ? 'Reminder' : 'Timer'} "${resolved.label}" scheduled for ${resolved.durationSeconds} seconds from now with expiration alert.`,
                          },
                        };
                      }

                      if (call.name === 'save_memory') {
                        const memContent =
                          typeof args.content === 'string' ? args.content.trim() : '';
                        const memCategory =
                          typeof args.category === 'string'
                            ? args.category.trim().toLowerCase()
                            : 'general';
                        if (memContent) {
                          const saved = await saveMemoryForContext(
                            liveAuthContext,
                            {
                              content: memContent,
                              category: memCategory,
                              source: 'live',
                            },
                            liveGuestMemories
                          );
                          if (!liveAuthContext) {
                            liveGuestMemories = [
                              saved.memory,
                              ...liveGuestMemories.filter((m) => m.id !== saved.memory.id),
                            ].slice(0, 120);
                          }
                          sendToClient({
                            type: 'memory',
                            action: 'saved',
                            memory: saved.memory,
                          });
                          return {
                            id: call.id,
                            name: call.name,
                            response: {
                              result: `Saved to long-term memory: "${saved.memory.content}".`,
                            },
                          };
                        }
                        return {
                          id: call.id,
                          name: call.name,
                          response: { result: 'No memory text provided.' },
                        };
                      }

                      if (call.name === 'forget_memory') {
                        const query =
                          typeof args.query === 'string' ? args.query.trim() : '';
                        const removedRes = await forgetMemoryForContext(
                          liveAuthContext,
                          query,
                          liveGuestMemories
                        );
                        if (removedRes.removed.length > 0) {
                          if (!liveAuthContext) {
                            const removedSet = new Set(removedRes.removed.map((m) => m.id));
                            liveGuestMemories = liveGuestMemories.filter((m) => !removedSet.has(m.id));
                          }
                          sendToClient({
                            type: 'memory',
                            action: 'forgotten',
                            removedIds: removedRes.removed.map((m) => m.id),
                            removed: removedRes.removed,
                          });
                        }
                        return {
                          id: call.id,
                          name: call.name,
                          response: {
                            result:
                              removedRes.removed.length > 0
                                ? `Removed ${removedRes.removed.length} matching memory item(s).`
                                : 'No matching memory found to remove.',
                          },
                        };
                      }

                      return {
                        id: call.id,
                        name: call.name,
                        response: { result: 'Completed.' },
                      };
                    })
                  );

                  const sess = await sessionPromise;
                  if (sess && !closedByClient) {
                    sess.sendToolResponse({ functionResponses: responses });
                  }
                })();
              }

              const content = message.serverContent;
              if (!content) return;

              if (content.inputTranscription?.text) {
                sendToClient({
                  type: 'inputTranscript',
                  text: content.inputTranscription.text,
                });
              }

              if (content.outputTranscription?.text) {
                sendToClient({
                  type: 'outputTranscript',
                  text: content.outputTranscription.text,
                });
              }

              for (const part of content.modelTurn?.parts ?? []) {
                if (part.inlineData?.data) {
                  sendToClient({
                    type: 'audio',
                    data: part.inlineData.data,
                  });
                }
              }

              if (content.interrupted) {
                sendToClient({ type: 'interrupted' });
              }

              if (content.turnComplete) {
                sendToClient({ type: 'turnComplete' });
              }
            },
            onerror: (err: unknown) => {
              if (closedByClient || connSeq !== activeConnSeq) return;
              const eventLike = err as {
                message?: string;
                error?: unknown;
              };
              const inner = eventLike?.error ?? err;
              const rawDetail =
                typeof eventLike?.message === 'string' && eventLike.message.trim()
                  ? eventLike.message
                  : inner instanceof Error
                    ? inner.message
                    : '';
              console.error('[Live API onerror]', rawDetail || err);
              const { message } = extractGeminiError(
                inner instanceof Error ? inner : new Error(rawDetail || 'Live voice connection encountered an error.'),
                'Live voice connection encountered an error.'
              );
              sentError = true;
              sendToClient({ type: 'error', message });
            },
            onclose: (closeEvent: unknown) => {
              // Always ignore closes from replaced/stale connections or already-closed clients
              if (closedByClient || connSeq !== activeConnSeq) return;

              const ev = closeEvent as { code?: number; reason?: string };

              if (
                latestResumptionHandle &&
                resumeCount < MAX_LIVE_RESUMES &&
                !sentError
              ) {
                isReconnecting = true;
                resumeCount += 1;
                sessionPromise = connectLiveUpstream(latestResumptionHandle);
                void sessionPromise.finally(() => {
                  isReconnecting = false;
                });
                return;
              }

              if (ev?.code && ev.code !== 1000 && ev.code !== 1005) {
                console.warn('[Live API onclose]', ev.code, ev.reason);
                if (!sentError) {
                  const rawReason = ev.reason?.trim() || 'Live voice connection closed unexpectedly.';
                  const { message } = extractGeminiError(
                    new Error(rawReason),
                    rawReason
                  );
                  sentError = true;
                  sendToClient({ type: 'error', message });
                }
              }
              sendToClient({ type: 'closed' });
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.close();
              }
            },
          },
        })
        .then((sess) => {
          connSession = sess;
          if (closedByClient || connSeq !== activeConnSeq) {
            try {
              sess.close();
            } catch {
              // Ignore close on superseded or closed upstream session
            }
            return null;
          }
          activeSession = sess;
          return sess;
        })
        .catch((err: unknown) => {
          if (closedByClient || connSeq !== activeConnSeq) {
            return null;
          }
          const { message } = extractGeminiError(
            err,
            'Could not open a live voice session.'
          );
          sentError = true;
          sendToClient({ type: 'error', message });
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close();
          }
          return null;
        });

      return promise;
    };

    let sessionPromise = connectLiveUpstream();

    clientWs.on('message', async (raw) => {
      if (closedByClient) return;
      let msg: { type?: string; data?: string; text?: string };
      try {
        msg = JSON.parse(raw.toString()) as {
          type?: string;
          data?: string;
          text?: string;
        };
      } catch {
        return;
      }

      const session = await sessionPromise;
      if (!session || closedByClient) return;

      try {
        if (
          msg.type === 'audio' &&
          typeof msg.data === 'string' &&
          msg.data.length > 0 &&
          msg.data.length <= 2 * 1024 * 1024
        ) {
          session.sendRealtimeInput({
            audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (
          msg.type === 'video' &&
          typeof msg.data === 'string' &&
          msg.data.length > 0 &&
          msg.data.length <= 2 * 1024 * 1024
        ) {
          session.sendRealtimeInput({
            video: { data: msg.data, mimeType: 'image/jpeg' },
          });
        } else if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim()) {
          session.sendRealtimeInput({ text: msg.text.trim().slice(0, 8000) });
        }
      } catch {
        // Ignore send errors on closing live session
      }
    });

    clientWs.on('close', async () => {
      closedByClient = true;
      activeConnSeq += 1;
      const session = await sessionPromise;
      try {
        session?.close();
      } catch {
        // Ignore close errors
      }
      if (activeSession && activeSession !== session) {
        try {
          activeSession.close();
        } catch {
          // Ignore close errors
        }
      }
      activeSession = null;
    });
  });

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  const distDir = path.resolve(__dirname, 'dist');

  if (!IS_PRODUCTION) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        ws: { server: httpServer },
        allowedHosts: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(
      express.static(distDir, {
        setHeaders: (res, filePath) => {
          const base = path.basename(filePath);
          if (base === 'sw.js' || base === 'registerSW.js') {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          } else if (base.endsWith('.webmanifest')) {
            res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      })
    );
    app.get('*', (_req: Request, res: Response) => {
      const indexHtmlPath = path.resolve(distDir, 'index.html');
      if (!fs.existsSync(indexHtmlPath)) {
        res
          .status(503)
          .json({ error: 'Application bundle not built. Run npm run build first.' });
        return;
      }
      res.sendFile(indexHtmlPath);
    });
  }

  httpServer.on('error', (err) => {
    console.error('Hazel HTTP server error:', err);
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Hazel chat server listening on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start Hazel server:', err);
  process.exit(1);
});
