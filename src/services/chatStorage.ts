import type {
  AppSettings,
  CategoryColor,
  ChatCategory,
  ChatSession,
  ChatSpace,
  MemoryCategory,
  MemoryItem,
  ThemeMode,
  TimerWidgetData,
} from '../types/chat';

const SESSIONS_KEY = 'hazel_chat_sessions_v1';
const CATEGORIES_KEY = 'hazel_chat_categories_v1';
const ACTIVE_SESSION_KEY = 'hazel_active_session_v1';
const ACTIVE_WORKSPACE_SESSION_KEY = 'hazel_active_workspace_session_v1';
const THEME_KEY = 'hazel_theme_v1';
const SETTINGS_KEY = 'hazel_settings_v1';
const REMINDERS_KEY = 'hazel_scheduled_reminders_v1';
const MEMORIES_KEY = 'hazel_memories_v1';

const VALID_CATEGORY_COLORS = new Set<CategoryColor>([
  'blue',
  'emerald',
  'violet',
  'amber',
  'rose',
  'cyan',
  'slate',
]);

export const DEFAULT_CATEGORIES: ChatCategory[] = [
  { id: 'cat_ml', name: 'Machine Learning', color: 'blue' },
  { id: 'cat_dl', name: 'Deep Learning', color: 'violet' },
  { id: 'cat_nlp', name: 'NLP & LLMs', color: 'emerald' },
  { id: 'cat_ai_eng', name: 'AI Engineering', color: 'amber' },
];

export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultMode: 'fast',
  defaultWebSearch: false,
  liveVoice: 'Zephyr',
  speechRate: 1.0,
  speechPitch: 1.0,
  speechVoiceURI: '',
  autoExpandThoughts: false,
  standbyEnabled: true,
  standbyRequireWakeWord: true,
  standbySpeakConfirmations: true,
  browserNotificationsEnabled: true,
  speakReminderAlerts: true,
};

export function inferSessionSpace(
  session: Pick<ChatSession, 'id' | 'space'>
): ChatSpace {
  if (session.space === 'workspace' || session.id.startsWith('ws_')) {
    return 'workspace';
  }
  return 'chat';
}

export function createNewSession(
  categoryId: string | null = null,
  space: ChatSpace = 'chat'
): ChatSession {
  const now = Date.now();
  return {
    id: generateId(space === 'workspace' ? 'ws' : 'chat'),
    space,
    title: space === 'workspace' ? 'New workspace' : 'New chat',
    pinned: false,
    categoryId: space === 'workspace' ? categoryId : null,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function loadCategories(): ChatCategory[] {
  try {
    const raw = localStorage.getItem(CATEGORIES_KEY);
    if (!raw) return DEFAULT_CATEGORIES;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_CATEGORIES;
    return parsed
      .filter(
        (c): c is ChatCategory =>
          Boolean(c) &&
          typeof c === 'object' &&
          typeof (c as ChatCategory).id === 'string' &&
          typeof (c as ChatCategory).name === 'string' &&
          (c as ChatCategory).name.trim().length > 0
      )
      .map((c) => ({
        id: c.id,
        name: c.name.trim().slice(0, 32),
        color: VALID_CATEGORY_COLORS.has(c.color) ? c.color : 'blue',
      }));
  } catch {
    return DEFAULT_CATEGORIES;
  }
}

export function saveCategories(categories: ChatCategory[]): void {
  try {
    localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories.slice(0, 30)));
  } catch {
    // Ignore storage write errors
  }
}

export function generateId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function deriveSessionTitle(firstPrompt: string): string {
  const cleaned = firstPrompt.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Untitled chat';
  if (cleaned.length <= 44) return cleaned;
  const sliced = cleaned.slice(0, 44);
  const lastSpace = sliced.lastIndexOf(' ');
  return (lastSpace > 20 ? sliced.slice(0, lastSpace) : sliced) + '…';
}

export function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (s): s is ChatSession =>
          Boolean(s) &&
          typeof s === 'object' &&
          typeof s.id === 'string' &&
          typeof s.title === 'string' &&
          Array.isArray(s.messages)
      )
      .map((s) => {
        const space = inferSessionSpace(s);
        return {
          ...s,
          space,
          pinned: Boolean(s.pinned),
          categoryId:
            space === 'workspace' && typeof s.categoryId === 'string'
              ? s.categoryId
              : null,
          messages: s.messages.map((m) => ({
            ...m,
            isStreaming: false,
            isThinking: false,
          })),
        };
      });
  } catch {
    return [];
  }
}

export function saveSessions(sessions: ChatSession[]): void {
  const clean = sessions.slice(0, 120).map((session) => ({
    ...session,
    messages: session.messages.map((msg) => ({
      ...msg,
      isStreaming: false,
      isThinking: false,
      // Avoid blowing localStorage quota with multi-MB inline PDFs/images; keep metadata + small previews
      attachments: msg.attachments?.map((att) => ({
        ...att,
        base64Data:
          att.base64Data && att.base64Data.length < 180_000
            ? att.base64Data
            : undefined,
        previewUrl:
          att.previewUrl && att.previewUrl.length < 180_000
            ? att.previewUrl
            : undefined,
      })),
    })),
  }));

  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(clean));
  } catch {
    // Fallback: strip all binary payloads if storage is still tight
    try {
      const compact = clean.slice(0, 30).map((session) => ({
        ...session,
        messages: session.messages.map((msg) => ({
          ...msg,
          attachments: msg.attachments?.map((att) => ({
            id: att.id,
            name: att.name,
            mimeType: att.mimeType,
            kind: att.kind,
            sizeBytes: att.sizeBytes,
          })),
        })),
      }));
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(compact));
    } catch {
      // Ignore storage write errors in private browsing modes
    }
  }
}

export function loadActiveSessionId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_SESSION_KEY);
  } catch {
    return null;
  }
}

export function saveActiveSessionId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_SESSION_KEY, id);
  } catch {
    // Ignore storage write errors
  }
}

export function loadActiveWorkspaceSessionId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_WORKSPACE_SESSION_KEY);
  } catch {
    return null;
  }
}

export function saveActiveWorkspaceSessionId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_WORKSPACE_SESSION_KEY, id);
  } catch {
    // Ignore storage write errors
  }
}

export function loadThemePreference(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // Ignore
  }
  if (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }
  return 'light';
}

export function saveThemePreference(theme: ThemeMode): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Ignore
  }
}

export function normalizeAppSettings(
  raw: Partial<AppSettings> | null | undefined
): AppSettings {
  const parsed = raw ?? {};
  return {
    defaultMode:
      parsed.defaultMode === 'teacher' ||
      parsed.defaultMode === 'deep' ||
      parsed.defaultMode === 'coder'
        ? parsed.defaultMode
        : 'fast',
    defaultWebSearch: Boolean(parsed.defaultWebSearch),
    liveVoice:
      parsed.liveVoice === 'Kore' ||
      parsed.liveVoice === 'Puck' ||
      parsed.liveVoice === 'Charon' ||
      parsed.liveVoice === 'Fenrir'
        ? parsed.liveVoice
        : 'Zephyr',
    speechRate:
      typeof parsed.speechRate === 'number' &&
      parsed.speechRate >= 0.5 &&
      parsed.speechRate <= 2.0
        ? parsed.speechRate
        : 1.0,
    speechPitch:
      typeof parsed.speechPitch === 'number' &&
      parsed.speechPitch >= 0.5 &&
      parsed.speechPitch <= 2.0
        ? parsed.speechPitch
        : 1.0,
    speechVoiceURI:
      typeof parsed.speechVoiceURI === 'string' ? parsed.speechVoiceURI : '',
    autoExpandThoughts: Boolean(parsed.autoExpandThoughts),
    standbyEnabled:
      typeof parsed.standbyEnabled === 'boolean'
        ? parsed.standbyEnabled
        : true,
    standbyRequireWakeWord:
      typeof parsed.standbyRequireWakeWord === 'boolean'
        ? parsed.standbyRequireWakeWord
        : true,
    standbySpeakConfirmations:
      typeof parsed.standbySpeakConfirmations === 'boolean'
        ? parsed.standbySpeakConfirmations
        : true,
    browserNotificationsEnabled:
      typeof parsed.browserNotificationsEnabled === 'boolean'
        ? parsed.browserNotificationsEnabled
        : true,
    speakReminderAlerts:
      typeof parsed.speakReminderAlerts === 'boolean'
        ? parsed.speakReminderAlerts
        : true,
  };
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_APP_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return normalizeAppSettings(parsed);
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore
  }
}

export interface StoredScheduledReminder extends TimerWidgetData {
  sessionId?: string;
}

export function loadScheduledReminders(): StoredScheduledReminder[] {
  try {
    const raw = localStorage.getItem(REMINDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (r): r is StoredScheduledReminder =>
          Boolean(r) &&
          typeof r === 'object' &&
          r.kind === 'timer' &&
          typeof r.id === 'string' &&
          typeof r.label === 'string' &&
          typeof r.durationSeconds === 'number' &&
          typeof r.createdAt === 'number'
      )
      .map((r) => ({
        ...r,
        targetTime:
          typeof r.targetTime === 'number'
            ? r.targetTime
            : r.createdAt + r.durationSeconds * 1000,
      }));
  } catch {
    return [];
  }
}

export function saveScheduledReminders(reminders: StoredScheduledReminder[]): void {
  try {
    localStorage.setItem(REMINDERS_KEY, JSON.stringify(reminders.slice(0, 40)));
  } catch {
    // Ignore
  }
}

const VALID_MEMORY_CATEGORIES = new Set<MemoryCategory>([
  'preference',
  'fact',
  'project',
  'goal',
  'person',
  'general',
]);

export function loadMemories(): MemoryItem[] {
  try {
    const raw = localStorage.getItem(MEMORIES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m): m is MemoryItem =>
          Boolean(m) &&
          typeof m === 'object' &&
          typeof (m as MemoryItem).id === 'string' &&
          typeof (m as MemoryItem).content === 'string' &&
          (m as MemoryItem).content.trim().length > 0
      )
      .map((m): MemoryItem => {
        const source: MemoryItem['source'] =
          m.source === 'user' || m.source === 'live' ? m.source : 'assistant';
        return {
          id: m.id,
          content: m.content.trim().slice(0, 500),
          category: VALID_MEMORY_CATEGORIES.has(m.category) ? m.category : 'general',
          source,
          createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
          updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : Date.now(),
        };
      })
      .slice(0, 120);
  } catch {
    return [];
  }
}

export function saveMemories(memories: MemoryItem[]): void {
  try {
    localStorage.setItem(MEMORIES_KEY, JSON.stringify(memories.slice(0, 120)));
  } catch {
    // Ignore
  }
}

