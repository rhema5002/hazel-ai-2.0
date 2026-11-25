import type { Express, NextFunction, Request, Response } from 'express';
import {
  clearNonCriticalAuditLog,
  getAdminOverviewSnapshot,
  getWorkspacePolicy,
  grantAdminRole,
  recordAuditEvent,
  revokeAdminRole,
  setAccountStatus,
  updateWorkspacePolicy,
} from './adminStore.ts';
import {
  isSupabaseConfigured,
  resolveRequestAuthUser,
  verifySameOrigin,
  type AuthUserDTO,
} from './supabaseAuth.ts';

interface AdminAuthenticatedRequest extends Request {
  adminUser?: AuthUserDTO;
}

async function requireAdmin(
  req: AdminAuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const user = await resolveRequestAuthUser(req);
  if (!user) {
    res.status(401).json({
      error: 'Administrator sign-in is required to access the Admin Panel.',
      code: 'AUTH_REQUIRED',
    });
    return;
  }
  if (!user.isAdmin) {
    recordAuditEvent({
      event: 'admin_panel_blocked',
      actorEmail: user.email,
      actorRole: user.role,
      detail: `Blocked non-admin access to ${req.method} ${req.path}`,
      allowed: false,
    });
    res.status(403).json({
      error: 'Administrator privileges are required for this action.',
      code: 'ADMIN_REQUIRED',
    });
    return;
  }
  req.adminUser = user;
  next();
}

function buildAdminOverview(req: AdminAuthenticatedRequest) {
  return {
    ...getAdminOverviewSnapshot(),
    currentAdminEmail: req.adminUser?.email ?? '',
    aiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    supabaseConfigured: isSupabaseConfigured(),
  };
}

export function registerAdminRoutes(app: Express): void {
  // Public non-sensitive policy flags for UI state (never exposes emails or logs)
  app.get('/api/policy/public', (_req: Request, res: Response) => {
    const policy = getWorkspacePolicy();
    res.json({
      workspaceMode: policy.workspaceMode,
      allowStandardChat: policy.allowStandardChat,
      allowGuestChat: policy.allowGuestChat,
      allowLiveVoiceForNonAdmin: policy.allowLiveVoiceForNonAdmin,
    });
  });

  app.get(
    '/api/admin/overview',
    (req: Request, res: Response, next: NextFunction) => void requireAdmin(req, res, next),
    (req: AdminAuthenticatedRequest, res: Response) => {
      res.json(buildAdminOverview(req));
    }
  );

  app.post(
    '/api/admin/admins',
    (req: Request, res: Response, next: NextFunction) => {
      if (!verifySameOrigin(req, res)) return;
      void requireAdmin(req, res, next);
    },
    (req: AdminAuthenticatedRequest, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const email = typeof body.email === 'string' ? body.email : '';
      const result = grantAdminRole(email, req.adminUser!.email);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.status(201).json(buildAdminOverview(req));
    }
  );

  app.delete(
    '/api/admin/admins/:email',
    (req: Request, res: Response, next: NextFunction) => {
      if (!verifySameOrigin(req, res)) return;
      void requireAdmin(req, res, next);
    },
    (req: AdminAuthenticatedRequest, res: Response) => {
      const rawEmail = Array.isArray(req.params.email)
        ? req.params.email[0]
        : req.params.email;
      let targetEmail = '';
      try {
        targetEmail = decodeURIComponent(rawEmail || '');
      } catch {
        targetEmail = rawEmail || '';
      }
      const result = revokeAdminRole(targetEmail, req.adminUser!.email);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json(buildAdminOverview(req));
    }
  );

  app.patch(
    '/api/admin/accounts/:email',
    (req: Request, res: Response, next: NextFunction) => {
      if (!verifySameOrigin(req, res)) return;
      void requireAdmin(req, res, next);
    },
    (req: AdminAuthenticatedRequest, res: Response) => {
      const rawEmail = Array.isArray(req.params.email)
        ? req.params.email[0]
        : req.params.email;
      let targetEmail = '';
      try {
        targetEmail = decodeURIComponent(rawEmail || '');
      } catch {
        targetEmail = rawEmail || '';
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const status = body.status === 'suspended' ? 'suspended' : body.status === 'active' ? 'active' : null;
      if (!status) {
        res.status(400).json({ error: 'Status must be "active" or "suspended".' });
        return;
      }

      const result = setAccountStatus(targetEmail, status, req.adminUser!.email);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json(buildAdminOverview(req));
    }
  );

  app.patch(
    '/api/admin/policy',
    (req: Request, res: Response, next: NextFunction) => {
      if (!verifySameOrigin(req, res)) return;
      void requireAdmin(req, res, next);
    },
    (req: AdminAuthenticatedRequest, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      updateWorkspacePolicy(
        {
          ...(typeof body.allowStandardChat === 'boolean'
            ? { allowStandardChat: body.allowStandardChat }
            : {}),
          ...(typeof body.allowGuestChat === 'boolean'
            ? { allowGuestChat: body.allowGuestChat }
            : {}),
          ...(typeof body.allowLiveVoiceForNonAdmin === 'boolean'
            ? { allowLiveVoiceForNonAdmin: body.allowLiveVoiceForNonAdmin }
            : {}),
        },
        req.adminUser!.email
      );
      res.json(buildAdminOverview(req));
    }
  );

  app.delete(
    '/api/admin/audit',
    (req: Request, res: Response, next: NextFunction) => {
      if (!verifySameOrigin(req, res)) return;
      void requireAdmin(req, res, next);
    },
    (req: AdminAuthenticatedRequest, res: Response) => {
      clearNonCriticalAuditLog(req.adminUser!.email);
      res.json(buildAdminOverview(req));
    }
  );
}
