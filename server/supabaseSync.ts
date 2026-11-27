import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  resolveRequestAuthContext,
  verifySameOrigin,
  type RequestAuthContext,
} from './supabaseAuth.ts';
import { getSupabaseSchemaSql } from './supabaseSchemaSql.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USER_DATA_DIR = path.resolve(__dirname, '..', '.hazel-data', 'user-data');

export type MemoryCategory =
  | 'preference'
  | 'fact'
  | 'project'
  | 'goal'
  | 'person'
  | 'general';

export interface SyncedMemoryItem {
  id: string;
  content: string;
  category: MemoryCategory;
  source: 'assistant' | 'user' | 'live';
  createdAt: number;
  updatedAt: number;
}

export interface SyncedCategory {
  id: string;
  name: string;
  color: string;
}

export interface SyncedSession {
  id: string;
  space?: 'chat' | 'workspace';
  title: string;
  pinned: boolean;
  categoryId?: string | null;
  createdAt: number;
  updatedAt: number;
  messages: Array<Record<string, unknown>>;
}

export interface SyncedReminder {
  kind: 'timer';
  id: string;
  sessionId?: string;
  label: string;
  durationSeconds: number;
  createdAt: number;
  targetTime: number;
  isReminder?: boolean;
  reminderNote?: string;
}

export interface UserCloudSnapshot {
  theme: 'light' | 'dark';
  activeSessionId: string | null;
  activeWorkspaceSessionId: string | null;
  settings: Record<string, unknown>;
  categories: SyncedCategory[];
  sessions: SyncedSession[];
  scheduledReminders: SyncedReminder[];
  memories: SyncedMemoryItem[];
}

const WORKSPACE_ACTIVE_SETTING_KEY = '__activeWorkspaceSessionId';

function splitSettingsMetadata(raw: unknown): {
  cleanSettings: Record<string, unknown>;
  activeWorkspaceSessionId: string | null;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { cleanSettings: {}, activeWorkspaceSessionId: null };
  }
  const source = raw as Record<string, unknown>;
  const cleanSettings: Record<string, unknown> = {};
  let activeWorkspaceSessionId: string | null = null;
  for (const [k, v] of Object.entries(source)) {
    if (k === WORKSPACE_ACTIVE_SETTING_KEY) {
      if (typeof v === 'string' && v.trim()) {
        activeWorkspaceSessionId = v.trim().slice(0, 80);
      }
      continue;
    }
    cleanSettings[k] = v;
  }
  return { cleanSettings, activeWorkspaceSessionId };
}

const VALID_MEMORY_CATEGORIES = new Set<MemoryCategory>([
  'preference',
  'fact',
  'project',
  'goal',
  'person',
  'general',
]);

const VALID_CATEGORY_COLORS = new Set([
  'blue',
  'emerald',
  'violet',
  'amber',
  'rose',
  'cyan',
  'slate',
]);

const MAX_SESSIONS = 120;
const MAX_MESSAGES_PER_SESSION = 1000;
const MAX_CATEGORIES = 30;
const MAX_REMINDERS = 40;
const MAX_MEMORIES = 120;

function isSchemaMissingError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const rec = err as { code?: string; message?: string; details?: string; hint?: string };
  const code = String(rec.code || '').toUpperCase();
  if (code === '42P01' || code === 'PGRST205') return true;
  const text = `${rec.message || ''} ${rec.details || ''} ${rec.hint || ''}`.toLowerCase();
  return (
    text.includes('does not exist') ||
    text.includes('could not find the table') ||
    text.includes('schema cache')
  );
}

function getUserFilePath(userId: string): string {
  const hash = crypto.createHash('sha256').update(userId).digest('hex');
  const resolvedDir = path.resolve(USER_DATA_DIR);
  const targetFile = path.resolve(resolvedDir, `${hash}.json`);
  if (!targetFile.startsWith(resolvedDir + path.sep)) {
    throw new Error('User snapshot path escaped confined directory.');
  }
  return targetFile;
}

function createEmptySnapshot(): UserCloudSnapshot {
  return {
    theme: 'light',
    activeSessionId: null,
    activeWorkspaceSessionId: null,
    settings: {},
    categories: [],
    sessions: [],
    scheduledReminders: [],
    memories: [],
  };
}

function readLocalUserSnapshot(userId: string): {
  snapshot: UserCloudSnapshot;
  exists: boolean;
} {
  try {
    const file = getUserFilePath(userId);
    if (!fs.existsSync(file)) {
      return { snapshot: createEmptySnapshot(), exists: false };
    }
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<UserCloudSnapshot>;
    const { cleanSettings, activeWorkspaceSessionId: embeddedWsId } =
      splitSettingsMetadata(parsed.settings);
    return {
      exists: true,
      snapshot: {
        theme: parsed.theme === 'dark' ? 'dark' : 'light',
        activeSessionId:
          typeof parsed.activeSessionId === 'string' ? parsed.activeSessionId : null,
        activeWorkspaceSessionId:
          typeof parsed.activeWorkspaceSessionId === 'string'
            ? parsed.activeWorkspaceSessionId
            : embeddedWsId,
        settings: cleanSettings,
        categories: sanitizeCategories(parsed.categories),
        sessions: sanitizeSessions(parsed.sessions),
        scheduledReminders: sanitizeReminders(parsed.scheduledReminders),
        memories: sanitizeMemories(parsed.memories),
      },
    };
  } catch {
    return { snapshot: createEmptySnapshot(), exists: false };
  }
}

function writeLocalUserSnapshot(userId: string, snapshot: UserCloudSnapshot): void {
  const file = getUserFilePath(userId);
  if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true, mode: 0o700 });
  }
  const tmp = path.resolve(
    USER_DATA_DIR,
    `${path.basename(file)}.${process.pid}.${Date.now()}.tmp`
  );
  if (!tmp.startsWith(path.resolve(USER_DATA_DIR) + path.sep)) {
    throw new Error('Invalid temp user snapshot path.');
  }
  fs.writeFileSync(tmp, JSON.stringify(snapshot), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function sanitizeCategories(raw: unknown): SyncedCategory[] {
  if (!Array.isArray(raw)) return [];
  const out: SyncedCategory[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === 'string' ? rec.id.trim().slice(0, 80) : '';
    const name = typeof rec.name === 'string' ? rec.name.trim().slice(0, 32) : '';
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const color =
      typeof rec.color === 'string' && VALID_CATEGORY_COLORS.has(rec.color)
        ? rec.color
        : 'blue';
    out.push({ id, name, color });
    if (out.length >= MAX_CATEGORIES) break;
  }
  return out;
}

function sanitizeMessage(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const id = typeof rec.id === 'string' ? rec.id.trim().slice(0, 80) : '';
  const role = rec.role === 'user' || rec.role === 'assistant' ? rec.role : null;
  if (!id || !role) return null;

  const text = typeof rec.text === 'string' ? rec.text.slice(0, 1_000_000) : '';
  const thoughts =
    typeof rec.thoughts === 'string' && rec.thoughts.length > 0
      ? rec.thoughts.slice(0, 250_000)
      : undefined;

  let attachments: Array<Record<string, unknown>> | undefined;
  if (Array.isArray(rec.attachments) && rec.attachments.length > 0) {
    attachments = rec.attachments
      .slice(0, 12)
      .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === 'object')
      .map((a) => ({
        id: typeof a.id === 'string' ? a.id.slice(0, 80) : '',
        name: typeof a.name === 'string' ? a.name.slice(0, 120) : 'attachment',
        mimeType: typeof a.mimeType === 'string' ? a.mimeType.slice(0, 80) : 'text/plain',
        kind: a.kind === 'image' || a.kind === 'pdf' ? a.kind : 'text',
        sizeBytes: typeof a.sizeBytes === 'number' ? a.sizeBytes : 0,
        ...(typeof a.textContent === 'string'
          ? { textContent: a.textContent.slice(0, 250_000) }
          : {}),
        ...(typeof a.base64Data === 'string' && a.base64Data.length <= 180_000
          ? { base64Data: a.base64Data }
          : {}),
        ...(typeof a.previewUrl === 'string' && a.previewUrl.length <= 180_000
          ? { previewUrl: a.previewUrl }
          : {}),
      }));
  }

  return {
    id,
    role,
    text,
    ...(thoughts !== undefined ? { thoughts } : {}),
    ...(Array.isArray(rec.sources) ? { sources: rec.sources.slice(0, 20) } : {}),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
    ...(Array.isArray(rec.widgets) ? { widgets: rec.widgets.slice(0, 16) } : {}),
    createdAt: typeof rec.createdAt === 'number' ? rec.createdAt : Date.now(),
    ...(typeof rec.mode === 'string' ? { mode: rec.mode } : {}),
    ...(typeof rec.webSearch === 'boolean' ? { webSearch: rec.webSearch } : {}),
    isStreaming: false,
    isThinking: false,
    ...(typeof rec.error === 'string' ? { error: rec.error.slice(0, 500) } : {}),
    ...(rec.feedback === 'up' || rec.feedback === 'down'
      ? { feedback: rec.feedback }
      : {}),
  };
}

function sanitizeSessions(raw: unknown): SyncedSession[] {
  if (!Array.isArray(raw)) return [];
  const out: SyncedSession[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === 'string' ? rec.id.trim().slice(0, 80) : '';
    const title = typeof rec.title === 'string' ? rec.title.slice(0, 120) : 'New chat';
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const rawMsgs = Array.isArray(rec.messages) ? rec.messages : [];
    const messages = rawMsgs
      .slice(-MAX_MESSAGES_PER_SESSION)
      .map(sanitizeMessage)
      .filter((m): m is Record<string, unknown> => m !== null);

    const space: 'chat' | 'workspace' =
      rec.space === 'workspace' || id.startsWith('ws_') ? 'workspace' : 'chat';

    out.push({
      id,
      space,
      title: title || (space === 'workspace' ? 'New workspace' : 'New chat'),
      pinned: Boolean(rec.pinned),
      categoryId:
        space === 'workspace' && typeof rec.categoryId === 'string' && rec.categoryId.trim()
          ? rec.categoryId.trim().slice(0, 80)
          : null,
      createdAt: typeof rec.createdAt === 'number' ? rec.createdAt : Date.now(),
      updatedAt: typeof rec.updatedAt === 'number' ? rec.updatedAt : Date.now(),
      messages,
    });
    if (out.length >= MAX_SESSIONS) break;
  }
  return out;
}

function sanitizeReminders(raw: unknown): SyncedReminder[] {
  if (!Array.isArray(raw)) return [];
  const out: SyncedReminder[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === 'string' ? rec.id.trim().slice(0, 80) : '';
    const label = typeof rec.label === 'string' ? rec.label.trim().slice(0, 120) : '';
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    const createdAt = typeof rec.createdAt === 'number' ? rec.createdAt : Date.now();
    const durationSeconds =
      typeof rec.durationSeconds === 'number' && Number.isFinite(rec.durationSeconds)
        ? Math.max(1, Math.min(86400, Math.round(rec.durationSeconds)))
        : 60;
    const targetTime =
      typeof rec.targetTime === 'number' && Number.isFinite(rec.targetTime)
        ? rec.targetTime
        : createdAt + durationSeconds * 1000;

    out.push({
      kind: 'timer',
      id,
      ...(typeof rec.sessionId === 'string' && rec.sessionId.trim()
        ? { sessionId: rec.sessionId.trim().slice(0, 80) }
        : {}),
      label,
      durationSeconds,
      createdAt,
      targetTime,
      isReminder: Boolean(rec.isReminder),
      ...(typeof rec.reminderNote === 'string' && rec.reminderNote.trim()
        ? { reminderNote: rec.reminderNote.trim().slice(0, 240) }
        : {}),
    });
    if (out.length >= MAX_REMINDERS) break;
  }
  return out;
}

export function sanitizeMemories(raw: unknown): SyncedMemoryItem[] {
  if (!Array.isArray(raw)) return [];
  const out: SyncedMemoryItem[] = [];
  const seenIds = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === 'string' ? rec.id.trim().slice(0, 80) : '';
    const content =
      typeof rec.content === 'string'
        ? rec.content.replace(/\s+/g, ' ').trim().slice(0, 500)
        : '';
    if (!id || !content || seenIds.has(id)) continue;
    seenIds.add(id);
    const category: MemoryCategory =
      typeof rec.category === 'string' &&
      VALID_MEMORY_CATEGORIES.has(rec.category as MemoryCategory)
        ? (rec.category as MemoryCategory)
        : 'general';
    const source: 'assistant' | 'user' | 'live' =
      rec.source === 'user' || rec.source === 'live' ? rec.source : 'assistant';
    const now = Date.now();
    out.push({
      id,
      content,
      category,
      source,
      createdAt: typeof rec.createdAt === 'number' ? rec.createdAt : now,
      updatedAt: typeof rec.updatedAt === 'number' ? rec.updatedAt : now,
    });
    if (out.length >= MAX_MEMORIES) break;
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function formatMemoriesPromptBlock(memories: SyncedMemoryItem[]): string {
  if (!memories.length) return '';
  const lines = memories.slice(0, 80).map((m) => `- [${m.category}] ${m.content}`);
  return [
    '<saved_memories>',
    'Things the user previously asked you to remember across conversations:',
    ...lines,
    '</saved_memories>',
  ].join('\n');
}

function makeMemoryId(): string {
  return `mem_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

export async function loadMemoriesForContext(
  ctx: RequestAuthContext | null
): Promise<{
  memories: SyncedMemoryItem[];
  backend: 'supabase' | 'local' | 'guest';
  schemaMissing: boolean;
}> {
  if (!ctx) {
    return { memories: [], backend: 'guest', schemaMissing: false };
  }

  if (ctx.supabase && ctx.user.provider === 'supabase') {
    const { data, error } = await ctx.supabase
      .from('hazel_memories')
      .select('id, content, category, source, created_at, updated_at')
      .eq('user_id', ctx.user.id)
      .order('updated_at', { ascending: false })
      .limit(MAX_MEMORIES);

    if (!error && Array.isArray(data)) {
      const mapped = data.map((row) => ({
        id: String(row.id),
        content: String(row.content),
        category: VALID_MEMORY_CATEGORIES.has(row.category as MemoryCategory)
          ? (row.category as MemoryCategory)
          : 'general',
        source: (row.source === 'user' || row.source === 'live'
          ? row.source
          : 'assistant') as 'assistant' | 'user' | 'live',
        createdAt: Number(row.created_at) || Date.now(),
        updatedAt: Number(row.updated_at) || Date.now(),
      }));
      return { memories: mapped, backend: 'supabase', schemaMissing: false };
    }

    const schemaMissing = isSchemaMissingError(error);
    const local = readLocalUserSnapshot(ctx.user.id);
    return {
      memories: local.snapshot.memories,
      backend: 'local',
      schemaMissing,
    };
  }

  const local = readLocalUserSnapshot(ctx.user.id);
  return {
    memories: local.snapshot.memories,
    backend: 'local',
    schemaMissing: false,
  };
}

export async function saveMemoryForContext(
  ctx: RequestAuthContext | null,
  input: {
    content: string;
    category?: string;
    source?: 'assistant' | 'user' | 'live';
  },
  guestMemories: SyncedMemoryItem[] = []
): Promise<{
  memory: SyncedMemoryItem;
  backend: 'supabase' | 'local' | 'guest';
  schemaMissing: boolean;
}> {
  const cleanContent = input.content.replace(/\s+/g, ' ').trim().slice(0, 500);
  const category: MemoryCategory =
    input.category && VALID_MEMORY_CATEGORIES.has(input.category as MemoryCategory)
      ? (input.category as MemoryCategory)
      : 'general';
  const source: 'assistant' | 'user' | 'live' =
    input.source === 'user' || input.source === 'live' ? input.source : 'assistant';
  const now = Date.now();

  if (!ctx) {
    const normIncoming = cleanContent.toLowerCase();
    const existingGuest = guestMemories.find(
      (m) => m.content.trim().toLowerCase() === normIncoming
    );
    return {
      memory: {
        id: existingGuest ? existingGuest.id : makeMemoryId(),
        content: cleanContent,
        category,
        source,
        createdAt: existingGuest ? existingGuest.createdAt : now,
        updatedAt: now,
      },
      backend: 'guest',
      schemaMissing: false,
    };
  }

  const existingLoad = await loadMemoriesForContext(ctx);
  const normIncoming = cleanContent.toLowerCase();
  const existingMatch = existingLoad.memories.find(
    (m) => m.content.trim().toLowerCase() === normIncoming
  );

  const item: SyncedMemoryItem = existingMatch
    ? {
        ...existingMatch,
        content: cleanContent,
        category,
        source,
        updatedAt: now,
      }
    : {
        id: makeMemoryId(),
        content: cleanContent,
        category,
        source,
        createdAt: now,
        updatedAt: now,
      };

  // Always update local snapshot cache for signed-in user as reliable fallback
  const local = readLocalUserSnapshot(ctx.user.id);
  const nextLocalMemories = [
    item,
    ...local.snapshot.memories.filter((m) => m.id !== item.id),
  ].slice(0, MAX_MEMORIES);
  writeLocalUserSnapshot(ctx.user.id, {
    ...local.snapshot,
    memories: nextLocalMemories,
  });

  if (ctx.supabase && ctx.user.provider === 'supabase') {
    const { error } = await ctx.supabase.from('hazel_memories').upsert(
      {
        user_id: ctx.user.id,
        id: item.id,
        content: item.content,
        category: item.category,
        source: item.source,
        created_at: item.createdAt,
        updated_at: item.updatedAt,
      },
      { onConflict: 'user_id,id' }
    );

    if (!error) {
      return { memory: item, backend: 'supabase', schemaMissing: false };
    }
    return {
      memory: item,
      backend: 'local',
      schemaMissing: isSchemaMissingError(error),
    };
  }

  return { memory: item, backend: 'local', schemaMissing: false };
}

export async function forgetMemoryForContext(
  ctx: RequestAuthContext | null,
  query: string,
  guestMemories: SyncedMemoryItem[] = []
): Promise<{
  removed: SyncedMemoryItem[];
  backend: 'supabase' | 'local' | 'guest';
  schemaMissing: boolean;
}> {
  const q = query.trim().toLowerCase();
  if (!q) {
    return {
      removed: [],
      backend: ctx ? 'local' : 'guest',
      schemaMissing: false,
    };
  }

  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  const matches = (m: SyncedMemoryItem) => {
    const text = m.content.toLowerCase();
    if (text.includes(q)) return true;
    if (tokens.length > 0) {
      return tokens.every((tok) => text.includes(tok));
    }
    return false;
  };

  if (!ctx) {
    return {
      removed: guestMemories.filter(matches),
      backend: 'guest',
      schemaMissing: false,
    };
  }

  const loaded = await loadMemoriesForContext(ctx);
  const matched = loaded.memories.filter(matches);
  const matchedIds = matched.map((m) => m.id);

  // Update local cache
  if (matchedIds.length > 0) {
    const matchedSet = new Set(matchedIds);
    const local = readLocalUserSnapshot(ctx.user.id);
    writeLocalUserSnapshot(ctx.user.id, {
      ...local.snapshot,
      memories: local.snapshot.memories.filter((m) => !matchedSet.has(m.id)),
    });
  }

  if (matchedIds.length > 0 && ctx.supabase && ctx.user.provider === 'supabase') {
    const { error } = await ctx.supabase
      .from('hazel_memories')
      .delete()
      .eq('user_id', ctx.user.id)
      .in('id', matchedIds);

    if (!error) {
      return { removed: matched, backend: 'supabase', schemaMissing: false };
    }
    return {
      removed: matched,
      backend: 'local',
      schemaMissing: isSchemaMissingError(error),
    };
  }

  return {
    removed: matched,
    backend: loaded.backend,
    schemaMissing: loaded.schemaMissing,
  };
}

async function fetchFullCloudSnapshot(ctx: RequestAuthContext): Promise<{
  snapshot: UserCloudSnapshot;
  hasCloudData: boolean;
  backend: 'supabase' | 'local';
  schemaMissing: boolean;
}> {
  if (ctx.supabase && ctx.user.provider === 'supabase') {
    const [stateRes, catsRes, sessRes, remRes, memRes] = await Promise.all([
      ctx.supabase
        .from('hazel_user_state')
        .select('theme, active_session_id, settings')
        .eq('user_id', ctx.user.id)
        .maybeSingle(),
      ctx.supabase
        .from('hazel_categories')
        .select('id, name, color, sort_order')
        .eq('user_id', ctx.user.id)
        .order('sort_order', { ascending: true }),
      ctx.supabase
        .from('hazel_sessions')
        .select('id, title, pinned, category_id, messages, created_at, updated_at')
        .eq('user_id', ctx.user.id)
        .order('updated_at', { ascending: false })
        .limit(MAX_SESSIONS),
      ctx.supabase
        .from('hazel_reminders')
        .select('id, session_id, label, duration_seconds, created_at, target_time, is_reminder, reminder_note')
        .eq('user_id', ctx.user.id),
      ctx.supabase
        .from('hazel_memories')
        .select('id, content, category, source, created_at, updated_at')
        .eq('user_id', ctx.user.id)
        .order('updated_at', { ascending: false })
        .limit(MAX_MEMORIES),
    ]);

    const firstError =
      stateRes.error || catsRes.error || sessRes.error || remRes.error || memRes.error;

    if (!firstError) {
      const stateRow = stateRes.data;
      const categories = sanitizeCategories(catsRes.data ?? []);
      const sessions = sanitizeSessions(
        (sessRes.data ?? []).map((row) => ({
          id: row.id,
          title: row.title,
          pinned: row.pinned,
          categoryId: row.category_id,
          messages: row.messages,
          createdAt: Number(row.created_at),
          updatedAt: Number(row.updated_at),
        }))
      );
      const scheduledReminders = sanitizeReminders(
        (remRes.data ?? []).map((row) => ({
          kind: 'timer',
          id: row.id,
          sessionId: row.session_id,
          label: row.label,
          durationSeconds: row.duration_seconds,
          createdAt: Number(row.created_at),
          targetTime: Number(row.target_time),
          isReminder: row.is_reminder,
          reminderNote: row.reminder_note,
        }))
      );
      const memories = sanitizeMemories(
        (memRes.data ?? []).map((row) => ({
          id: row.id,
          content: row.content,
          category: row.category,
          source: row.source,
          createdAt: Number(row.created_at),
          updatedAt: Number(row.updated_at),
        }))
      );

      const hasCloudData =
        Boolean(stateRow) ||
        sessions.length > 0 ||
        categories.length > 0 ||
        scheduledReminders.length > 0 ||
        memories.length > 0;

      const { cleanSettings, activeWorkspaceSessionId } = splitSettingsMetadata(
        stateRow?.settings
      );

      const snapshot: UserCloudSnapshot = {
        theme: stateRow?.theme === 'dark' ? 'dark' : 'light',
        activeSessionId:
          typeof stateRow?.active_session_id === 'string'
            ? stateRow.active_session_id
            : null,
        activeWorkspaceSessionId,
        settings: cleanSettings,
        categories,
        sessions,
        scheduledReminders,
        memories,
      };

      if (hasCloudData) {
        writeLocalUserSnapshot(ctx.user.id, snapshot);
      }

      return {
        snapshot,
        hasCloudData,
        backend: 'supabase',
        schemaMissing: false,
      };
    }

    const schemaMissing = isSchemaMissingError(firstError);
    const local = readLocalUserSnapshot(ctx.user.id);
    return {
      snapshot: local.snapshot,
      hasCloudData: local.exists,
      backend: 'local',
      schemaMissing,
    };
  }

  const local = readLocalUserSnapshot(ctx.user.id);
  return {
    snapshot: local.snapshot,
    hasCloudData: local.exists,
    backend: 'local',
    schemaMissing: false,
  };
}

async function saveFullOrPartialSnapshot(
  ctx: RequestAuthContext,
  payload: Record<string, unknown>
): Promise<{
  backend: 'supabase' | 'local';
  schemaMissing: boolean;
  syncedAt: number;
}> {
  const localExisting = readLocalUserSnapshot(ctx.user.id).snapshot;

  const hasTheme = payload.theme === 'light' || payload.theme === 'dark';
  const hasActiveSessionId =
    payload.activeSessionId === null || typeof payload.activeSessionId === 'string';
  const hasActiveWorkspaceSessionId =
    payload.activeWorkspaceSessionId === null ||
    typeof payload.activeWorkspaceSessionId === 'string';
  const hasSettings =
    Boolean(payload.settings) &&
    typeof payload.settings === 'object' &&
    !Array.isArray(payload.settings);
  const hasCategories = Array.isArray(payload.categories);
  const hasSessions = Array.isArray(payload.sessions);
  const hasReminders = Array.isArray(payload.scheduledReminders);
  const hasMemories = Array.isArray(payload.memories);

  const cleanIncomingSettings = hasSettings
    ? splitSettingsMetadata(payload.settings).cleanSettings
    : localExisting.settings;

  const nextActiveWorkspaceSessionId = hasActiveWorkspaceSessionId
    ? typeof payload.activeWorkspaceSessionId === 'string'
      ? payload.activeWorkspaceSessionId.trim().slice(0, 80) || null
      : null
    : localExisting.activeWorkspaceSessionId;

  const nextSnapshot: UserCloudSnapshot = {
    theme: hasTheme ? (payload.theme as 'light' | 'dark') : localExisting.theme,
    activeSessionId: hasActiveSessionId
      ? (payload.activeSessionId as string | null)
      : localExisting.activeSessionId,
    activeWorkspaceSessionId: nextActiveWorkspaceSessionId,
    settings: cleanIncomingSettings,
    categories: hasCategories
      ? sanitizeCategories(payload.categories)
      : localExisting.categories,
    sessions: hasSessions
      ? sanitizeSessions(payload.sessions)
      : localExisting.sessions,
    scheduledReminders: hasReminders
      ? sanitizeReminders(payload.scheduledReminders)
      : localExisting.scheduledReminders,
    memories: hasMemories
      ? sanitizeMemories(payload.memories)
      : localExisting.memories,
  };

  writeLocalUserSnapshot(ctx.user.id, nextSnapshot);
  const syncedAt = Date.now();

  if (!ctx.supabase || ctx.user.provider !== 'supabase') {
    return { backend: 'local', schemaMissing: false, syncedAt };
  }

  const sb = ctx.supabase;
  const userId = ctx.user.id;
  let schemaMissing = false;

  // 1. User state (theme, active_session_id, settings + workspace active session ID)
  if (hasTheme || hasActiveSessionId || hasActiveWorkspaceSessionId || hasSettings) {
    const persistedSettings: Record<string, unknown> = {
      ...nextSnapshot.settings,
      ...(nextSnapshot.activeWorkspaceSessionId
        ? { [WORKSPACE_ACTIVE_SETTING_KEY]: nextSnapshot.activeWorkspaceSessionId }
        : {}),
    };
    const { error } = await sb.from('hazel_user_state').upsert(
      {
        user_id: userId,
        theme: nextSnapshot.theme,
        active_session_id: nextSnapshot.activeSessionId,
        settings: persistedSettings,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
    if (error) {
      if (isSchemaMissingError(error)) schemaMissing = true;
      return { backend: 'local', schemaMissing, syncedAt };
    }
  }

  // 2. Categories (upsert + prune deleted)
  if (hasCategories) {
    if (nextSnapshot.categories.length > 0) {
      const rows = nextSnapshot.categories.map((c, idx) => ({
        user_id: userId,
        id: c.id,
        name: c.name,
        color: c.color,
        sort_order: idx,
        updated_at: syncedAt,
      }));
      const { error } = await sb
        .from('hazel_categories')
        .upsert(rows, { onConflict: 'user_id,id' });
      if (error) {
        if (isSchemaMissingError(error)) schemaMissing = true;
        return { backend: 'local', schemaMissing, syncedAt };
      }
    }

    const { data: existingCats } = await sb
      .from('hazel_categories')
      .select('id')
      .eq('user_id', userId);
    if (Array.isArray(existingCats)) {
      const keepIds = new Set(nextSnapshot.categories.map((c) => c.id));
      const toDelete = existingCats
        .map((r) => String(r.id))
        .filter((id) => !keepIds.has(id));
      if (toDelete.length > 0) {
        await sb
          .from('hazel_categories')
          .delete()
          .eq('user_id', userId)
          .in('id', toDelete);
      }
    }
  }

  // 3. Sessions (upsert + prune deleted)
  if (hasSessions) {
    if (nextSnapshot.sessions.length > 0) {
      const rows = nextSnapshot.sessions.map((s) => ({
        user_id: userId,
        id: s.id,
        title: s.title,
        pinned: s.pinned,
        category_id: s.categoryId ?? null,
        messages: s.messages,
        created_at: s.createdAt,
        updated_at: s.updatedAt,
      }));
      const { error } = await sb
        .from('hazel_sessions')
        .upsert(rows, { onConflict: 'user_id,id' });
      if (error) {
        if (isSchemaMissingError(error)) schemaMissing = true;
        return { backend: 'local', schemaMissing, syncedAt };
      }
    }

    const { data: existingSessions } = await sb
      .from('hazel_sessions')
      .select('id')
      .eq('user_id', userId);
    if (Array.isArray(existingSessions)) {
      const keepIds = new Set(nextSnapshot.sessions.map((s) => s.id));
      const toDelete = existingSessions
        .map((r) => String(r.id))
        .filter((id) => !keepIds.has(id));
      if (toDelete.length > 0) {
        await sb
          .from('hazel_sessions')
          .delete()
          .eq('user_id', userId)
          .in('id', toDelete);
      }
    }
  }

  // 4. Scheduled reminders (upsert + prune deleted/expired)
  if (hasReminders) {
    if (nextSnapshot.scheduledReminders.length > 0) {
      const rows = nextSnapshot.scheduledReminders.map((r) => ({
        user_id: userId,
        id: r.id,
        session_id: r.sessionId ?? null,
        label: r.label,
        duration_seconds: r.durationSeconds,
        created_at: r.createdAt,
        target_time: r.targetTime,
        is_reminder: Boolean(r.isReminder),
        reminder_note: r.reminderNote ?? null,
      }));
      const { error } = await sb
        .from('hazel_reminders')
        .upsert(rows, { onConflict: 'user_id,id' });
      if (error) {
        if (isSchemaMissingError(error)) schemaMissing = true;
        return { backend: 'local', schemaMissing, syncedAt };
      }
    }

    const { data: existingRems } = await sb
      .from('hazel_reminders')
      .select('id')
      .eq('user_id', userId);
    if (Array.isArray(existingRems)) {
      const keepIds = new Set(nextSnapshot.scheduledReminders.map((r) => r.id));
      const toDelete = existingRems
        .map((r) => String(r.id))
        .filter((id) => !keepIds.has(id));
      if (toDelete.length > 0) {
        await sb
          .from('hazel_reminders')
          .delete()
          .eq('user_id', userId)
          .in('id', toDelete);
      }
    }
  }

  // 5. Memories (if included in snapshot sync, e.g. initial guest-to-account migration)
  if (hasMemories && nextSnapshot.memories.length > 0) {
    const rows = nextSnapshot.memories.map((m) => ({
      user_id: userId,
      id: m.id,
      content: m.content,
      category: m.category,
      source: m.source,
      created_at: m.createdAt,
      updated_at: m.updatedAt,
    }));
    const { error } = await sb
      .from('hazel_memories')
      .upsert(rows, { onConflict: 'user_id,id' });
    if (error) {
      if (isSchemaMissingError(error)) schemaMissing = true;
      return { backend: 'local', schemaMissing, syncedAt };
    }
  }

  return { backend: 'supabase', schemaMissing: false, syncedAt };
}

export function registerSupabaseSyncRoutes(app: Express): void {
  app.get('/api/sync/state', async (req: Request, res: Response) => {
    const ctx = await resolveRequestAuthContext(req, res);
    if (!ctx) {
      res.status(401).json({ error: 'Authentication required to load cloud state.' });
      return;
    }

    const result = await fetchFullCloudSnapshot(ctx);
    res.json({
      backend: result.backend,
      schemaMissing: result.schemaMissing,
      ...(result.schemaMissing ? { schemaSql: getSupabaseSchemaSql() } : {}),
      hasCloudData: result.hasCloudData,
      snapshot: result.snapshot,
    });
  });

  app.put('/api/sync/state', async (req: Request, res: Response) => {
    if (!verifySameOrigin(req, res)) return;
    const ctx = await resolveRequestAuthContext(req, res);
    if (!ctx) {
      res.status(401).json({ error: 'Authentication required to save cloud state.' });
      return;
    }

    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'Invalid sync payload.' });
      return;
    }

    const result = await saveFullOrPartialSnapshot(ctx, body as Record<string, unknown>);
    res.json({
      ok: true,
      backend: result.backend,
      schemaMissing: result.schemaMissing,
      ...(result.schemaMissing ? { schemaSql: getSupabaseSchemaSql() } : {}),
      syncedAt: result.syncedAt,
    });
  });

  app.get('/api/memories', async (req: Request, res: Response) => {
    const ctx = await resolveRequestAuthContext(req, res);
    if (!ctx) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const result = await loadMemoriesForContext(ctx);
    res.json({
      memories: result.memories,
      backend: result.backend,
      schemaMissing: result.schemaMissing,
      ...(result.schemaMissing ? { schemaSql: getSupabaseSchemaSql() } : {}),
    });
  });

  app.post('/api/memories', async (req: Request, res: Response) => {
    if (!verifySameOrigin(req, res)) return;
    const ctx = await resolveRequestAuthContext(req, res);
    if (!ctx) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const content =
      typeof body.content === 'string'
        ? body.content.replace(/\s+/g, ' ').trim().slice(0, 500)
        : '';
    if (!content) {
      res.status(400).json({ error: 'Memory content cannot be empty.' });
      return;
    }
    const category = typeof body.category === 'string' ? body.category : 'general';
    const source =
      body.source === 'assistant' || body.source === 'live' ? body.source : 'user';

    const saved = await saveMemoryForContext(ctx, { content, category, source });
    res.status(201).json({
      memory: saved.memory,
      backend: saved.backend,
      schemaMissing: saved.schemaMissing,
      ...(saved.schemaMissing ? { schemaSql: getSupabaseSchemaSql() } : {}),
    });
  });

  app.delete('/api/memories/:id', async (req: Request, res: Response) => {
    if (!verifySameOrigin(req, res)) return;
    const ctx = await resolveRequestAuthContext(req, res);
    if (!ctx) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const targetId = String(req.params.id || '').trim().slice(0, 80);
    if (!targetId) {
      res.status(400).json({ error: 'Memory ID is required.' });
      return;
    }

    const local = readLocalUserSnapshot(ctx.user.id);
    writeLocalUserSnapshot(ctx.user.id, {
      ...local.snapshot,
      memories: local.snapshot.memories.filter((m) => m.id !== targetId),
    });

    if (ctx.supabase && ctx.user.provider === 'supabase') {
      const { error } = await ctx.supabase
        .from('hazel_memories')
        .delete()
        .eq('user_id', ctx.user.id)
        .eq('id', targetId);
      if (error) {
        res.json({
          ok: true,
          backend: 'local',
          schemaMissing: isSchemaMissingError(error),
        });
        return;
      }
      res.json({ ok: true, backend: 'supabase', schemaMissing: false });
      return;
    }

    res.json({ ok: true, backend: 'local', schemaMissing: false });
  });

  app.delete('/api/memories', async (req: Request, res: Response) => {
    if (!verifySameOrigin(req, res)) return;
    const ctx = await resolveRequestAuthContext(req, res);
    if (!ctx) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const local = readLocalUserSnapshot(ctx.user.id);
    writeLocalUserSnapshot(ctx.user.id, {
      ...local.snapshot,
      memories: [],
    });

    if (ctx.supabase && ctx.user.provider === 'supabase') {
      const { error } = await ctx.supabase
        .from('hazel_memories')
        .delete()
        .eq('user_id', ctx.user.id);
      if (error) {
        res.json({
          ok: true,
          backend: 'local',
          schemaMissing: isSchemaMissingError(error),
        });
        return;
      }
      res.json({ ok: true, backend: 'supabase', schemaMissing: false });
      return;
    }

    res.json({ ok: true, backend: 'local', schemaMissing: false });
  });
}
