import type { MemoryItem } from '../types/chat';

export type AccountRole = 'admin' | 'user';
export type AccountStatus = 'active' | 'suspended';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
  createdAt?: string;
  role: AccountRole;
  isAdmin: boolean;
  workspaceAccess: boolean;
  provider: 'supabase' | 'local';
}

export interface AuthSessionResult {
  configured: boolean;
  localAuthAvailable: boolean;
  adminClaimed: boolean;
  adminBootstrapAvailable: boolean;
  user: AuthUser | null;
}

export interface SignUpResult {
  user: AuthUser;
  requiresEmailConfirmation: boolean;
}

export interface AdminAccountEntry {
  id: string;
  email: string;
  fullName: string;
  role: AccountRole;
  provider: 'supabase' | 'local';
  status: AccountStatus;
  createdAt: number;
  lastLoginAt: number;
  lastSeenAt: number;
  signInCount: number;
  workspaceLocked: boolean;
  isPrimaryOwner: boolean;
}

export interface WorkspacePolicy {
  workspaceMode: 'admin_only';
  allowStandardChat: boolean;
  allowGuestChat: boolean;
  allowLiveVoiceForNonAdmin: boolean;
  updatedAt: number;
  updatedBy: string;
}

export interface AdminAuditEntry {
  id: string;
  timestamp: number;
  event: string;
  actorEmail: string;
  actorRole: AccountRole | 'guest';
  target?: string;
  detail: string;
  allowed: boolean;
}

export interface AdminOverviewData {
  primaryOwnerEmail: string;
  currentAdminEmail?: string;
  adminEmails: string[];
  accounts: AdminAccountEntry[];
  policy: WorkspacePolicy;
  auditLog: AdminAuditEntry[];
  stats: {
    totalAccounts: number;
    adminCount: number;
    lockedAccountsCount: number;
    blockedAttempts: number;
  };
  envAdminConfigured: boolean;
  envPasscodeConfigured: boolean;
  adminClaimed: boolean;
  aiConfigured?: boolean;
  supabaseConfigured?: boolean;
}

// Keep any bearer token strictly in memory — never in localStorage or sessionStorage.
let inMemoryAccessToken: string | null = null;

const AUTH_REQUEST_TIMEOUT_MS = 15_000;

export function getInMemoryAccessToken(): string | null {
  return inMemoryAccessToken;
}

function buildAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'XMLHttpRequest',
    ...(extra ?? {}),
  };
  if (inMemoryAccessToken) {
    headers.Authorization = `Bearer ${inMemoryAccessToken}`;
  }
  return headers;
}

export class AuthSessionTransientError extends Error {
  readonly isTransient = true;

  constructor(message: string) {
    super(message);
    this.name = 'AuthSessionTransientError';
  }
}

export function isTransientAuthError(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === 'object' &&
      'isTransient' in err &&
      (err as { isTransient?: unknown }).isTransient === true
  );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new AuthSessionTransientError(
        'Sign-in request timed out. Please check your connection and try again.'
      );
    }
    throw new AuthSessionTransientError(
      'Unable to reach the server right now. Please try again.'
    );
  } finally {
    window.clearTimeout(timer);
  }
}

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  const statusLabel = response.status ? ` (HTTP ${response.status})` : '';
  try {
    const rawText = await response.text();
    if (!rawText) return `${fallback}${statusLabel}`;
    try {
      const data = JSON.parse(rawText) as { error?: string; message?: string };
      if (typeof data?.error === 'string' && data.error.trim()) return data.error.trim();
      if (typeof data?.message === 'string' && data.message.trim()) return data.message.trim();
    } catch {
      const trimmed = rawText.trim();
      if (trimmed && !trimmed.startsWith('<')) {
        return trimmed.slice(0, 220);
      }
    }
  } catch {
    // Ignore body read error
  }
  return `${fallback}${statusLabel}`;
}

async function parseJsonPayload<T>(response: Response, fallbackError: string): Promise<T> {
  const rawText = await response.text();
  if (!rawText) {
    throw new Error(`${fallbackError} (empty server response)`);
  }
  try {
    return JSON.parse(rawText) as T;
  } catch {
    throw new Error(
      `Unexpected server response (HTTP ${response.status}). Please refresh the page and try again.`
    );
  }
}

async function requestAuthSessionOnce(): Promise<AuthSessionResult> {
  const response = await fetchWithTimeout('/api/auth/session', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    const msg = await parseErrorMessage(response, 'Unable to check authentication session.');
    if (response.status >= 500 || response.status === 429 || response.status === 408) {
      throw new AuthSessionTransientError(msg);
    }
    throw new Error(msg);
  }

  const data = await parseJsonPayload<{
    configured?: boolean;
    localAuthAvailable?: boolean;
    adminClaimed?: boolean;
    adminBootstrapAvailable?: boolean;
    user?: AuthUser | null;
    accessToken?: string;
    transient?: boolean;
  }>(response, 'Unable to verify authentication session.');

  if (data.transient) {
    throw new AuthSessionTransientError('Temporary authentication check issue.');
  }

  if (typeof data.accessToken === 'string' && data.accessToken) {
    inMemoryAccessToken = data.accessToken;
  } else if (!data.user) {
    inMemoryAccessToken = null;
  }

  return {
    configured: Boolean(data.configured),
    localAuthAvailable: Boolean(data.localAuthAvailable ?? true),
    adminClaimed: Boolean(data.adminClaimed),
    adminBootstrapAvailable: Boolean(data.adminBootstrapAvailable),
    user: data.user ?? null,
  };
}

export async function fetchAuthSession(): Promise<AuthSessionResult> {
  try {
    return await requestAuthSessionOnce();
  } catch (err) {
    if (!isTransientAuthError(err)) {
      throw err;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    return await requestAuthSessionOnce();
  }
}

export async function signInWithEmail(email: string, password: string): Promise<AuthUser> {
  const response = await fetchWithTimeout('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Could not sign in.'));
  }

  const data = await parseJsonPayload<{ user?: AuthUser; accessToken?: string }>(
    response,
    'Could not sign in.'
  );
  if (!data?.user || typeof data.user.email !== 'string') {
    throw new Error('Sign-in did not return a valid user session.');
  }
  inMemoryAccessToken = typeof data.accessToken === 'string' ? data.accessToken : null;
  return data.user;
}

export async function signUpWithEmail(
  email: string,
  password: string,
  fullName: string
): Promise<SignUpResult> {
  const response = await fetchWithTimeout('/api/auth/signup', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email, password, fullName }),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Could not create account.'));
  }

  const data = await parseJsonPayload<{
    user?: AuthUser;
    accessToken?: string;
    requiresEmailConfirmation?: boolean;
  }>(response, 'Could not create account.');
  if (!data?.user || typeof data.user.email !== 'string') {
    throw new Error('Account creation did not return a valid user profile.');
  }
  inMemoryAccessToken = typeof data.accessToken === 'string' ? data.accessToken : null;

  return {
    user: data.user,
    requiresEmailConfirmation: Boolean(data.requiresEmailConfirmation),
  };
}

export async function claimAdminAccount(
  email: string,
  password: string,
  fullName: string
): Promise<AuthUser> {
  const response = await fetchWithTimeout('/api/auth/admin-bootstrap', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email, password, fullName }),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Could not claim administrator access.'));
  }

  const data = await parseJsonPayload<{ user?: AuthUser; accessToken?: string }>(
    response,
    'Could not claim administrator access.'
  );
  if (!data?.user || typeof data.user.email !== 'string') {
    throw new Error('Administrator claim did not return a valid user session.');
  }
  inMemoryAccessToken = typeof data.accessToken === 'string' ? data.accessToken : null;
  return data.user;
}

export async function requestPasswordReset(email: string): Promise<string> {
  const response = await fetchWithTimeout('/api/auth/reset-password', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Could not send reset email.'));
  }

  const data = await parseJsonPayload<{ message?: string }>(
    response,
    'Could not send reset email.'
  );
  return (
    data.message ||
    'If an account exists for that email, a password reset link has been sent.'
  );
}

export async function exchangeAuthCallback(params: {
  accessToken?: string;
  refreshToken?: string;
  code?: string;
}): Promise<AuthUser> {
  const response = await fetchWithTimeout('/api/auth/session-exchange', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Could not verify authentication link.'));
  }

  const data = await parseJsonPayload<{ user?: AuthUser; accessToken?: string }>(
    response,
    'Could not verify authentication link.'
  );
  if (!data?.user || typeof data.user.email !== 'string') {
    throw new Error('Authentication callback did not return a valid user session.');
  }
  inMemoryAccessToken = typeof data.accessToken === 'string' ? data.accessToken : null;
  return data.user;
}

export async function updateAccountPassword(password: string): Promise<void> {
  const response = await fetchWithTimeout('/api/auth/update-password', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ password }),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Could not update password.'));
  }
}

export async function fetchLiveTicket(guestMemories?: MemoryItem[]): Promise<string | null> {
  try {
    const hasGuestMemories = Array.isArray(guestMemories) && guestMemories.length > 0;
    const response = await fetchWithTimeout('/api/auth/live-ticket', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: buildAuthHeaders(
        hasGuestMemories ? { 'Content-Type': 'application/json' } : undefined
      ),
      ...(hasGuestMemories
        ? { body: JSON.stringify({ memories: guestMemories.slice(0, 80) }) }
        : {}),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { ticket?: string | null };
    return typeof data.ticket === 'string' && data.ticket ? data.ticket : null;
  } catch {
    return null;
  }
}

export async function signOutSession(): Promise<void> {
  inMemoryAccessToken = null;
  await fetchWithTimeout('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: buildAuthHeaders(),
  });
}

export async function fetchAdminOverview(): Promise<AdminOverviewData> {
  const response = await fetchWithTimeout('/api/admin/overview', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: buildAuthHeaders(),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Unable to load Admin Panel data.'));
  }
  return await parseJsonPayload<AdminOverviewData>(response, 'Unable to load Admin Panel data.');
}

export async function grantAdminEmail(email: string): Promise<AdminOverviewData> {
  const response = await fetchWithTimeout('/api/admin/admins', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Could not grant admin access.'));
  }
  return await parseJsonPayload<AdminOverviewData>(response, 'Could not grant admin access.');
}

export async function revokeAdminEmail(email: string): Promise<AdminOverviewData> {
  const response = await fetchWithTimeout(`/api/admin/admins/${encodeURIComponent(email)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: buildAuthHeaders(),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Could not revoke admin access.'));
  }
  return await parseJsonPayload<AdminOverviewData>(response, 'Could not revoke admin access.');
}

export async function updateAccountStatus(
  email: string,
  status: AccountStatus
): Promise<AdminOverviewData> {
  const response = await fetchWithTimeout(`/api/admin/accounts/${encodeURIComponent(email)}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ status }),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Could not update account status.'));
  }
  return await parseJsonPayload<AdminOverviewData>(response, 'Could not update account status.');
}

export async function updateWorkspacePolicySettings(
  updates: Partial<Pick<WorkspacePolicy, 'allowStandardChat' | 'allowGuestChat' | 'allowLiveVoiceForNonAdmin'>>
): Promise<AdminOverviewData> {
  const response = await fetchWithTimeout('/api/admin/policy', {
    method: 'PATCH',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(updates),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Could not update access policy.'));
  }
  return await parseJsonPayload<AdminOverviewData>(response, 'Could not update access policy.');
}

export async function clearAdminAuditLog(): Promise<AdminOverviewData> {
  const response = await fetchWithTimeout('/api/admin/audit', {
    method: 'DELETE',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: buildAuthHeaders(),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Could not clear audit log.'));
  }
  return await parseJsonPayload<AdminOverviewData>(response, 'Could not clear audit log.');
}
