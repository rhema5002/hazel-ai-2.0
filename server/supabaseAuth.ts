import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { Express, Request, Response } from 'express';
import type { IncomingHttpHeaders } from 'http';
import {
  authenticateLocalUser,
  claimFirstRunAdmin,
  consumeWsTicket,
  createLocalStandardAccount,
  hasClaimedAdminOrEnvPasscode,
  isAccountSuspended,
  isAdminEmail,
  issueGuestWsTicket,
  issueWsTicket,
  recordAccountActivity,
  recordAuditEvent,
  signLocalSessionToken,
  verifyLocalSessionToken,
  type AccountRole,
} from './adminStore.ts';

const ACCESS_COOKIE_NAME = 'hazel_sb_at';
const REFRESH_COOKIE_NAME = 'hazel_sb_rt';
const LOCAL_COOKIE_NAME = 'hazel_local_at';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface AuthUserDTO {
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

export function isSupabaseConfigured(): boolean {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return false;
  return /^https?:\/\/.+/i.test(url);
}

function createStatelessSupabaseClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !key || !/^https?:\/\/.+/i.test(url)) {
    return null;
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function createAuthenticatedSupabaseClient(
  accessToken: string
): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !key || !accessToken || !/^https?:\/\/.+/i.test(url)) {
    return null;
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export interface RequestAuthContext {
  user: AuthUserDTO;
  supabase: SupabaseClient | null;
  supabaseAccessToken: string | null;
}

function buildAuthUserDTO(params: {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
  createdAt?: string;
  provider: 'supabase' | 'local';
}): AuthUserDTO {
  const email = params.email.trim().toLowerCase();
  const isAdmin = isAdminEmail(email) && !isAccountSuspended(email);
  return {
    id: params.id,
    email,
    fullName: params.fullName,
    ...(params.avatarUrl ? { avatarUrl: params.avatarUrl } : {}),
    ...(params.createdAt ? { createdAt: params.createdAt } : {}),
    role: isAdmin ? 'admin' : 'user',
    isAdmin,
    workspaceAccess: isAdmin,
    provider: params.provider,
  };
}

function mapSupabaseUser(user: User): AuthUserDTO {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const rawName =
    typeof meta.full_name === 'string' && meta.full_name.trim()
      ? meta.full_name.trim()
      : typeof meta.name === 'string' && meta.name.trim()
        ? meta.name.trim()
        : user.email?.split('@')[0] || 'User';
  const avatarUrl =
    typeof meta.avatar_url === 'string' && /^https?:\/\//i.test(meta.avatar_url)
      ? meta.avatar_url
      : undefined;

  return buildAuthUserDTO({
    id: user.id,
    email: user.email || '',
    fullName: rawName,
    avatarUrl,
    createdAt: user.created_at,
    provider: 'supabase',
  });
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const rawVal = part.slice(eqIdx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(rawVal);
    } catch {
      out[key] = rawVal;
    }
  }
  return out;
}

function isHttpsRequest(req: Request): boolean {
  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  if (forwardedProto) return forwardedProto === 'https';
  if (req.get('x-forwarded-ssl')?.trim().toLowerCase() === 'on') return true;
  if (req.secure) return true;
  const origin = req.get('origin')?.trim().toLowerCase();
  if (origin && origin.startsWith('https://')) return true;
  const referer = req.get('referer')?.trim().toLowerCase();
  if (referer && referer.startsWith('https://')) return true;
  const appUrl = process.env.APP_URL?.trim().toLowerCase();
  if (process.env.NODE_ENV === 'production' && appUrl?.startsWith('https://')) return true;
  return false;
}

function serializeCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
  isHttps: boolean
): string {
  const segments = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (isHttps) {
    segments.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    segments.push('SameSite=Lax');
  }
  return segments.join('; ');
}

function setAuthCookies(req: Request, res: Response, session: Session): void {
  const isHttps = isHttpsRequest(req);
  const accessTtl =
    typeof session.expires_in === 'number' && session.expires_in > 0
      ? session.expires_in
      : 3600;
  const cookies = [
    serializeCookie(ACCESS_COOKIE_NAME, session.access_token, accessTtl, isHttps),
    serializeCookie(LOCAL_COOKIE_NAME, '', 0, isHttps),
  ];
  if (session.refresh_token) {
    cookies.push(
      serializeCookie(REFRESH_COOKIE_NAME, session.refresh_token, 60 * 60 * 24 * 7, isHttps)
    );
  }
  res.setHeader('Set-Cookie', cookies);
}

function setLocalAuthCookie(req: Request, res: Response, token: string): void {
  const isHttps = isHttpsRequest(req);
  res.setHeader('Set-Cookie', [
    serializeCookie(LOCAL_COOKIE_NAME, token, 60 * 60 * 24 * 7, isHttps),
    serializeCookie(ACCESS_COOKIE_NAME, '', 0, isHttps),
    serializeCookie(REFRESH_COOKIE_NAME, '', 0, isHttps),
  ]);
}

function clearAuthCookies(req: Request, res: Response): void {
  const isHttps = isHttpsRequest(req);
  res.setHeader('Set-Cookie', [
    serializeCookie(ACCESS_COOKIE_NAME, '', 0, isHttps),
    serializeCookie(REFRESH_COOKIE_NAME, '', 0, isHttps),
    serializeCookie(LOCAL_COOKIE_NAME, '', 0, isHttps),
  ]);
}

function normalizeHostValue(rawHost: string | undefined): string {
  if (!rawHost) return '';
  return rawHost
    .trim()
    .toLowerCase()
    .replace(/:(80|443)$/, '');
}

function getAllowedHostnames(req: Request): Set<string> {
  const hosts = new Set<string>();
  const forwardedHosts = req.get('x-forwarded-host');
  if (forwardedHosts) {
    for (const part of forwardedHosts.split(',')) {
      const normalized = normalizeHostValue(part);
      if (normalized) hosts.add(normalized);
    }
  }
  const hostHeader = normalizeHostValue(req.get('host'));
  if (hostHeader) hosts.add(hostHeader);

  const appUrl = process.env.APP_URL?.trim();
  if (appUrl && /^https?:\/\//i.test(appUrl) && appUrl !== 'MY_APP_URL') {
    try {
      const normalized = normalizeHostValue(new URL(appUrl).host);
      if (normalized) hosts.add(normalized);
    } catch {
      // Ignore malformed APP_URL
    }
  }
  return hosts;
}

export function verifySameOrigin(req: Request, res: Response): boolean {
  const fetchSite = req.get('sec-fetch-site')?.trim().toLowerCase();
  if (fetchSite === 'cross-site') {
    res.status(403).json({ error: 'Cross-site requests are not allowed.' });
    return false;
  }

  const originHeader = req.get('origin')?.trim();
  const allowedHosts = getAllowedHostnames(req);

  if (originHeader) {
    try {
      const originHost = normalizeHostValue(new URL(originHeader).host);
      if (allowedHosts.has(originHost)) {
        return true;
      }

      // Behind Cloud Run / reverse proxies, internal Host may be rewritten while
      // Sec-Fetch-Site: same-origin + custom X-Requested-With prove same-origin fetch.
      const hasCustomHeader = Boolean(req.get('x-requested-with')?.trim());
      if (fetchSite === 'same-origin' && hasCustomHeader) {
        return true;
      }

      // Also check matching Referer when same-origin
      const refererHeader = req.get('referer')?.trim();
      if (fetchSite === 'same-origin' && refererHeader) {
        try {
          const refererHost = normalizeHostValue(new URL(refererHeader).host);
          if (refererHost && refererHost === originHost) {
            return true;
          }
        } catch {
          // Ignore malformed referer
        }
      }

      res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
      return false;
    } catch {
      res.status(403).json({ error: 'Invalid request origin.' });
      return false;
    }
  }

  return true;
}

async function withAuthTimeout<T>(
  promise: Promise<T>,
  timeoutMs = 12_000,
  timeoutMessage = 'Authentication service timed out. Please try again.'
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function resolveTrustedRedirectUrl(req: Request): string | undefined {
  const origin = req.get('origin')?.trim();
  if (origin && /^https?:\/\/.+/.test(origin)) {
    try {
      const originHost = normalizeHostValue(new URL(origin).host);
      if (
        getAllowedHostnames(req).has(originHost) ||
        req.get('sec-fetch-site')?.trim().toLowerCase() === 'same-origin'
      ) {
        return origin.replace(/\/+$/, '');
      }
    } catch {
      // Ignore invalid origin
    }
  }
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl && /^https?:\/\/.+/.test(appUrl) && appUrl !== 'MY_APP_URL') {
    return appUrl.replace(/\/+$/, '');
  }
  const host = req.get('x-forwarded-host')?.split(',')[0]?.trim() || req.get('host')?.trim();
  if (host) {
    return `${isHttpsRequest(req) ? 'https' : 'http'}://${host}`;
  }
  return undefined;
}

function extractBearerFromHeader(authHeader: string | undefined): string | null {
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    return token || null;
  }
  return null;
}

function mapSupabaseAuthError(err: { message?: string; status?: number }): {
  status: number;
  message: string;
} {
  const raw = (err.message || '').trim();
  const lower = raw.toLowerCase();
  if (lower.includes('invalid login credentials')) {
    return { status: 401, message: 'Incorrect email or password.' };
  }
  if (lower.includes('email not confirmed')) {
    return {
      status: 403,
      message: 'Please confirm your email address via the link in your inbox before signing in.',
    };
  }
  if (lower.includes('user already registered') || lower.includes('already been registered')) {
    return { status: 409, message: 'An account with this email already exists.' };
  }
  if (lower.includes('rate limit') || err.status === 429) {
    return { status: 429, message: 'Too many authentication attempts. Please wait a moment and try again.' };
  }
  const status = typeof err.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 400;
  return { status, message: raw || 'Authentication request failed.' };
}

export async function resolveLiveSessionContext(
  headers: IncomingHttpHeaders,
  rawUrl?: string
): Promise<RequestAuthContext | null> {
  if (rawUrl) {
    try {
      const parsedUrl = new URL(rawUrl, 'http://localhost');
      const ticket = parsedUrl.searchParams.get('ticket');
      const ticketUser = consumeWsTicket(ticket);
      if (ticketUser) {
        if (isAccountSuspended(ticketUser.email)) return null;
        const user = buildAuthUserDTO({
          id: ticketUser.id,
          email: ticketUser.email,
          fullName: ticketUser.fullName,
          provider: ticketUser.provider,
        });
        const sbToken =
          ticketUser.provider === 'supabase' && ticketUser.supabaseAccessToken
            ? ticketUser.supabaseAccessToken
            : null;
        return {
          user,
          supabaseAccessToken: sbToken,
          supabase: sbToken ? createAuthenticatedSupabaseClient(sbToken) : null,
        };
      }
    } catch {
      // Ignore URL parsing errors
    }
  }

  const cookies = parseCookies(
    typeof headers.cookie === 'string' ? headers.cookie : undefined
  );
  const bearer = extractBearerFromHeader(
    typeof headers.authorization === 'string' ? headers.authorization : undefined
  );

  // 1. Check local signed token (Bearer or HttpOnly cookie)
  const localCandidate =
    bearer && bearer.startsWith('hl1.') ? bearer : cookies[LOCAL_COOKIE_NAME] || null;
  if (localCandidate) {
    const payload = verifyLocalSessionToken(localCandidate);
    if (payload && !isAccountSuspended(payload.email)) {
      return {
        user: buildAuthUserDTO({
          id: payload.id,
          email: payload.email,
          fullName: payload.fullName,
          provider: 'local',
        }),
        supabaseAccessToken: null,
        supabase: null,
      };
    }
  }

  // 2. Check Supabase JWT token (Bearer or HttpOnly cookie)
  const supabase = createStatelessSupabaseClient();
  const sbToken =
    bearer && !bearer.startsWith('hl1.') ? bearer : cookies[ACCESS_COOKIE_NAME] || null;
  if (supabase && sbToken) {
    try {
      const { data, error } = await withAuthTimeout(supabase.auth.getUser(sbToken), 8_000);
      if (!error && data.user && data.user.email && !isAccountSuspended(data.user.email)) {
        return {
          user: mapSupabaseUser(data.user),
          supabaseAccessToken: sbToken,
          supabase: createAuthenticatedSupabaseClient(sbToken),
        };
      }
    } catch {
      // Fall through
    }
  }

  return null;
}

export async function resolveRequestAuthContext(
  req: Request,
  res?: Response
): Promise<RequestAuthContext | null> {
  const direct = await resolveLiveSessionContext(req.headers);
  if (direct) return direct;

  // Attempt Supabase refresh token fallback if access cookie expired
  const supabase = createStatelessSupabaseClient();
  if (!supabase) return null;
  const cookies = parseCookies(req.headers.cookie);
  const refreshToken = cookies[REFRESH_COOKIE_NAME] || null;
  if (!refreshToken) return null;

  try {
    const { data, error } = await withAuthTimeout(
      supabase.auth.refreshSession({
        refresh_token: refreshToken,
      }),
      8_000
    );
    if (!error && data.session && data.user && data.user.email) {
      if (isAccountSuspended(data.user.email)) {
        if (res) clearAuthCookies(req, res);
        return null;
      }
      if (res) {
        setAuthCookies(req, res, data.session);
      }
      return {
        user: mapSupabaseUser(data.user),
        supabaseAccessToken: data.session.access_token,
        supabase: createAuthenticatedSupabaseClient(data.session.access_token),
      };
    }
  } catch {
    // Fall through
  }
  return null;
}

export async function resolveRequestAuthUserFromRaw(
  headers: IncomingHttpHeaders,
  rawUrl?: string
): Promise<AuthUserDTO | null> {
  const ctx = await resolveLiveSessionContext(headers, rawUrl);
  return ctx ? ctx.user : null;
}

export async function resolveRequestAuthUser(req: Request): Promise<AuthUserDTO | null> {
  const ctx = await resolveRequestAuthContext(req);
  return ctx ? ctx.user : null;
}

export function registerSupabaseAuthRoutes(app: Express): void {
  app.use('/api/auth', (_req: Request, res: Response, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

  app.get('/api/auth/status', (_req: Request, res: Response) => {
    const supabaseReady = isSupabaseConfigured();
    const adminClaimed = hasClaimedAdminOrEnvPasscode();
    res.json({
      configured: supabaseReady,
      localAuthAvailable: true,
      adminClaimed,
      adminBootstrapAvailable: !supabaseReady && !adminClaimed,
    });
  });

  app.get('/api/auth/session', async (req: Request, res: Response) => {
    const supabase = createStatelessSupabaseClient();
    const supabaseReady = Boolean(supabase);
    const adminClaimed = hasClaimedAdminOrEnvPasscode();
    const cookies = parseCookies(req.headers.cookie);
    const bearer = extractBearerFromHeader(req.get('authorization'));

    // Check local signed token first
    const localToken =
      bearer && bearer.startsWith('hl1.') ? bearer : cookies[LOCAL_COOKIE_NAME] || null;
    if (localToken) {
      const payload = verifyLocalSessionToken(localToken);
      if (payload && !isAccountSuspended(payload.email)) {
        const dto = buildAuthUserDTO({
          id: payload.id,
          email: payload.email,
          fullName: payload.fullName,
          provider: 'local',
        });
        recordAccountActivity({
          id: dto.id,
          email: dto.email,
          fullName: dto.fullName,
          provider: 'local',
        });
        res.json({
          configured: supabaseReady,
          localAuthAvailable: true,
          adminClaimed,
          adminBootstrapAvailable: !supabaseReady && !adminClaimed,
          user: dto,
          accessToken: localToken,
        });
        return;
      }
    }

    if (!supabase) {
      if (cookies[LOCAL_COOKIE_NAME] || cookies[ACCESS_COOKIE_NAME] || cookies[REFRESH_COOKIE_NAME]) {
        clearAuthCookies(req, res);
      }
      res.json({
        configured: false,
        localAuthAvailable: true,
        adminClaimed,
        adminBootstrapAvailable: !adminClaimed,
        user: null,
      });
      return;
    }

    const accessToken =
      (bearer && !bearer.startsWith('hl1.') ? bearer : null) ||
      cookies[ACCESS_COOKIE_NAME] ||
      null;
    const refreshToken = cookies[REFRESH_COOKIE_NAME] || null;

    if (!accessToken && !refreshToken) {
      res.json({
        configured: true,
        localAuthAvailable: true,
        adminClaimed,
        adminBootstrapAvailable: false,
        user: null,
      });
      return;
    }

    try {
      if (accessToken) {
        const { data, error } = await withAuthTimeout(supabase.auth.getUser(accessToken), 8_000);
        if (!error && data.user && data.user.email) {
          if (isAccountSuspended(data.user.email)) {
            clearAuthCookies(req, res);
            res.json({
              configured: true,
              localAuthAvailable: true,
              adminClaimed,
              adminBootstrapAvailable: false,
              user: null,
            });
            return;
          }
          const dto = mapSupabaseUser(data.user);
          recordAccountActivity({
            id: dto.id,
            email: dto.email,
            fullName: dto.fullName,
            provider: 'supabase',
          });
          res.json({
            configured: true,
            localAuthAvailable: true,
            adminClaimed,
            adminBootstrapAvailable: false,
            user: dto,
            accessToken,
          });
          return;
        }
      }

      if (refreshToken) {
        const { data, error } = await withAuthTimeout(
          supabase.auth.refreshSession({
            refresh_token: refreshToken,
          }),
          8_000
        );
        if (!error && data.session && data.user && data.user.email) {
          if (isAccountSuspended(data.user.email)) {
            clearAuthCookies(req, res);
            res.json({
              configured: true,
              localAuthAvailable: true,
              adminClaimed,
              adminBootstrapAvailable: false,
              user: null,
            });
            return;
          }
          setAuthCookies(req, res, data.session);
          const dto = mapSupabaseUser(data.user);
          recordAccountActivity({
            id: dto.id,
            email: dto.email,
            fullName: dto.fullName,
            provider: 'supabase',
          });
          res.json({
            configured: true,
            localAuthAvailable: true,
            adminClaimed,
            adminBootstrapAvailable: false,
            user: dto,
            accessToken: data.session.access_token,
            expiresAt: data.session.expires_at ?? null,
          });
          return;
        }
      }
    } catch {
      // Fall through to unauthenticated response
    }

    if (cookies[ACCESS_COOKIE_NAME] || cookies[REFRESH_COOKIE_NAME] || cookies[LOCAL_COOKIE_NAME]) {
      clearAuthCookies(req, res);
    }
    res.json({
      configured: true,
      localAuthAvailable: true,
      adminClaimed,
      adminBootstrapAvailable: false,
      user: null,
    });
  });

  // One-time first-run Admin Claim endpoint for preview / local mode when Supabase & ADMIN_PASSCODE are unset
  app.post('/api/auth/admin-bootstrap', (req: Request, res: Response) => {
    if (!verifySameOrigin(req, res)) return;
    if (isSupabaseConfigured()) {
      res.status(409).json({
        error: 'Supabase authentication is configured. Sign in with your administrator email instead.',
      });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const fullName =
      typeof body.fullName === 'string' ? body.fullName.trim().slice(0, 80) : '';

    if (!EMAIL_REGEX.test(email) || email.length > 254) {
      res.status(400).json({ error: 'Please enter a valid administrator email address.' });
      return;
    }
    if (!isAdminEmail(email)) {
      res.status(403).json({
        error: 'Only the designated owner administrator email can claim initial admin access.',
      });
      return;
    }
    if (password.length < 8 || password.length > 128) {
      res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
      return;
    }

    const claimed = claimFirstRunAdmin({ email, password, fullName });
    if (!claimed.ok) {
      res.status(claimed.status).json({ error: claimed.error });
      return;
    }

    const dto = buildAuthUserDTO({
      id: `admin-${email}`,
      email: claimed.admin.email,
      fullName: claimed.admin.fullName,
      createdAt: new Date(claimed.admin.claimedAt).toISOString(),
      provider: 'local',
    });
    const signed = signLocalSessionToken({
      id: dto.id,
      email: dto.email,
      fullName: dto.fullName,
    });
    setLocalAuthCookie(req, res, signed.token);

    res.status(201).json({
      user: dto,
      accessToken: signed.token,
      expiresAt: signed.expiresAt,
    });
  });

  app.post('/api/auth/signup', async (req: Request, res: Response) => {
    if (!verifySameOrigin(req, res)) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const fullName =
      typeof body.fullName === 'string' ? body.fullName.trim().slice(0, 80) : '';

    if (!EMAIL_REGEX.test(email) || email.length > 254) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    if (password.length < 8 || password.length > 128) {
      res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
      return;
    }

    const supabase = createStatelessSupabaseClient();
    if (!supabase) {
      const created = createLocalStandardAccount({ email, password, fullName });
      if (!created.ok) {
        res.status(created.status).json({ error: created.error });
        return;
      }

      const dto = buildAuthUserDTO({
        id: created.account.id,
        email: created.account.email,
        fullName: created.account.fullName,
        createdAt: new Date(created.account.createdAt).toISOString(),
        provider: 'local',
      });
      const signed = signLocalSessionToken({
        id: dto.id,
        email: dto.email,
        fullName: dto.fullName,
      });
      setLocalAuthCookie(req, res, signed.token);
      res.status(201).json({
        user: dto,
        accessToken: signed.token,
        expiresAt: signed.expiresAt,
        requiresEmailConfirmation: false,
      });
      return;
    }

    try {
      const emailRedirectTo = resolveTrustedRedirectUrl(req);
      const { data, error } = await withAuthTimeout(
        supabase.auth.signUp({
          email,
          password,
          options: {
            ...(fullName ? { data: { full_name: fullName } } : {}),
            ...(emailRedirectTo ? { emailRedirectTo } : {}),
          },
        })
      );

      if (error) {
        const mapped = mapSupabaseAuthError(error);
        res.status(mapped.status).json({ error: mapped.message });
        return;
      }

      if (!data.user) {
        res.status(500).json({ error: 'Could not create account.' });
        return;
      }

      if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        res.status(409).json({ error: 'An account with this email already exists.' });
        return;
      }

      const dto = mapSupabaseUser(data.user);
      recordAccountActivity({
        id: dto.id,
        email: dto.email,
        fullName: dto.fullName,
        provider: 'supabase',
        isSignIn: Boolean(data.session),
      });
      recordAuditEvent({
        event: 'account_signup',
        actorEmail: dto.email,
        actorRole: dto.role,
        detail: dto.isAdmin
          ? 'Administrator account registered via Supabase.'
          : 'Standard account registered (Hazel Workspace locked).',
        allowed: true,
      });

      if (data.session) {
        setAuthCookies(req, res, data.session);
        res.status(201).json({
          user: dto,
          accessToken: data.session.access_token,
          expiresAt: data.session.expires_at ?? null,
          requiresEmailConfirmation: false,
        });
        return;
      }

      res.status(201).json({
        user: dto,
        requiresEmailConfirmation: true,
      });
    } catch {
      res.status(502).json({ error: 'Unable to reach Supabase authentication service.' });
    }
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    if (!verifySameOrigin(req, res)) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!EMAIL_REGEX.test(email) || email.length > 254) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    if (password.length === 0 || password.length > 128) {
      res.status(400).json({ error: 'Please enter your password.' });
      return;
    }

    const issueLocalLoginResponse = (localUser: {
      id: string;
      email: string;
      fullName: string;
      createdAt: string;
    }) => {
      const dto = buildAuthUserDTO({
        id: localUser.id,
        email: localUser.email,
        fullName: localUser.fullName,
        createdAt: localUser.createdAt,
        provider: 'local',
      });
      const signed = signLocalSessionToken({
        id: dto.id,
        email: dto.email,
        fullName: dto.fullName,
      });
      setLocalAuthCookie(req, res, signed.token);
      recordAuditEvent({
        event: 'login_success',
        actorEmail: dto.email,
        actorRole: dto.role,
        detail: dto.isAdmin
          ? 'Administrator signed in (Workspace & Admin Panel unlocked).'
          : 'Standard account signed in (Workspace locked).',
        allowed: true,
      });
      res.json({
        user: dto,
        accessToken: signed.token,
        expiresAt: signed.expiresAt,
      });
    };

    const supabase = createStatelessSupabaseClient();
    if (!supabase) {
      const localAuth = authenticateLocalUser(email, password);
      if (!localAuth.ok) {
        recordAuditEvent({
          event: 'login_failed',
          actorEmail: email,
          actorRole: isAdminEmail(email) ? 'admin' : 'user',
          detail: 'Failed local sign-in attempt.',
          allowed: false,
        });
        res.status(localAuth.status).json({ error: localAuth.error });
        return;
      }

      issueLocalLoginResponse(localAuth.user);
      return;
    }

    try {
      const { data, error } = await withAuthTimeout(
        supabase.auth.signInWithPassword({
          email,
          password,
        })
      );

      if (error || !data.session || !data.user) {
        // Allow local/admin passcode fallback if this email matches local credentials or ADMIN_PASSCODE
        const localFallback = authenticateLocalUser(email, password);
        if (localFallback.ok) {
          issueLocalLoginResponse(localFallback.user);
          return;
        }

        recordAuditEvent({
          event: 'login_failed',
          actorEmail: email,
          actorRole: isAdminEmail(email) ? 'admin' : 'user',
          detail: 'Failed Supabase sign-in attempt.',
          allowed: false,
        });
        const mapped = mapSupabaseAuthError(error ?? { message: 'Invalid login credentials' });
        res.status(mapped.status).json({ error: mapped.message });
        return;
      }

      if (isAccountSuspended(data.user.email)) {
        recordAuditEvent({
          event: 'login_blocked_suspended',
          actorEmail: data.user.email || email,
          actorRole: 'user',
          detail: 'Blocked sign-in for suspended account.',
          allowed: false,
        });
        res.status(403).json({
          error: 'This account has been suspended by an administrator.',
        });
        return;
      }

      setAuthCookies(req, res, data.session);
      const dto = mapSupabaseUser(data.user);
      recordAccountActivity({
        id: dto.id,
        email: dto.email,
        fullName: dto.fullName,
        provider: 'supabase',
        isSignIn: true,
      });
      recordAuditEvent({
        event: 'login_success',
        actorEmail: dto.email,
        actorRole: dto.role,
        detail: dto.isAdmin
          ? 'Administrator signed in (Workspace & Admin Panel unlocked).'
          : 'Standard account signed in (Workspace locked).',
        allowed: true,
      });

      res.json({
        user: dto,
        accessToken: data.session.access_token,
        expiresAt: data.session.expires_at ?? null,
      });
    } catch (err) {
      const localFallback = authenticateLocalUser(email, password);
      if (localFallback.ok) {
        issueLocalLoginResponse(localFallback.user);
        return;
      }
      const timedOut =
        err instanceof Error && err.message.toLowerCase().includes('timed out');
      res.status(timedOut ? 504 : 502).json({
        error: timedOut
          ? 'Authentication service timed out. Please try again.'
          : 'Unable to reach Supabase authentication service.',
      });
    }
  });

  app.post('/api/auth/reset-password', async (req: Request, res: Response) => {
    if (!verifySameOrigin(req, res)) return;

    const supabase = createStatelessSupabaseClient();
    if (!supabase) {
      res.status(503).json({
        error:
          'Password reset emails require Supabase configuration (SUPABASE_URL & SUPABASE_ANON_KEY).',
      });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!EMAIL_REGEX.test(email) || email.length > 254) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }

    try {
      const redirectTo = resolveTrustedRedirectUrl(req);
      const { error } = await withAuthTimeout(
        supabase.auth.resetPasswordForEmail(
          email,
          redirectTo ? { redirectTo } : undefined
        )
      );
      if (error) {
        const mapped = mapSupabaseAuthError(error);
        if (mapped.status === 429) {
          res.status(429).json({ error: mapped.message });
          return;
        }
      }
      res.json({
        ok: true,
        message: 'If an account exists for that email, a password reset link has been sent.',
      });
    } catch {
      res.status(502).json({ error: 'Unable to reach Supabase authentication service.' });
    }
  });

  app.post('/api/auth/session-exchange', async (req: Request, res: Response) => {
    if (!verifySameOrigin(req, res)) return;

    const supabase = createStatelessSupabaseClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase authentication is not configured.' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const accessToken = typeof body.accessToken === 'string' ? body.accessToken.trim() : '';
    const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken.trim() : '';

    if (!code && (!accessToken || !refreshToken)) {
      res.status(400).json({ error: 'Invalid authentication callback payload.' });
      return;
    }

    try {
      const result = await withAuthTimeout(
        code
          ? supabase.auth.exchangeCodeForSession(code)
          : supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            })
      );

      if (result.error || !result.data.session || !result.data.user || !result.data.user.email) {
        const mapped = mapSupabaseAuthError(
          result.error ?? { message: 'Authentication callback expired or invalid.' }
        );
        res.status(mapped.status).json({ error: mapped.message });
        return;
      }

      if (isAccountSuspended(result.data.user.email)) {
        clearAuthCookies(req, res);
        res.status(403).json({
          error: 'This account has been suspended by an administrator.',
        });
        return;
      }

      setAuthCookies(req, res, result.data.session);
      const dto = mapSupabaseUser(result.data.user);
      recordAccountActivity({
        id: dto.id,
        email: dto.email,
        fullName: dto.fullName,
        provider: 'supabase',
        isSignIn: true,
      });
      recordAuditEvent({
        event: 'login_callback',
        actorEmail: dto.email,
        actorRole: dto.role,
        detail: 'Authenticated via email verification or password recovery link.',
        allowed: true,
      });

      res.json({
        user: dto,
        accessToken: result.data.session.access_token,
        expiresAt: result.data.session.expires_at ?? null,
      });
    } catch {
      res.status(502).json({ error: 'Unable to complete authentication callback.' });
    }
  });

  app.post('/api/auth/update-password', async (req: Request, res: Response) => {
    if (!verifySameOrigin(req, res)) return;

    const ctx = await resolveRequestAuthContext(req, res);
    if (!ctx) {
      res.status(401).json({ error: 'Please open the recovery link again or sign in first.' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < 8 || password.length > 128) {
      res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
      return;
    }

    if (!ctx.supabase || ctx.user.provider !== 'supabase') {
      res.status(400).json({ error: 'Password updates are only supported for Supabase accounts.' });
      return;
    }

    try {
      const { error } = await withAuthTimeout(ctx.supabase.auth.updateUser({ password }));
      if (error) {
        const mapped = mapSupabaseAuthError(error);
        res.status(mapped.status).json({ error: mapped.message });
        return;
      }
      recordAuditEvent({
        event: 'password_updated',
        actorEmail: ctx.user.email,
        actorRole: ctx.user.role,
        detail: 'Password updated via recovery session.',
        allowed: true,
      });
      res.json({ ok: true, user: ctx.user });
    } catch {
      res.status(502).json({ error: 'Unable to update password right now.' });
    }
  });

  // Short-lived one-time WebSocket ticket for authenticated /api/live connections and guest memories
  app.post('/api/auth/live-ticket', async (req: Request, res: Response) => {
    if (!verifySameOrigin(req, res)) return;
    const ctx = await resolveRequestAuthContext(req, res);
    if (!ctx) {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const rawMemories = Array.isArray(body.memories) ? body.memories : [];
      if (rawMemories.length === 0) {
        res.json({ ticket: null });
        return;
      }
      const ticket = issueGuestWsTicket(rawMemories);
      res.json({ ticket });
      return;
    }
    const { user, supabaseAccessToken } = ctx;
    const ticket = issueWsTicket({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      isAdmin: user.isAdmin,
      workspaceAccess: user.workspaceAccess,
      provider: user.provider,
      ...(supabaseAccessToken ? { supabaseAccessToken } : {}),
    });
    res.json({ ticket });
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    if (!verifySameOrigin(req, res)) return;
    clearAuthCookies(req, res);
    res.json({ ok: true });
  });
}
