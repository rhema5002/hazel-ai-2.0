import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Ban,
  CheckCircle2,
  Code2,
  LayoutDashboard,
  Lock,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Sliders,
  Trash2,
  Unlock,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  clearAdminAuditLog,
  fetchAdminOverview,
  grantAdminEmail,
  revokeAdminEmail,
  updateAccountStatus,
  updateWorkspacePolicySettings,
  type AdminOverviewData,
  type AuthUser,
} from '../services/authClient';

type AdminSection = 'overview' | 'accounts' | 'controls' | 'audit';
type AccountFilter = 'all' | 'admin' | 'user' | 'suspended';
type AuditFilter = 'all' | 'blocked' | 'allowed';

interface AdminPanelProps {
  authUser: AuthUser;
  onOpenWorkspace: () => void;
  onOpenChat: () => void;
}

function formatTimestamp(ms: number): string {
  if (!ms) return 'Never';
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  authUser,
  onOpenWorkspace,
  onOpenChat,
}) => {
  const [section, setSection] = useState<AdminSection>('overview');
  const [data, setData] = useState<AdminOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [accountQuery, setAccountQuery] = useState('');
  const [accountFilter, setAccountFilter] = useState<AccountFilter>('all');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [auditFilter, setAuditFilter] = useState<AuditFilter>('all');

  const loadOverview = useCallback(async () => {
    setError(null);
    try {
      const overview = await fetchAdminOverview();
      setData(overview);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Admin Panel.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const handleGrantAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = newAdminEmail.trim().toLowerCase();
    if (!email) return;
    setError(null);
    setNotice(null);
    setBusyAction(`grant:${email}`);
    try {
      const updated = await grantAdminEmail(email);
      setData(updated);
      setNewAdminEmail('');
      setNotice(`Granted administrator & Workspace access to ${email}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not grant admin access.');
    } finally {
      setBusyAction(null);
    }
  };

  const handlePromoteAccount = async (email: string) => {
    setError(null);
    setNotice(null);
    setBusyAction(`grant:${email}`);
    try {
      const updated = await grantAdminEmail(email);
      setData(updated);
      setNotice(`Promoted ${email} to Administrator (Hazel Workspace unlocked).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not promote account.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRevokeAdmin = async (email: string) => {
    setError(null);
    setNotice(null);
    setBusyAction(`revoke:${email}`);
    try {
      const updated = await revokeAdminEmail(email);
      setData(updated);
      setNotice(`Revoked admin role from ${email}. Hazel Workspace is now locked for them.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke admin access.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleToggleAccountStatus = async (
    email: string,
    nextStatus: 'active' | 'suspended'
  ) => {
    setError(null);
    setNotice(null);
    setBusyAction(`status:${email}`);
    try {
      const updated = await updateAccountStatus(email, nextStatus);
      setData(updated);
      setNotice(
        nextStatus === 'suspended'
          ? `Suspended ${email}.`
          : `Reactivated ${email}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update account status.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleTogglePolicy = async (
    key: 'allowStandardChat' | 'allowGuestChat' | 'allowLiveVoiceForNonAdmin',
    nextVal: boolean
  ) => {
    setError(null);
    setNotice(null);
    setBusyAction(`policy:${key}`);
    try {
      const updated = await updateWorkspacePolicySettings({ [key]: nextVal });
      setData(updated);
      setNotice('Access policy saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save policy.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleClearAudit = async () => {
    setError(null);
    setNotice(null);
    setBusyAction('clear_audit');
    try {
      const updated = await clearAdminAuditLog();
      setData(updated);
      setNotice('Security log cleared.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear security log.');
    } finally {
      setBusyAction(null);
    }
  };

  const filteredAccounts = useMemo(() => {
    if (!data) return [];
    const q = accountQuery.trim().toLowerCase();
    return data.accounts.filter((acc) => {
      if (accountFilter === 'admin' && acc.role !== 'admin') return false;
      if (accountFilter === 'user' && acc.role !== 'user') return false;
      if (accountFilter === 'suspended' && acc.status !== 'suspended') return false;
      if (!q) return true;
      return (
        acc.email.toLowerCase().includes(q) ||
        acc.fullName.toLowerCase().includes(q)
      );
    });
  }, [data, accountQuery, accountFilter]);

  const filteredAudit = useMemo(() => {
    if (!data) return [];
    return data.auditLog.filter((item) => {
      if (auditFilter === 'blocked') return !item.allowed;
      if (auditFilter === 'allowed') return item.allowed;
      return true;
    });
  }, [data, auditFilter]);

  const navItems: Array<{
    id: AdminSection;
    label: string;
    icon: React.FC<{ className?: string }>;
  }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'accounts', label: 'Accounts & Roles', icon: Users },
    { id: 'controls', label: 'Workspace Controls', icon: Sliders },
    { id: 'audit', label: 'Security Log', icon: Activity },
  ];

  const sectionLabel =
    navItems.find((item) => item.id === section)?.label ?? 'Overview';

  return (
    <section
      aria-label="Hazel Admin Panel"
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-[#F8FAFD] md:flex-row dark:bg-[#121316]"
    >
      {/* Left Admin Navigation Rail */}
      <aside className="flex shrink-0 flex-col border-b border-slate-200/80 bg-white md:w-60 md:border-r md:border-b-0 dark:border-zinc-800 dark:bg-[#17181B]">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 px-4 py-3.5 dark:border-zinc-800">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white dark:bg-blue-600">
              <Shield className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="font-display truncate text-sm font-semibold text-slate-900 dark:text-white">
                Admin Console
              </div>
              <div className="truncate text-[11px] text-slate-500 dark:text-zinc-400">
                {authUser.email}
              </div>
            </div>
          </div>
        </div>

        <nav
          aria-label="Admin sections"
          className="flex gap-1 overflow-x-auto p-2 md:flex-1 md:flex-col md:overflow-x-visible"
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`flex min-h-[38px] shrink-0 items-center gap-2.5 rounded-xl px-3 text-xs font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-slate-900 text-white dark:bg-zinc-800 dark:text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="hidden space-y-1.5 border-t border-slate-200/80 p-3 md:block dark:border-zinc-800">
          <button
            type="button"
            onClick={onOpenWorkspace}
            className="flex min-h-[36px] w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-800 whitespace-nowrap transition-colors hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <Code2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Open Workspace Studio</span>
          </button>
          <button
            type="button"
            onClick={onOpenChat}
            className="flex min-h-[36px] w-full items-center gap-2 rounded-xl px-3 text-xs font-medium text-slate-600 whitespace-nowrap transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <span>Return to Chat</span>
          </button>
        </div>
      </aside>

      {/* Main Console Viewport */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top Breadcrumb & Action Bar */}
        <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-slate-200/80 bg-white px-4 sm:px-6 dark:border-zinc-800 dark:bg-[#17181B]">
          <div className="flex min-w-0 items-center gap-2 text-xs text-slate-500 dark:text-zinc-400">
            <span className="font-medium text-slate-900 whitespace-nowrap dark:text-white">
              Hazel
            </span>
            <span aria-hidden="true">/</span>
            <span className="whitespace-nowrap">Admin Panel</span>
            <span aria-hidden="true">/</span>
            <span className="truncate font-medium text-slate-800 dark:text-zinc-200">
              {sectionLabel}
            </span>
          </div>

          <button
            type="button"
            onClick={() => void loadOverview()}
            disabled={loading}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 whitespace-nowrap transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="chat-scroll flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto max-w-5xl space-y-6">
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                <span>{error}</span>
              </div>
            )}

            {notice && (
              <div
                role="status"
                className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>{notice}</span>
              </div>
            )}

            {loading && !data ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[0, 1, 2, 3].map((idx) => (
                  <div
                    key={idx}
                    className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#191B1F]"
                  />
                ))}
              </div>
            ) : data ? (
              <>
                {section === 'overview' && (
                  <div className="space-y-6">
                    {/* 4-Column Metric Strip */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="rounded-2xl border border-slate-200/90 bg-white p-4 dark:border-zinc-800 dark:bg-[#191B1F]">
                        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-zinc-400">
                          <span>Workspace Access</span>
                          <Lock className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div className="font-display mt-2 text-lg font-semibold text-slate-900 dark:text-white">
                          Admin Only
                        </div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
                          Locked for all other accounts
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200/90 bg-white p-4 dark:border-zinc-800 dark:bg-[#191B1F]">
                        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-zinc-400">
                          <span>Total Accounts</span>
                          <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-white">
                          {data.stats.totalAccounts}
                        </div>
                        <div className="mt-1 text-xs text-slate-500 tabular-nums dark:text-zinc-400">
                          {data.stats.lockedAccountsCount} workspace locked
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200/90 bg-white p-4 dark:border-zinc-800 dark:bg-[#191B1F]">
                        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-zinc-400">
                          <span>Administrators</span>
                          <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-white">
                          {data.stats.adminCount}
                        </div>
                        <div className="mt-1 truncate text-xs text-slate-500 dark:text-zinc-400">
                          Owner: {data.primaryOwnerEmail}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200/90 bg-white p-4 dark:border-zinc-800 dark:bg-[#191B1F]">
                        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-zinc-400">
                          <span>Blocked Attempts</span>
                          <Ban className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                        </div>
                        <div className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-white">
                          {data.stats.blockedAttempts}
                        </div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
                          Denied workspace &amp; admin requests
                        </div>
                      </div>
                    </div>

                    {/* Enforcement & Environment Summary */}
                    <div className="rounded-2xl border border-slate-200/90 bg-white p-5 dark:border-zinc-800 dark:bg-[#191B1F]">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-3.5 dark:border-zinc-800">
                        <div>
                          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                            Workspace Lock Enforcement
                          </h2>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-400">
                            Verified server-side across chat streams, Pro Coder mode, and Live Voice WebSockets
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={onOpenWorkspace}
                          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 text-xs font-semibold text-white whitespace-nowrap hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
                        >
                          <Unlock className="h-3.5 w-3.5" />
                          <span>Launch Workspace</span>
                        </button>
                      </div>

                      <dl className="mt-4 grid grid-cols-1 gap-4 text-xs sm:grid-cols-3">
                        <div>
                          <dt className="text-slate-500 dark:text-zinc-400">Authentication Provider</dt>
                          <dd className="mt-1 font-medium text-slate-900 dark:text-zinc-100">
                            {data.supabaseConfigured
                              ? 'Supabase Auth (Configured)'
                              : 'Local Scrypt Session (Preview)'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500 dark:text-zinc-400">Standard Account Chat</dt>
                          <dd className="mt-1 font-medium text-slate-900 dark:text-zinc-100">
                            {data.policy.allowStandardChat ? 'Allowed (Workspace Locked)' : 'Paused'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500 dark:text-zinc-400">Guest Chat Access</dt>
                          <dd className="mt-1 font-medium text-slate-900 dark:text-zinc-100">
                            {data.policy.allowGuestChat ? 'Allowed (Workspace Locked)' : 'Sign-in Required'}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    {/* Recent Security Events */}
                    <div className="rounded-2xl border border-slate-200/90 bg-white dark:border-zinc-800 dark:bg-[#191B1F]">
                      <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-3.5 dark:border-zinc-800">
                        <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                          Recent Security Activity
                        </h2>
                        <button
                          type="button"
                          onClick={() => setSection('audit')}
                          className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                        >
                          View all
                        </button>
                      </div>
                      {data.auditLog.length === 0 ? (
                        <div className="px-5 py-8 text-center text-xs text-slate-500 dark:text-zinc-400">
                          No security events recorded yet. Sign-ins, policy updates, and blocked workspace attempts will appear here.
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-200/70 dark:divide-zinc-800">
                          {data.auditLog.slice(0, 6).map((item) => (
                            <div
                              key={item.id}
                              className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-xs"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`font-semibold ${
                                      item.allowed
                                        ? 'text-emerald-700 dark:text-emerald-400'
                                        : 'text-rose-700 dark:text-rose-400'
                                    }`}
                                  >
                                    {item.allowed ? 'Allowed' : 'Blocked'}
                                  </span>
                                  <span aria-hidden="true" className="text-slate-400">
                                    ·
                                  </span>
                                  <span className="truncate font-medium text-slate-900 dark:text-zinc-100">
                                    {item.actorEmail}
                                  </span>
                                  <span aria-hidden="true" className="text-slate-400">
                                    ·
                                  </span>
                                  <span className="font-mono text-[11px] text-slate-500 dark:text-zinc-400">
                                    {item.event}
                                  </span>
                                </div>
                                <p className="mt-0.5 truncate text-slate-600 dark:text-zinc-400">
                                  {item.detail}
                                </p>
                              </div>
                              <span className="shrink-0 font-mono text-[11px] text-slate-500 tabular-nums dark:text-zinc-400">
                                {formatTimestamp(item.timestamp)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {section === 'accounts' && (
                  <div className="space-y-5">
                    {/* Add Administrator Form */}
                    <form
                      onSubmit={(e) => void handleGrantAdmin(e)}
                      className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-slate-200/90 bg-white p-4 dark:border-zinc-800 dark:bg-[#191B1F]"
                    >
                      <div className="min-w-[240px] flex-1 space-y-1">
                        <label
                          htmlFor="admin-grant-email"
                          className="block text-xs font-semibold text-slate-900 dark:text-zinc-100"
                        >
                          Authorize Administrator Email
                        </label>
                        <input
                          id="admin-grant-email"
                          type="email"
                          required
                          value={newAdminEmail}
                          onChange={(e) => setNewAdminEmail(e.target.value)}
                          placeholder="teammate@company.com"
                          className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder:text-zinc-500"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={!newAdminEmail.trim() || busyAction !== null}
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white whitespace-nowrap hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-400"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        <span>Grant Admin</span>
                      </button>
                    </form>

                    {/* Search + Segmented Role Filter */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="relative min-w-[220px] flex-1">
                        <Search
                          className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                          aria-hidden="true"
                        />
                        <input
                          type="text"
                          value={accountQuery}
                          onChange={(e) => setAccountQuery(e.target.value)}
                          placeholder="Search accounts by name or email…"
                          aria-label="Search accounts"
                          className="h-9 w-full rounded-xl border border-slate-200 bg-white pr-3 pl-9 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-[#191B1F] dark:text-white dark:placeholder:text-zinc-500"
                        />
                      </div>

                      <div
                        role="tablist"
                        aria-label="Filter accounts"
                        className="inline-flex items-center gap-1 rounded-xl bg-slate-200/70 p-1 dark:bg-zinc-800"
                      >
                        {(
                          [
                            { id: 'all', label: 'All' },
                            { id: 'admin', label: 'Admins' },
                            { id: 'user', label: 'Standard' },
                            { id: 'suspended', label: 'Suspended' },
                          ] as const
                        ).map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={accountFilter === tab.id}
                            onClick={() => setAccountFilter(tab.id)}
                            className={`rounded-lg px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                              accountFilter === tab.id
                                ? 'bg-white text-slate-900 shadow-xs dark:bg-zinc-700 dark:text-white'
                                : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Accounts Table */}
                    <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white dark:border-zinc-800 dark:bg-[#191B1F]">
                      {filteredAccounts.length === 0 ? (
                        <div className="px-5 py-10 text-center text-xs text-slate-500 dark:text-zinc-400">
                          No accounts match your current filter.
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse text-left text-xs">
                            <thead>
                              <tr className="border-b border-slate-200/80 bg-slate-50/70 text-[11px] font-semibold text-slate-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
                                <th className="px-4 py-3">Account</th>
                                <th className="px-4 py-3">Role</th>
                                <th className="px-4 py-3">Hazel Workspace</th>
                                <th className="px-4 py-3 text-right">Sign-ins</th>
                                <th className="px-4 py-3 text-right">Last Active</th>
                                <th className="px-4 py-3 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70 dark:divide-zinc-800">
                              {filteredAccounts.map((acc) => {
                                const isSelf =
                                  acc.email.toLowerCase() === authUser.email.toLowerCase();
                                return (
                                  <tr
                                    key={acc.email}
                                    className="transition-colors hover:bg-slate-50/80 dark:hover:bg-zinc-800/40"
                                  >
                                    <td className="px-4 py-3">
                                      <div className="font-semibold text-slate-900 dark:text-zinc-100">
                                        {acc.fullName}
                                        {isSelf && (
                                          <span className="ml-1.5 font-normal text-slate-500 dark:text-zinc-400">
                                            (You)
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[11px] text-slate-500 dark:text-zinc-400">
                                        {acc.email} · {acc.provider}
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap">
                                      <span
                                        className={`font-medium ${
                                          acc.role === 'admin'
                                            ? 'text-blue-700 dark:text-blue-400'
                                            : 'text-slate-600 dark:text-zinc-400'
                                        }`}
                                      >
                                        {acc.isPrimaryOwner
                                          ? 'Owner Admin'
                                          : acc.role === 'admin'
                                            ? 'Administrator'
                                            : 'Standard User'}
                                      </span>
                                      {acc.status === 'suspended' && (
                                        <span className="ml-1.5 font-medium text-rose-600 dark:text-rose-400">
                                          · Suspended
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap">
                                      {acc.workspaceLocked ? (
                                        <span className="inline-flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
                                          <Lock className="h-3.5 w-3.5 shrink-0" />
                                          <span>Locked</span>
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                                          <Unlock className="h-3.5 w-3.5 shrink-0" />
                                          <span>Unlocked</span>
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700 dark:text-zinc-300">
                                      {acc.signInCount}
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono whitespace-nowrap tabular-nums text-slate-500 dark:text-zinc-400">
                                      {formatTimestamp(acc.lastSeenAt || acc.lastLoginAt)}
                                    </td>
                                    <td className="px-4 py-3 text-right whitespace-nowrap">
                                      {acc.isPrimaryOwner || isSelf ? (
                                        <span className="text-[11px] text-slate-400 dark:text-zinc-500">
                                          Protected
                                        </span>
                                      ) : (
                                        <div className="inline-flex items-center gap-1.5">
                                          {acc.role === 'admin' ? (
                                            <button
                                              type="button"
                                              disabled={busyAction !== null}
                                              onClick={() => void handleRevokeAdmin(acc.email)}
                                              className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                                            >
                                              Revoke Admin
                                            </button>
                                          ) : (
                                            <button
                                              type="button"
                                              disabled={busyAction !== null}
                                              onClick={() => void handlePromoteAccount(acc.email)}
                                              className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/70"
                                            >
                                              Make Admin
                                            </button>
                                          )}

                                          <button
                                            type="button"
                                            disabled={busyAction !== null}
                                            onClick={() =>
                                              void handleToggleAccountStatus(
                                                acc.email,
                                                acc.status === 'suspended' ? 'active' : 'suspended'
                                              )
                                            }
                                            className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium disabled:opacity-50 ${
                                              acc.status === 'suspended'
                                                ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900/60 dark:text-emerald-300 dark:hover:bg-emerald-950/40'
                                                : 'border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/40'
                                            }`}
                                          >
                                            {acc.status === 'suspended' ? 'Activate' : 'Suspend'}
                                          </button>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {section === 'controls' && (
                  <div className="space-y-4">
                    {/* Enforced Workspace Lock */}
                    <div className="rounded-2xl border border-slate-200/90 bg-white p-5 dark:border-zinc-800 dark:bg-[#191B1F]">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Lock className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                              Hazel Workspace Admin-Only Lock
                            </h2>
                          </div>
                          <p className="max-w-2xl text-xs leading-relaxed text-slate-600 dark:text-zinc-400">
                            Hazel Workspace Studio, Pro Coder reasoning, project folders, and live preview endpoints are permanently locked for all non-administrator and guest accounts. Only authenticated administrators can unlock Workspace.
                          </p>
                        </div>
                        <span className="font-mono text-xs font-semibold text-emerald-700 whitespace-nowrap dark:text-emerald-400">
                          Enforced
                        </span>
                      </div>
                    </div>

                    {/* Chat & Guest Policies for Non-Admins */}
                    <div className="divide-y divide-slate-200/80 rounded-2xl border border-slate-200/90 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-[#191B1F]">
                      <div className="flex items-center justify-between gap-4 p-5">
                        <div>
                          <div className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                            Allow Standard Accounts in Chat Mode
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-400">
                            Signed-in non-admin users can use everyday Hazel Chat while Workspace stays locked
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={data.policy.allowStandardChat}
                          disabled={busyAction !== null}
                          onClick={() =>
                            void handleTogglePolicy(
                              'allowStandardChat',
                              !data.policy.allowStandardChat
                            )
                          }
                          className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:opacity-50 ${
                            data.policy.allowStandardChat
                              ? 'bg-blue-600'
                              : 'bg-slate-300 dark:bg-zinc-700'
                          }`}
                        >
                          <span
                            className={`h-5 w-5 rounded-full bg-white transition-transform ${
                              data.policy.allowStandardChat ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-4 p-5">
                        <div>
                          <div className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                            Allow Guest (Signed-Out) Chat
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-400">
                            When off, visitors must sign in before sending messages in Chat mode
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={data.policy.allowGuestChat}
                          disabled={busyAction !== null}
                          onClick={() =>
                            void handleTogglePolicy('allowGuestChat', !data.policy.allowGuestChat)
                          }
                          className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:opacity-50 ${
                            data.policy.allowGuestChat
                              ? 'bg-blue-600'
                              : 'bg-slate-300 dark:bg-zinc-700'
                          }`}
                        >
                          <span
                            className={`h-5 w-5 rounded-full bg-white transition-transform ${
                              data.policy.allowGuestChat ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-4 p-5">
                        <div>
                          <div className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                            Allow Live Voice in Chat Mode for Non-Admins
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-400">
                            Controls real-time audio access in Chat mode (Workspace Live Voice is always Admin-only)
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={data.policy.allowLiveVoiceForNonAdmin}
                          disabled={busyAction !== null}
                          onClick={() =>
                            void handleTogglePolicy(
                              'allowLiveVoiceForNonAdmin',
                              !data.policy.allowLiveVoiceForNonAdmin
                            )
                          }
                          className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:opacity-50 ${
                            data.policy.allowLiveVoiceForNonAdmin
                              ? 'bg-blue-600'
                              : 'bg-slate-300 dark:bg-zinc-700'
                          }`}
                        >
                          <span
                            className={`h-5 w-5 rounded-full bg-white transition-transform ${
                              data.policy.allowLiveVoiceForNonAdmin
                                ? 'translate-x-5'
                                : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {section === 'audit' && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div
                        role="tablist"
                        aria-label="Filter security log"
                        className="inline-flex items-center gap-1 rounded-xl bg-slate-200/70 p-1 dark:bg-zinc-800"
                      >
                        {(
                          [
                            { id: 'all', label: 'All Events' },
                            { id: 'blocked', label: 'Blocked Only' },
                            { id: 'allowed', label: 'Allowed Only' },
                          ] as const
                        ).map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={auditFilter === tab.id}
                            onClick={() => setAuditFilter(tab.id)}
                            className={`rounded-lg px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                              auditFilter === tab.id
                                ? 'bg-white text-slate-900 shadow-xs dark:bg-zinc-700 dark:text-white'
                                : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleClearAudit()}
                        disabled={busyAction !== null || data.auditLog.length === 0}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-medium text-rose-700 whitespace-nowrap hover:bg-rose-100 disabled:opacity-45 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/70"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Clear Log</span>
                      </button>
                    </div>

                    <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white dark:border-zinc-800 dark:bg-[#191B1F]">
                      {filteredAudit.length === 0 ? (
                        <div className="px-5 py-10 text-center text-xs text-slate-500 dark:text-zinc-400">
                          No matching security log entries.
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse text-left text-xs">
                            <thead>
                              <tr className="border-b border-slate-200/80 bg-slate-50/70 text-[11px] font-semibold text-slate-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
                                <th className="px-4 py-3">Time</th>
                                <th className="px-4 py-3">Event</th>
                                <th className="px-4 py-3">Actor</th>
                                <th className="px-4 py-3">Outcome</th>
                                <th className="px-4 py-3">Detail</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70 dark:divide-zinc-800">
                              {filteredAudit.map((entry) => (
                                <tr
                                  key={entry.id}
                                  className="hover:bg-slate-50/80 dark:hover:bg-zinc-800/40"
                                >
                                  <td className="px-4 py-2.5 font-mono text-[11px] whitespace-nowrap tabular-nums text-slate-500 dark:text-zinc-400">
                                    {formatTimestamp(entry.timestamp)}
                                  </td>
                                  <td className="px-4 py-2.5 font-mono text-[11px] whitespace-nowrap text-slate-800 dark:text-zinc-200">
                                    {entry.event}
                                  </td>
                                  <td className="px-4 py-2.5 whitespace-nowrap">
                                    <span className="font-medium text-slate-900 dark:text-zinc-100">
                                      {entry.actorEmail}
                                    </span>
                                    <span className="ml-1 text-[11px] text-slate-500 dark:text-zinc-400">
                                      ({entry.actorRole})
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5 whitespace-nowrap">
                                    <span
                                      className={`font-semibold ${
                                        entry.allowed
                                          ? 'text-emerald-700 dark:text-emerald-400'
                                          : 'text-rose-700 dark:text-rose-400'
                                      }`}
                                    >
                                      {entry.allowed ? 'Allowed' : 'Blocked'}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5 text-slate-600 dark:text-zinc-300">
                                    {entry.detail}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
};
