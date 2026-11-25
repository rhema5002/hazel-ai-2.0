import React from 'react';
import {
  ArrowLeft,
  Code2,
  FolderKanban,
  Lock,
  LogIn,
  LogOut,
  ShieldAlert,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import type { AuthUser } from '../services/authClient';
import type { AuthModalMode } from './AuthModal';

interface WorkspaceLockedViewProps {
  authUser: AuthUser | null;
  adminBootstrapAvailable: boolean;
  onOpenAuth: (mode?: AuthModalMode, notice?: string) => void;
  onSignOut: () => void;
  onReturnToChat: () => void;
}

export const WorkspaceLockedView: React.FC<WorkspaceLockedViewProps> = ({
  authUser,
  adminBootstrapAvailable,
  onOpenAuth,
  onSignOut,
  onReturnToChat,
}) => {
  return (
    <section
      aria-label="Hazel Workspace Locked"
      className="chat-scroll flex h-full min-h-0 w-full flex-1 flex-col overflow-y-auto bg-[#F8FAFD] p-3 sm:p-8 dark:bg-[#141517]"
    >
      <div className="mx-auto my-auto w-full max-w-xl rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs sm:rounded-3xl sm:p-8 dark:border-zinc-800 dark:bg-[#191B1F]">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
            <Lock className="h-5 w-5" aria-hidden="true" />
          </div>

          <div className="min-w-0 flex-1 space-y-1.5">
            <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl dark:text-white">
              Hazel Workspace is Locked
            </h1>
            <p className="text-sm leading-relaxed text-slate-600 dark:text-zinc-300">
              Access to Hazel Workspace Studio, Pro Coder, project folders, and live app previews is restricted to the administrator account.
            </p>
          </div>
        </div>

        {/* Account Status Strip */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200/80 bg-[#F8FAFD] px-4 py-3 text-xs dark:border-zinc-800 dark:bg-[#131417]">
          <div className="flex min-w-0 items-center gap-2 text-slate-700 dark:text-zinc-300">
            <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            {authUser ? (
              <span className="truncate">
                Signed in as <span className="font-semibold text-slate-900 dark:text-white">{authUser.email}</span>
                <span aria-hidden="true" className="mx-1.5 text-slate-400">·</span>
                <span>Standard account</span>
              </span>
            ) : (
              <span>
                Guest session
                <span aria-hidden="true" className="mx-1.5 text-slate-400">·</span>
                <span>Not signed in</span>
              </span>
            )}
          </div>
          <span className="font-mono text-[11px] font-medium text-amber-700 whitespace-nowrap dark:text-amber-300">
            Workspace Locked
          </span>
        </div>

        {/* Restricted Capabilities List */}
        <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200/75 bg-slate-50/70 p-3 dark:border-zinc-800/80 dark:bg-zinc-900/40">
            <Code2 className="h-4 w-4 text-slate-500 dark:text-zinc-400" aria-hidden="true" />
            <div className="mt-2 text-xs font-semibold text-slate-900 dark:text-zinc-100">
              Pro Coder
            </div>
            <p className="mt-0.5 text-[11.5px] leading-snug text-slate-500 dark:text-zinc-400">
              Full-stack &amp; AI systems generation
            </p>
          </div>

          <div className="rounded-xl border border-slate-200/75 bg-slate-50/70 p-3 dark:border-zinc-800/80 dark:bg-zinc-900/40">
            <Terminal className="h-4 w-4 text-slate-500 dark:text-zinc-400" aria-hidden="true" />
            <div className="mt-2 text-xs font-semibold text-slate-900 dark:text-zinc-100">
              Live Preview
            </div>
            <p className="mt-0.5 text-[11.5px] leading-snug text-slate-500 dark:text-zinc-400">
              Interactive app &amp; split code view
            </p>
          </div>

          <div className="rounded-xl border border-slate-200/75 bg-slate-50/70 p-3 dark:border-zinc-800/80 dark:bg-zinc-900/40">
            <FolderKanban className="h-4 w-4 text-slate-500 dark:text-zinc-400" aria-hidden="true" />
            <div className="mt-2 text-xs font-semibold text-slate-900 dark:text-zinc-100">
              Project Folders
            </div>
            <p className="mt-0.5 text-[11.5px] leading-snug text-slate-500 dark:text-zinc-400">
              Organized build workspaces &amp; exports
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex flex-wrap items-center gap-2.5 border-t border-slate-200/80 pt-5 dark:border-zinc-800">
          {authUser ? (
            <>
              <button
                type="button"
                onClick={() => {
                  onSignOut();
                  onOpenAuth(
                    'signin',
                    'Sign in with an administrator account to unlock Hazel Workspace.'
                  );
                }}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white whitespace-nowrap transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
              >
                <LogOut className="h-3.5 w-3.5 shrink-0" />
                <span>Switch to Admin Account</span>
              </button>
              <button
                type="button"
                onClick={onReturnToChat}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-medium text-slate-700 whitespace-nowrap transition-colors hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
                <span>Return to Chat</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() =>
                  onOpenAuth(
                    adminBootstrapAvailable ? 'claim_admin' : 'signin',
                    adminBootstrapAvailable
                      ? 'Claim initial administrator access to unlock Hazel Workspace.'
                      : 'Sign in with your administrator account to unlock Hazel Workspace.'
                  )
                }
                className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white whitespace-nowrap transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
              >
                {adminBootstrapAvailable ? (
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <LogIn className="h-3.5 w-3.5 shrink-0" />
                )}
                <span>
                  {adminBootstrapAvailable ? 'Claim Admin Access' : 'Sign in as Admin'}
                </span>
              </button>
              <button
                type="button"
                onClick={onReturnToChat}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-medium text-slate-700 whitespace-nowrap transition-colors hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
                <span>Continue in Chat</span>
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
};
