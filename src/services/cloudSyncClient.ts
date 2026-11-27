import type {
  AppSettings,
  ChatCategory,
  ChatSession,
  MemoryCategory,
  MemoryItem,
  ThemeMode,
} from '../types/chat';
import { getInMemoryAccessToken } from './authClient';
import type { StoredScheduledReminder } from './chatStorage';

export type SyncBackend = 'supabase' | 'local' | 'guest';

export interface CloudStateSnapshot {
  theme: ThemeMode;
  activeSessionId: string | null;
  activeWorkspaceSessionId?: string | null;
  settings: Partial<AppSettings>;
  categories: ChatCategory[];
  sessions: ChatSession[];
  scheduledReminders: StoredScheduledReminder[];
  memories: MemoryItem[];
}

export interface FetchCloudStateResult {
  backend: 'supabase' | 'local';
  schemaMissing: boolean;
  schemaSql?: string;
  hasCloudData: boolean;
  snapshot: CloudStateSnapshot;
}

export interface SaveCloudStateResult {
  ok: boolean;
  backend: 'supabase' | 'local';
  schemaMissing: boolean;
  schemaSql?: string;
  syncedAt: number;
}

function buildAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'XMLHttpRequest',
    ...(extra ?? {}),
  };
  const token = getInMemoryAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function parseErr(response: Response, fallback: string): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    if (typeof data?.error === 'string' && data.error.trim()) {
      return data.error.trim();
    }
  } catch {
    // Ignore parse error
  }
  return fallback;
}

export async function fetchCloudState(): Promise<FetchCloudStateResult> {
  const response = await fetch('/api/sync/state', {
    method: 'GET',
    credentials: 'same-origin',
    headers: buildAuthHeaders(),
  });
  if (!response.ok) {
    throw new Error(await parseErr(response, 'Unable to load saved cloud data.'));
  }
  return (await response.json()) as FetchCloudStateResult;
}

export async function saveCloudState(
  payload: Partial<CloudStateSnapshot>
): Promise<SaveCloudStateResult> {
  const response = await fetch('/api/sync/state', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await parseErr(response, 'Unable to sync data to cloud.'));
  }
  return (await response.json()) as SaveCloudStateResult;
}

export async function createCloudMemory(params: {
  content: string;
  category?: MemoryCategory;
  source?: 'user' | 'assistant' | 'live';
}): Promise<{
  memory: MemoryItem;
  backend: 'supabase' | 'local';
  schemaMissing: boolean;
  schemaSql?: string;
}> {
  const response = await fetch('/api/memories', {
    method: 'POST',
    credentials: 'same-origin',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    throw new Error(await parseErr(response, 'Unable to save memory.'));
  }
  return (await response.json()) as {
    memory: MemoryItem;
    backend: 'supabase' | 'local';
    schemaMissing: boolean;
    schemaSql?: string;
  };
}

export async function deleteCloudMemory(
  id: string
): Promise<{ ok: boolean; backend: 'supabase' | 'local'; schemaMissing: boolean }> {
  const response = await fetch(`/api/memories/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: buildAuthHeaders(),
  });
  if (!response.ok) {
    throw new Error(await parseErr(response, 'Unable to delete memory.'));
  }
  return (await response.json()) as {
    ok: boolean;
    backend: 'supabase' | 'local';
    schemaMissing: boolean;
  };
}

export async function clearCloudMemories(): Promise<{
  ok: boolean;
  backend: 'supabase' | 'local';
  schemaMissing: boolean;
}> {
  const response = await fetch('/api/memories', {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: buildAuthHeaders(),
  });
  if (!response.ok) {
    throw new Error(await parseErr(response, 'Unable to clear memories.'));
  }
  return (await response.json()) as {
    ok: boolean;
    backend: 'supabase' | 'local';
    schemaMissing: boolean;
  };
}
