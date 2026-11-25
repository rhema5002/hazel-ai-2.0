import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '..', '.hazel-data');
const STATE_FILE = path.resolve(DATA_DIR, 'admin-state.json');

const DEFAULT_OWNER_EMAIL = 'benjamintennyson987@gmail.com';
const MAX_AUDIT_ENTRIES = 250;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const WS_TICKET_TTL_MS = 60_000; // 60 seconds

// Ephemeral fallback signing key when SESSION_SECRET is unset (never stored in files)
const RUNTIME_SIGNING_SECRET = crypto.randomBytes(32).toString('hex');

function getSessionSecret(): string {
  const configured = process.env.SESSION_SECRET?.trim();
  return configured && configured.length >= 16 ? configured : RUNTIME_SIGNING_SECRET;
}

export type AccountRole = 'admin' | 'user';
export type AccountStatus = 'active' | 'suspended';

export interface AccountDirectoryEntry {
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
}

export interface LocalAccountRecord {
  id: string;
  email: string;
  fullName: string;
  passwordHash: string;
  createdAt: number;
}

export interface ClaimedAdminRecord {
  email: string;
  fullName: string;
  passwordHash: string;
  claimedAt: number;
}

export interface WorkspacePolicy {
  workspaceMode: 'admin_only';
  allowStandardChat: boolean;
  allowGuestChat: boolean;
  allowLiveVoiceForNonAdmin: boolean;
  updatedAt: number;
  updatedBy: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  event: string;
  actorEmail: string;
  actorRole: AccountRole | 'guest';
  target?: string;
  detail: string;
  allowed: boolean;
}

interface PersistedAdminState {
  adminEmails: string[];
  claimedAdmin: ClaimedAdminRecord | null;
  localAccounts: LocalAccountRecord[];
  accounts: Record<string, AccountDirectoryEntry>;
  policy: WorkspacePolicy;
  auditLog: AuditLogEntry[];
}

function getEnvAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAIL?.trim();
  if (!raw) return [DEFAULT_OWNER_EMAIL];
  const parsed = raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes('@'));
  return parsed.length > 0 ? parsed : [DEFAULT_OWNER_EMAIL];
}

function getPrimaryOwnerEmail(): string {
  return getEnvAdminEmails()[0] || DEFAULT_OWNER_EMAIL;
}

function createInitialState(): PersistedAdminState {
  const owners = getEnvAdminEmails();
  const now = Date.now();
  const accounts: Record<string, AccountDirectoryEntry> = {};
  for (const email of owners) {
    accounts[email] = {
      id: `owner-${crypto.createHash('sha256').update(email).digest('hex').slice(0, 12)}`,
      email,
      fullName: email.split('@')[0] || 'Admin',
      role: 'admin',
      provider: 'supabase',
      status: 'active',
      createdAt: now,
      lastLoginAt: 0,
      lastSeenAt: 0,
      signInCount: 0,
    };
  }

  return {
    adminEmails: [...owners],
    claimedAdmin: null,
    localAccounts: [],
    accounts,
    policy: {
      workspaceMode: 'admin_only',
      allowStandardChat: true,
      allowGuestChat: true,
      allowLiveVoiceForNonAdmin: true,
      updatedAt: now,
      updatedBy: owners[0] || DEFAULT_OWNER_EMAIL,
    },
    auditLog: [],
  };
}

function assertConfinedStatePath(): void {
  const resolvedDir = path.resolve(DATA_DIR);
  const resolvedFile = path.resolve(STATE_FILE);
  if (!resolvedFile.startsWith(resolvedDir + path.sep)) {
    throw new Error('Admin state path escaped data directory.');
  }
}

let cachedState: PersistedAdminState | null = null;

function loadState(): PersistedAdminState {
  if (cachedState) return cachedState;
  assertConfinedStatePath();

  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedAdminState>;
      const base = createInitialState();

      const mergedAdmins = new Set<string>(getEnvAdminEmails());
      if (Array.isArray(parsed.adminEmails)) {
        for (const e of parsed.adminEmails) {
          if (typeof e === 'string' && e.includes('@')) {
            mergedAdmins.add(e.trim().toLowerCase());
          }
        }
      }
      if (parsed.claimedAdmin?.email) {
        mergedAdmins.add(parsed.claimedAdmin.email.trim().toLowerCase());
      }

      const accounts = { ...base.accounts, ...(parsed.accounts ?? {}) };
      for (const email of mergedAdmins) {
        if (accounts[email]) {
          accounts[email] = { ...accounts[email], role: 'admin' };
        }
      }

      cachedState = {
        adminEmails: Array.from(mergedAdmins),
        claimedAdmin: parsed.claimedAdmin ?? null,
        localAccounts: Array.isArray(parsed.localAccounts) ? parsed.localAccounts : [],
        accounts,
        policy: {
          ...base.policy,
          ...(parsed.policy ?? {}),
          workspaceMode: 'admin_only',
        },
        auditLog: Array.isArray(parsed.auditLog)
          ? parsed.auditLog.slice(0, MAX_AUDIT_ENTRIES)
          : [],
      };
      return cachedState;
    }
  } catch {
    // Fall back to fresh initial state if file is unreadable/corrupt
  }

  cachedState = createInitialState();
  persistState(cachedState);
  return cachedState;
}

function persistState(state: PersistedAdminState): void {
  assertConfinedStatePath();
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
  const tmpFile = path.resolve(DATA_DIR, `admin-state.${process.pid}.${Date.now()}.tmp`);
  if (!tmpFile.startsWith(path.resolve(DATA_DIR) + path.sep)) {
    throw new Error('Invalid temp file path.');
  }
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmpFile, STATE_FILE);
  scheduleAdminSupabaseSync(state);
}

function getServiceRoleSupabaseClient() {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey || !/^https?:\/\/.+/i.test(url)) {
    return null;
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

let adminSyncTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAdminSupabaseSync(state: PersistedAdminState): void {
  const sb = getServiceRoleSupabaseClient();
  if (!sb) return;
  if (adminSyncTimer) clearTimeout(adminSyncTimer);
  adminSyncTimer = setTimeout(() => {
    adminSyncTimer = null;
    void sb
      .from('hazel_admin_state')
      .upsert(
        {
          id: 'default',
          state,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      )
      .then(
        () => {},
        () => {}
      );
  }, 400);
}

export async function hydrateAdminStateFromSupabase(): Promise<void> {
  const sb = getServiceRoleSupabaseClient();
  if (!sb) return;
  try {
    const { data, error } = await sb
      .from('hazel_admin_state')
      .select('state')
      .eq('id', 'default')
      .maybeSingle();
    if (error || !data || !data.state || typeof data.state !== 'object') {
      // Push local state up if row does not exist yet
      const current = loadState();
      await sb.from('hazel_admin_state').upsert(
        { id: 'default', state: current, updated_at: new Date().toISOString() },
        { onConflict: 'id' }
      );
      return;
    }

    const parsed = data.state as Partial<PersistedAdminState>;
    const base = createInitialState();
    const mergedAdmins = new Set<string>(getEnvAdminEmails());
    if (Array.isArray(parsed.adminEmails)) {
      for (const e of parsed.adminEmails) {
        if (typeof e === 'string' && e.includes('@')) mergedAdmins.add(e.trim().toLowerCase());
      }
    }
    if (parsed.claimedAdmin?.email) {
      mergedAdmins.add(parsed.claimedAdmin.email.trim().toLowerCase());
    }
    const accounts = { ...base.accounts, ...(parsed.accounts ?? {}) };
    for (const email of mergedAdmins) {
      if (accounts[email]) accounts[email] = { ...accounts[email], role: 'admin' };
    }
    cachedState = {
      adminEmails: Array.from(mergedAdmins),
      claimedAdmin: parsed.claimedAdmin ?? null,
      localAccounts: Array.isArray(parsed.localAccounts) ? parsed.localAccounts : [],
      accounts,
      policy: { ...base.policy, ...(parsed.policy ?? {}), workspaceMode: 'admin_only' },
      auditLog: Array.isArray(parsed.auditLog) ? parsed.auditLog.slice(0, MAX_AUDIT_ENTRIES) : [],
    };
    persistState(cachedState);
  } catch {
    // Graceful fallback to local disk state if table doesn't exist yet
  }
}

export function hashPasswordScrypt(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPasswordScrypt(password: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function verifyEnvAdminPasscode(candidate: string): boolean {
  const configured = process.env.ADMIN_PASSCODE?.trim();
  if (!configured) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(configured);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function isEnvPasscodeConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSCODE?.trim());
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const norm = email.trim().toLowerCase();
  if (!norm) return false;
  if (getEnvAdminEmails().includes(norm)) return true;
  const state = loadState();
  if (state.claimedAdmin?.email.toLowerCase() === norm) return true;
  return state.adminEmails.includes(norm);
}

export function isPrimaryOwnerEmail(email: string): boolean {
  const norm = email.trim().toLowerCase();
  return getEnvAdminEmails().includes(norm);
}

export function hasClaimedAdminOrEnvPasscode(): boolean {
  if (isEnvPasscodeConfigured()) return true;
  const state = loadState();
  return Boolean(state.claimedAdmin);
}

export function getAdminEmailsList(): string[] {
  const state = loadState();
  const merged = new Set<string>([...getEnvAdminEmails(), ...state.adminEmails]);
  if (state.claimedAdmin?.email) merged.add(state.claimedAdmin.email.toLowerCase());
  return Array.from(merged).sort();
}

export function getWorkspacePolicy(): WorkspacePolicy {
  return { ...loadState().policy };
}

export function updateWorkspacePolicy(
  updates: Partial<Pick<WorkspacePolicy, 'allowStandardChat' | 'allowGuestChat' | 'allowLiveVoiceForNonAdmin'>>,
  actorEmail: string
): WorkspacePolicy {
  const state = loadState();
  const next: WorkspacePolicy = {
    ...state.policy,
    ...(typeof updates.allowStandardChat === 'boolean'
      ? { allowStandardChat: updates.allowStandardChat }
      : {}),
    ...(typeof updates.allowGuestChat === 'boolean'
      ? { allowGuestChat: updates.allowGuestChat }
      : {}),
    ...(typeof updates.allowLiveVoiceForNonAdmin === 'boolean'
      ? { allowLiveVoiceForNonAdmin: updates.allowLiveVoiceForNonAdmin }
      : {}),
    workspaceMode: 'admin_only',
    updatedAt: Date.now(),
    updatedBy: actorEmail,
  };
  state.policy = next;
  persistState(state);
  recordAuditEvent({
    event: 'policy_updated',
    actorEmail,
    actorRole: 'admin',
    detail: `Updated access policy (Standard chat: ${next.allowStandardChat ? 'On' : 'Off'}, Guest chat: ${next.allowGuestChat ? 'On' : 'Off'}, Live voice: ${next.allowLiveVoiceForNonAdmin ? 'On' : 'Off'})`,
    allowed: true,
  });
  return { ...next };
}

export function isAccountSuspended(email: string | null | undefined): boolean {
  if (!email) return false;
  const norm = email.trim().toLowerCase();
  if (isPrimaryOwnerEmail(norm)) return false;
  const entry = loadState().accounts[norm];
  return entry?.status === 'suspended';
}

export function recordAccountActivity(params: {
  id: string;
  email: string;
  fullName: string;
  provider: 'supabase' | 'local';
  isSignIn?: boolean;
}): AccountDirectoryEntry {
  const state = loadState();
  const norm = params.email.trim().toLowerCase();
  const now = Date.now();
  const existing = state.accounts[norm];
  const role: AccountRole = isAdminEmail(norm) ? 'admin' : 'user';

  const entry: AccountDirectoryEntry = existing
    ? {
        ...existing,
        id: params.id || existing.id,
        fullName: params.fullName || existing.fullName,
        role,
        provider: params.provider,
        lastSeenAt: now,
        lastLoginAt: params.isSignIn ? now : existing.lastLoginAt,
        signInCount: params.isSignIn ? existing.signInCount + 1 : existing.signInCount,
      }
    : {
        id: params.id,
        email: norm,
        fullName: params.fullName || norm.split('@')[0] || 'User',
        role,
        provider: params.provider,
        status: 'active',
        createdAt: now,
        lastLoginAt: params.isSignIn ? now : 0,
        lastSeenAt: now,
        signInCount: params.isSignIn ? 1 : 0,
      };

  state.accounts[norm] = entry;
  persistState(state);
  return entry;
}

export function recordAuditEvent(params: {
  event: string;
  actorEmail: string;
  actorRole: AccountRole | 'guest';
  target?: string;
  detail: string;
  allowed: boolean;
}): void {
  const state = loadState();
  const entry: AuditLogEntry = {
    id: `aud-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    timestamp: Date.now(),
    event: params.event,
    actorEmail: params.actorEmail,
    actorRole: params.actorRole,
    ...(params.target ? { target: params.target } : {}),
    detail: params.detail,
    allowed: params.allowed,
  };
  state.auditLog = [entry, ...state.auditLog].slice(0, MAX_AUDIT_ENTRIES);
  persistState(state);
}

export function claimFirstRunAdmin(params: {
  email: string;
  password: string;
  fullName?: string;
}): { ok: true; admin: ClaimedAdminRecord } | { ok: false; status: number; error: string } {
  if (isEnvPasscodeConfigured()) {
    return {
      ok: false,
      status: 409,
      error: 'An administrator passcode is configured in server environment Secrets.',
    };
  }
  const state = loadState();
  if (state.claimedAdmin) {
    return {
      ok: false,
      status: 409,
      error: 'Administrator access has already been claimed on this server.',
    };
  }

  const normEmail = params.email.trim().toLowerCase();
  const fullName = params.fullName?.trim() || normEmail.split('@')[0] || 'Admin';
  const claimed: ClaimedAdminRecord = {
    email: normEmail,
    fullName,
    passwordHash: hashPasswordScrypt(params.password),
    claimedAt: Date.now(),
  };

  state.claimedAdmin = claimed;
  if (!state.adminEmails.includes(normEmail)) {
    state.adminEmails.push(normEmail);
  }

  const adminId = `admin-${crypto.createHash('sha256').update(normEmail).digest('hex').slice(0, 12)}`;
  const now = Date.now();
  state.accounts[normEmail] = {
    id: adminId,
    email: normEmail,
    fullName,
    role: 'admin',
    provider: 'local',
    status: 'active',
    createdAt: state.accounts[normEmail]?.createdAt ?? now,
    lastLoginAt: now,
    lastSeenAt: now,
    signInCount: (state.accounts[normEmail]?.signInCount ?? 0) + 1,
  };

  persistState(state);
  recordAuditEvent({
    event: 'admin_claimed',
    actorEmail: normEmail,
    actorRole: 'admin',
    detail: 'First-run administrator credential claimed.',
    allowed: true,
  });

  return { ok: true, admin: claimed };
}

export function createLocalStandardAccount(params: {
  email: string;
  password: string;
  fullName?: string;
}): { ok: true; account: LocalAccountRecord } | { ok: false; status: number; error: string } {
  const state = loadState();
  const normEmail = params.email.trim().toLowerCase();
  if (
    state.claimedAdmin?.email.toLowerCase() === normEmail ||
    isAdminEmail(normEmail) ||
    state.localAccounts.some((a) => a.email === normEmail)
  ) {
    return { ok: false, status: 409, error: 'An account with this email already exists.' };
  }

  const account: LocalAccountRecord = {
    id: `usr-${crypto.randomBytes(8).toString('hex')}`,
    email: normEmail,
    fullName: params.fullName?.trim() || normEmail.split('@')[0] || 'User',
    passwordHash: hashPasswordScrypt(params.password),
    createdAt: Date.now(),
  };

  state.localAccounts.push(account);
  persistState(state);
  recordAccountActivity({
    id: account.id,
    email: account.email,
    fullName: account.fullName,
    provider: 'local',
    isSignIn: true,
  });
  recordAuditEvent({
    event: 'account_signup',
    actorEmail: account.email,
    actorRole: 'user',
    detail: 'Created standard account (Hazel Workspace locked).',
    allowed: true,
  });

  return { ok: true, account };
}

export function authenticateLocalUser(
  email: string,
  password: string
): {
  ok: true;
  user: { id: string; email: string; fullName: string; role: AccountRole; createdAt: string };
} | { ok: false; status: number; error: string } {
  const state = loadState();
  const normEmail = email.trim().toLowerCase();

  // 1. Check ADMIN_PASSCODE env override when email is an admin email
  if (isEnvPasscodeConfigured() && isAdminEmail(normEmail)) {
    if (verifyEnvAdminPasscode(password)) {
      const id = `admin-${crypto.createHash('sha256').update(normEmail).digest('hex').slice(0, 12)}`;
      const existing = state.accounts[normEmail];
      const fullName = existing?.fullName || normEmail.split('@')[0] || 'Admin';
      recordAccountActivity({
        id,
        email: normEmail,
        fullName,
        provider: 'local',
        isSignIn: true,
      });
      return {
        ok: true,
        user: {
          id,
          email: normEmail,
          fullName,
          role: 'admin',
          createdAt: new Date(existing?.createdAt ?? Date.now()).toISOString(),
        },
      };
    }
    return { ok: false, status: 401, error: 'Incorrect email or password.' };
  }

  // 2. Check claimed first-run admin
  if (state.claimedAdmin && state.claimedAdmin.email.toLowerCase() === normEmail) {
    if (!verifyPasswordScrypt(password, state.claimedAdmin.passwordHash)) {
      return { ok: false, status: 401, error: 'Incorrect email or password.' };
    }
    const id = `admin-${crypto.createHash('sha256').update(normEmail).digest('hex').slice(0, 12)}`;
    recordAccountActivity({
      id,
      email: normEmail,
      fullName: state.claimedAdmin.fullName,
      provider: 'local',
      isSignIn: true,
    });
    return {
      ok: true,
      user: {
        id,
        email: normEmail,
        fullName: state.claimedAdmin.fullName,
        role: 'admin',
        createdAt: new Date(state.claimedAdmin.claimedAt).toISOString(),
      },
    };
  }

  // 3. Check local standard accounts
  const localUser = state.localAccounts.find((a) => a.email === normEmail);
  if (localUser) {
    if (!verifyPasswordScrypt(password, localUser.passwordHash)) {
      return { ok: false, status: 401, error: 'Incorrect email or password.' };
    }
    if (isAccountSuspended(normEmail)) {
      return {
        ok: false,
        status: 403,
        error: 'This account has been suspended by an administrator.',
      };
    }
    const role: AccountRole = isAdminEmail(normEmail) ? 'admin' : 'user';
    recordAccountActivity({
      id: localUser.id,
      email: localUser.email,
      fullName: localUser.fullName,
      provider: 'local',
      isSignIn: true,
    });
    return {
      ok: true,
      user: {
        id: localUser.id,
        email: localUser.email,
        fullName: localUser.fullName,
        role,
        createdAt: new Date(localUser.createdAt).toISOString(),
      },
    };
  }

  return { ok: false, status: 401, error: 'Incorrect email or password.' };
}

export interface LocalSessionPayload {
  id: string;
  email: string;
  fullName: string;
  iat: number;
  exp: number;
}

export function signLocalSessionToken(user: {
  id: string;
  email: string;
  fullName: string;
}): { token: string; expiresAt: number } {
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  const payload: LocalSessionPayload = {
    id: user.id,
    email: user.email.trim().toLowerCase(),
    fullName: user.fullName,
    iat: now,
    exp: expiresAt,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  return { token: `hl1.${encoded}.${sig}`, expiresAt: Math.floor(expiresAt / 1000) };
}

export function verifyLocalSessionToken(token: string): LocalSessionPayload | null {
  if (!token || !token.startsWith('hl1.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, encoded, sig] = parts;
  if (!encoded || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as LocalSessionPayload;
    if (!payload?.email || typeof payload.exp !== 'number' || Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

// Short-lived one-time WebSocket tickets for authenticated /api/live upgrades
const wsTickets = new Map<
  string,
  {
    id: string;
    email: string;
    fullName: string;
    role: AccountRole;
    isAdmin: boolean;
    workspaceAccess: boolean;
    provider: 'supabase' | 'local';
    supabaseAccessToken?: string;
    expiresAt: number;
  }
>();

const guestWsTickets = new Map<
  string,
  {
    memories: unknown[];
    expiresAt: number;
  }
>();

export function issueWsTicket(user: {
  id: string;
  email: string;
  fullName: string;
  role: AccountRole;
  isAdmin: boolean;
  workspaceAccess: boolean;
  provider: 'supabase' | 'local';
  supabaseAccessToken?: string;
}): string {
  const now = Date.now();
  for (const [key, val] of wsTickets.entries()) {
    if (val.expiresAt <= now) wsTickets.delete(key);
  }
  const ticket = crypto.randomBytes(24).toString('base64url');
  wsTickets.set(ticket, {
    ...user,
    expiresAt: now + WS_TICKET_TTL_MS,
  });
  return ticket;
}

export function consumeWsTicket(ticket: string | null | undefined) {
  if (!ticket) return null;
  const entry = wsTickets.get(ticket);
  if (!entry) return null;
  wsTickets.delete(ticket);
  if (Date.now() > entry.expiresAt) return null;
  return entry;
}

export function issueGuestWsTicket(memories: unknown[]): string {
  const now = Date.now();
  for (const [key, val] of guestWsTickets.entries()) {
    if (val.expiresAt <= now) guestWsTickets.delete(key);
  }
  const ticket = crypto.randomBytes(24).toString('base64url');
  guestWsTickets.set(ticket, {
    memories: memories.slice(0, 80),
    expiresAt: now + WS_TICKET_TTL_MS,
  });
  return ticket;
}

export function consumeGuestWsTicket(ticket: string | null | undefined): unknown[] {
  if (!ticket) return [];
  const entry = guestWsTickets.get(ticket);
  if (!entry) return [];
  guestWsTickets.delete(ticket);
  if (Date.now() > entry.expiresAt) return [];
  return entry.memories;
}

export function grantAdminRole(
  targetEmail: string,
  actorEmail: string
): { ok: true } | { ok: false; status: number; error: string } {
  const norm = targetEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(norm)) {
    return { ok: false, status: 400, error: 'Please enter a valid email address.' };
  }
  const state = loadState();
  if (isAdminEmail(norm)) {
    return { ok: false, status: 409, error: 'That email already has administrator access.' };
  }

  state.adminEmails.push(norm);
  if (state.accounts[norm]) {
    state.accounts[norm] = { ...state.accounts[norm], role: 'admin', status: 'active' };
  } else {
    const now = Date.now();
    state.accounts[norm] = {
      id: `adm-${crypto.createHash('sha256').update(norm).digest('hex').slice(0, 12)}`,
      email: norm,
      fullName: norm.split('@')[0] || 'Admin',
      role: 'admin',
      provider: 'supabase',
      status: 'active',
      createdAt: now,
      lastLoginAt: 0,
      lastSeenAt: 0,
      signInCount: 0,
    };
  }

  persistState(state);
  recordAuditEvent({
    event: 'admin_granted',
    actorEmail,
    actorRole: 'admin',
    target: norm,
    detail: `Granted administrator & Hazel Workspace access to ${norm}.`,
    allowed: true,
  });
  return { ok: true };
}

export function revokeAdminRole(
  targetEmail: string,
  actorEmail: string
): { ok: true } | { ok: false; status: number; error: string } {
  const norm = targetEmail.trim().toLowerCase();
  if (norm === actorEmail.trim().toLowerCase()) {
    return { ok: false, status: 400, error: 'You cannot revoke your own administrator role.' };
  }
  if (isPrimaryOwnerEmail(norm)) {
    return {
      ok: false,
      status: 400,
      error: 'The primary owner administrator cannot be removed.',
    };
  }
  const state = loadState();
  if (!state.adminEmails.includes(norm) && state.claimedAdmin?.email.toLowerCase() !== norm) {
    return { ok: false, status: 404, error: 'Administrator email not found.' };
  }
  if (state.claimedAdmin?.email.toLowerCase() === norm) {
    return {
      ok: false,
      status: 400,
      error: 'The claimed local administrator account cannot be demoted.',
    };
  }

  state.adminEmails = state.adminEmails.filter((e) => e !== norm);
  if (state.accounts[norm]) {
    state.accounts[norm] = { ...state.accounts[norm], role: 'user' };
  }

  persistState(state);
  recordAuditEvent({
    event: 'admin_revoked',
    actorEmail,
    actorRole: 'admin',
    target: norm,
    detail: `Revoked administrator access from ${norm} (Hazel Workspace now locked).`,
    allowed: true,
  });
  return { ok: true };
}

export function setAccountStatus(
  targetEmail: string,
  status: AccountStatus,
  actorEmail: string
): { ok: true; account: AccountDirectoryEntry } | { ok: false; status: number; error: string } {
  const norm = targetEmail.trim().toLowerCase();
  if (norm === actorEmail.trim().toLowerCase()) {
    return { ok: false, status: 400, error: 'You cannot suspend your own active session.' };
  }
  if (isPrimaryOwnerEmail(norm)) {
    return { ok: false, status: 400, error: 'The primary owner account cannot be suspended.' };
  }
  const state = loadState();
  const existing = state.accounts[norm];
  if (!existing) {
    return { ok: false, status: 404, error: 'Account not found in directory.' };
  }

  const updated: AccountDirectoryEntry = { ...existing, status };
  state.accounts[norm] = updated;
  persistState(state);
  recordAuditEvent({
    event: status === 'suspended' ? 'account_suspended' : 'account_reactivated',
    actorEmail,
    actorRole: 'admin',
    target: norm,
    detail: `${status === 'suspended' ? 'Suspended' : 'Reactivated'} account ${norm}.`,
    allowed: true,
  });
  return { ok: true, account: updated };
}

export function clearNonCriticalAuditLog(actorEmail: string): void {
  const state = loadState();
  state.auditLog = [];
  persistState(state);
  recordAuditEvent({
    event: 'audit_cleared',
    actorEmail,
    actorRole: 'admin',
    detail: 'Administrator cleared previous security audit log entries.',
    allowed: true,
  });
}

export function getAdminOverviewSnapshot() {
  const state = loadState();
  const adminSet = new Set(getAdminEmailsList());
  const accounts = Object.values(state.accounts)
    .map((acc) => {
      const isAccAdmin = adminSet.has(acc.email.toLowerCase());
      return {
        ...acc,
        role: (isAccAdmin ? 'admin' : 'user') as AccountRole,
        workspaceLocked: !isAccAdmin || acc.status === 'suspended',
        isPrimaryOwner: isPrimaryOwnerEmail(acc.email),
      };
    })
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
      return (b.lastSeenAt || b.createdAt) - (a.lastSeenAt || a.createdAt);
    });

  const blockedAttempts = state.auditLog.filter((e) => !e.allowed).length;

  return {
    primaryOwnerEmail: getPrimaryOwnerEmail(),
    adminEmails: Array.from(adminSet),
    accounts,
    policy: state.policy,
    auditLog: state.auditLog,
    stats: {
      totalAccounts: accounts.length,
      adminCount: accounts.filter((a) => a.role === 'admin').length,
      lockedAccountsCount: accounts.filter((a) => a.workspaceLocked).length,
      blockedAttempts,
    },
    envAdminConfigured: Boolean(process.env.ADMIN_EMAIL?.trim()),
    envPasscodeConfigured: isEnvPasscodeConfigured(),
    adminClaimed: Boolean(state.claimedAdmin),
  };
}
