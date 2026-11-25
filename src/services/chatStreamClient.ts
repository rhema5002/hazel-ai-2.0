import type {
  AppView,
  AttachmentItem,
  ChatMessage,
  ChatWidget,
  GroundingSource,
  MemoryItem,
  ReasoningMode,
} from '../types/chat';
import { getInMemoryAccessToken } from './authClient';
import { generateId } from './chatStorage';

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'xml',
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'html',
  'htm',
  'css',
  'scss',
  'sql',
  'yaml',
  'yml',
  'toml',
  'ini',
  'env',
  'sh',
  'bash',
  'log',
  'go',
  'rs',
  'java',
  'c',
  'cpp',
  'h',
]);

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 48_000;

export async function readFileAsAttachment(file: File): Promise<AttachmentItem> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`"${file.name}" exceeds the 8 MB limit.`);
  }

  const mime = (file.type || '').toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase() || '';

  if (ALLOWED_IMAGE_TYPES.has(mime)) {
    const base64Data = await readBlobAsBase64(file);
    return {
      id: generateId('att'),
      name: file.name,
      mimeType: mime,
      kind: 'image',
      sizeBytes: file.size,
      base64Data,
      previewUrl: `data:${mime};base64,${base64Data}`,
    };
  }

  if (mime === 'application/pdf' || ext === 'pdf') {
    const base64Data = await readBlobAsBase64(file);
    return {
      id: generateId('att'),
      name: file.name,
      mimeType: 'application/pdf',
      kind: 'pdf',
      sizeBytes: file.size,
      base64Data,
    };
  }

  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/javascript' ||
    mime === 'application/typescript' ||
    TEXT_EXTENSIONS.has(ext)
  ) {
    const rawText = await file.text();
    return {
      id: generateId('att'),
      name: file.name,
      mimeType: mime || 'text/plain',
      kind: 'text',
      sizeBytes: file.size,
      textContent: rawText.slice(0, MAX_TEXT_CHARS),
    };
  }

  throw new Error(
    `Unsupported file "${file.name}". Attach images, PDFs, or text/code files.`
  );
}

function readBlobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      if (commaIdx === -1) {
        reject(new Error('Could not encode file data.'));
        return;
      }
      resolve(result.slice(commaIdx + 1));
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(blob);
  });
}

export interface MemoryStreamEvent {
  action: 'saved' | 'forgotten';
  memory?: MemoryItem;
  removedIds?: string[];
  backend?: 'supabase' | 'local' | 'guest';
  schemaMissing?: boolean;
}

export class ChatStreamHttpError extends Error {
  public readonly status: number;
  public readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ChatStreamHttpError';
    this.status = status;
    this.code = code;
  }
}

export interface StreamChatParams {
  messages: ChatMessage[];
  mode: ReasoningMode;
  webSearch: boolean;
  view?: AppView;
  skipTimerTool?: boolean;
  memories?: MemoryItem[];
  signal: AbortSignal;
  onThoughtDelta: (delta: string) => void;
  onTextDelta: (delta: string) => void;
  onSources: (sources: GroundingSource[]) => void;
  onWidget?: (widget: ChatWidget) => void;
  onMemoryEvent?: (event: MemoryStreamEvent) => void;
}

export async function streamChatResponse({
  messages,
  mode,
  webSearch,
  view = 'chat',
  skipTimerTool,
  memories,
  signal,
  onThoughtDelta,
  onTextDelta,
  onSources,
  onWidget,
  onMemoryEvent,
}: StreamChatParams): Promise<void> {
  const payloadMessages = messages
    .filter((m) => m.text.trim().length > 0 || (m.attachments && m.attachments.length > 0))
    .map((m) => ({
      role: m.role,
      text: m.text,
      attachments: m.attachments?.map((att) => ({
        name: att.name,
        mimeType: att.mimeType,
        kind: att.kind,
        base64Data: att.base64Data,
        textContent: att.textContent,
      })),
    }));

  const accessToken = getInMemoryAccessToken();
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({
      messages: payloadMessages,
      mode,
      webSearch,
      view: view === 'workspace' ? 'workspace' : 'chat',
      skipTimerTool: Boolean(skipTimerTool),
      tzOffsetMinutes: new Date().getTimezoneOffset(),
      ...(memories && memories.length > 0 ? { memories: memories.slice(0, 80) } : {}),
    }),
    signal,
  });

  if (!response.ok) {
    let errorMessage = `Request failed (${response.status}).`;
    let errorCode: string | undefined;
    try {
      const errJson = (await response.json()) as { error?: string; code?: string };
      if (errJson?.error) errorMessage = errJson.error;
      if (typeof errJson?.code === 'string') errorCode = errJson.code;
    } catch {
      // Ignore JSON parse fallback
    }
    throw new ChatStreamHttpError(errorMessage, response.status, errorCode);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Streaming response body unavailable.');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      if (!frame.trim()) continue;
      let eventName = 'message';
      const dataLines: string[] = [];

      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trim());
        }
      }

      if (dataLines.length === 0) continue;
      const rawData = dataLines.join('\n');

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rawData) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (eventName === 'thought' && typeof parsed.delta === 'string') {
        onThoughtDelta(parsed.delta);
      } else if (eventName === 'text' && typeof parsed.delta === 'string') {
        onTextDelta(parsed.delta);
      } else if (eventName === 'widget' && parsed.widget && typeof parsed.widget === 'object') {
        const w = parsed.widget as Record<string, unknown>;
        if (
          typeof w.id === 'string' &&
          (w.kind === 'timer' ||
            w.kind === 'song' ||
            w.kind === 'image' ||
            w.kind === 'video' ||
            w.kind === 'memory')
        ) {
          onWidget?.(parsed.widget as ChatWidget);
        }
      } else if (eventName === 'memory' && (parsed.action === 'saved' || parsed.action === 'forgotten')) {
        onMemoryEvent?.({
          action: parsed.action,
          memory: parsed.memory as MemoryItem | undefined,
          removedIds: Array.isArray(parsed.removedIds)
            ? (parsed.removedIds as string[])
            : undefined,
          backend: parsed.backend as 'supabase' | 'local' | 'guest' | undefined,
          schemaMissing: Boolean(parsed.schemaMissing),
        });
      } else if (eventName === 'sources' && Array.isArray(parsed.sources)) {
        const cleanSources = parsed.sources.filter(
          (s): s is GroundingSource =>
            Boolean(s) &&
            typeof s === 'object' &&
            typeof (s as GroundingSource).title === 'string' &&
            typeof (s as GroundingSource).url === 'string'
        );
        onSources(cleanSources);
      } else if (eventName === 'error') {
        const msg =
          typeof parsed.message === 'string'
            ? parsed.message
            : 'Stream interrupted by an error.';
        throw new Error(msg);
      }
    }
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
