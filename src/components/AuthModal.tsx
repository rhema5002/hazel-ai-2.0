import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';
import {
  claimAdminAccount,
  requestPasswordReset,
  signInWithEmail,
  signUpWithEmail,
  updateAccountPassword,
  type AuthUser,
} from '../services/authClient';
import { SparkEmblem } from './SparkEmblem';

export type AuthModalMode =
  | 'signin'
  | 'signup'
  | 'reset'
  | 'claim_admin'
  | 'update_password';

interface AuthModalProps {
  isOpen: boolean;
  initialMode?: AuthModalMode;
  authConfigured: boolean;
  adminBootstrapAvailable?: boolean;
  contextNotice?: string | null;
  onClose: () => void;
  onSuccess: (user: AuthUser) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  initialMode = 'signin',
  authConfigured,
  adminBootstrapAvailable = false,
  contextNotice = null,
  onClose,
  onSuccess,
}) => {
  const [mode, setMode] = useState<AuthModalMode>(initialMode);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const wasOpenRef = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const justOpened = isOpen && !wasOpenRef.current;
    wasOpenRef.current = isOpen;
    if (!justOpened) return;

    const resolvedInitial: AuthModalMode =
      initialMode === 'claim_admin' && !adminBootstrapAvailable ? 'signin' : initialMode;
    setMode(resolvedInitial);
    setError(null);
    setInfoMessage(null);
    setPassword('');
    setConfirmPassword('');
    setPasswordUpdated(false);
    setShowPassword(false);
    setSubmitting(false);
  }, [isOpen, initialMode, adminBootstrapAvailable]);

  useEffect(() => {
    if (error) {
      errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [error]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, submitting, onClose]);

  if (!isOpen) return null;

  const switchMode = (next: AuthModalMode) => {
    setMode(next);
    setError(null);
    setInfoMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setInfoMessage(null);

    if (mode === 'update_password') {
      if (password.length < 8) {
        setError('New password must be at least 8 characters long.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
      setSubmitting(true);
      try {
        await updateAccountPassword(password);
        setPassword('');
        setConfirmPassword('');
        setPasswordUpdated(true);
        setInfoMessage('Your password has been updated and your account is signed in.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update password.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Please enter your email address.');
      return;
    }

    if (mode !== 'reset' && !password) {
      setError('Please enter your password.');
      return;
    }

    if ((mode === 'signup' || mode === 'claim_admin') && password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'signin') {
        const user = await signInWithEmail(trimmedEmail, password);
        onClose();
        onSuccess(user);
      } else if (mode === 'claim_admin') {
        const user = await claimAdminAccount(trimmedEmail, password, fullName.trim());
        onClose();
        onSuccess(user);
      } else if (mode === 'signup') {
        const res = await signUpWithEmail(trimmedEmail, password, fullName.trim());
        if (res.requiresEmailConfirmation) {
          setInfoMessage(
            `Account created for ${res.user.email}. Check your inbox for a confirmation link before signing in.`
          );
          setMode('signin');
          setPassword('');
        } else {
          onClose();
          onSuccess(res.user);
        }
      } else {
        const msg = await requestPasswordReset(trimmedEmail);
        setInfoMessage(msg);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={
        mode === 'update_password'
          ? 'Set new password'
          : mode === 'claim_admin'
            ? 'Claim Administrator Access'
            : mode === 'signin'
              ? 'Sign in to Hazel'
              : mode === 'signup'
                ? 'Create a Hazel account'
                : 'Reset password'
      }
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-xs"
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-[#18191C]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b border-slate-200/80 px-5 py-4 dark:border-zinc-800">
          <div className="flex min-w-0 items-center gap-3">
            <SparkEmblem size={32} />
            <div className="min-w-0">
              <h2 className="font-display truncate text-lg font-semibold text-slate-900 dark:text-white">
                {mode === 'update_password'
                  ? 'Set new password'
                  : mode === 'claim_admin'
                    ? 'Claim Admin Access'
                    : mode === 'signin'
                      ? 'Sign in to Hazel'
                      : mode === 'signup'
                        ? 'Create your account'
                        : 'Reset password'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-zinc-400">
                {mode === 'update_password'
                  ? 'Choose a new password for your account'
                  : mode === 'reset'
                    ? 'Receive a password recovery link via email'
                    : mode === 'claim_admin'
                      ? 'Set your first-run administrator password'
                      : authConfigured
                        ? 'Secured by Supabase Authentication'
                        : 'Local server-verified account session'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close sign in dialog"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="chat-scroll space-y-4 overflow-y-auto p-5">
          {contextNotice && (
            <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
              <span>{contextNotice}</span>
            </div>
          )}

          {!authConfigured && adminBootstrapAvailable && mode !== 'claim_admin' && mode !== 'update_password' && (
            <div className="flex items-start justify-between gap-2.5 rounded-2xl border border-amber-200 bg-amber-50/90 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>
                  First-run setup: Claim your administrator password to unlock Hazel Workspace &amp; Admin Panel.
                </span>
              </div>
              <button
                type="button"
                onClick={() => switchMode('claim_admin')}
                className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white whitespace-nowrap hover:bg-amber-700"
              >
                Claim Admin
              </button>
            </div>
          )}

          {mode !== 'reset' && mode !== 'update_password' && (
            <div
              role="tablist"
              aria-label="Authentication mode"
              className={`grid rounded-xl bg-slate-100 p-1 dark:bg-zinc-800 ${
                adminBootstrapAvailable ? 'grid-cols-3' : 'grid-cols-2'
              }`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'signin'}
                onClick={() => switchMode('signin')}
                className={`min-h-[36px] rounded-lg px-2 text-xs font-semibold whitespace-nowrap transition-colors ${
                  mode === 'signin'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-zinc-700 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'signup'}
                onClick={() => switchMode('signup')}
                className={`min-h-[36px] rounded-lg px-2 text-xs font-semibold whitespace-nowrap transition-colors ${
                  mode === 'signup'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-zinc-700 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                Create account
              </button>
              {adminBootstrapAvailable && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'claim_admin'}
                  onClick={() => switchMode('claim_admin')}
                  className={`min-h-[36px] rounded-lg px-2 text-xs font-semibold whitespace-nowrap transition-colors ${
                    mode === 'claim_admin'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-zinc-700 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  Claim Admin
                </button>
              )}
            </div>
          )}

          {error && (
            <div
              ref={errorRef}
              role="alert"
              aria-live="assertive"
              className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {infoMessage && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>{infoMessage}</span>
            </div>
          )}

          {mode === 'update_password' && passwordUpdated ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white whitespace-nowrap shadow-xs transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
            >
              Continue to Hazel
            </button>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5" noValidate>
              {(mode === 'signup' || mode === 'claim_admin') && (
                <div className="space-y-1">
                  <label
                    htmlFor="auth-full-name"
                    className="block text-xs font-medium text-slate-700 dark:text-zinc-300"
                  >
                    Name (optional)
                  </label>
                  <div className="relative flex items-center">
                    <User
                      className="pointer-events-none absolute left-3 h-4 w-4 text-slate-400 dark:text-zinc-500"
                      aria-hidden="true"
                    />
                    <input
                      id="auth-full-name"
                      type="text"
                      autoComplete="name"
                      maxLength={80}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder={mode === 'claim_admin' ? 'Owner Admin' : 'Alex Rivera'}
                      className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder:text-zinc-500"
                    />
                  </div>
                </div>
              )}

              {mode !== 'update_password' && (
                <div className="space-y-1">
                  <label
                    htmlFor="auth-email"
                    className="block text-xs font-medium text-slate-700 dark:text-zinc-300"
                  >
                    {mode === 'claim_admin' ? 'Owner administrator email' : 'Email address'}
                  </label>
                  <div className="relative flex items-center">
                    <Mail
                      className="pointer-events-none absolute left-3 h-4 w-4 text-slate-400 dark:text-zinc-500"
                      aria-hidden="true"
                    />
                    <input
                      id="auth-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder:text-zinc-500"
                    />
                  </div>
                </div>
              )}

              {mode !== 'reset' && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="auth-password"
                      className="block text-xs font-medium text-slate-700 dark:text-zinc-300"
                    >
                      {mode === 'update_password' ? 'New password' : 'Password'}
                    </label>
                    {mode === 'signin' && authConfigured && (
                      <button
                        type="button"
                        onClick={() => switchMode('reset')}
                        className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="relative flex items-center">
                    <Lock
                      className="pointer-events-none absolute left-3 h-4 w-4 text-slate-400 dark:text-zinc-500"
                      aria-hidden="true"
                    />
                    <input
                      id="auth-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={
                        mode === 'signup' || mode === 'claim_admin' || mode === 'update_password'
                          ? 8
                          : 1
                      }
                      maxLength={128}
                      autoComplete={
                        mode === 'signup' || mode === 'claim_admin' || mode === 'update_password'
                          ? 'new-password'
                          : 'current-password'
                      }
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={
                        mode === 'signup' || mode === 'claim_admin' || mode === 'update_password'
                          ? 'At least 8 characters'
                          : 'Enter your password'
                      }
                      className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pr-10 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder:text-zinc-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2 inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {mode === 'update_password' && (
                <div className="space-y-1">
                  <label
                    htmlFor="auth-confirm-password"
                    className="block text-xs font-medium text-slate-700 dark:text-zinc-300"
                  >
                    Confirm new password
                  </label>
                  <div className="relative flex items-center">
                    <Lock
                      className="pointer-events-none absolute left-3 h-4 w-4 text-slate-400 dark:text-zinc-500"
                      aria-hidden="true"
                    />
                    <input
                      id="auth-confirm-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      maxLength={128}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter new password"
                      className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder:text-zinc-500"
                    />
                  </div>
                </div>
              )}

              {mode === 'signup' && (
                <p className="text-[11.5px] leading-relaxed text-slate-500 dark:text-zinc-400">
                  Standard accounts have full access to Hazel Chat. Hazel Workspace remains locked for administrator accounts only.
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white whitespace-nowrap shadow-xs transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-400"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>
                  {submitting
                    ? mode === 'update_password'
                      ? 'Updating password...'
                      : mode === 'claim_admin'
                        ? 'Claiming Admin...'
                        : mode === 'signin'
                          ? 'Signing in...'
                          : mode === 'signup'
                            ? 'Creating account...'
                            : 'Sending reset link...'
                    : mode === 'update_password'
                      ? 'Update password'
                      : mode === 'claim_admin'
                        ? 'Claim Admin & Unlock'
                        : mode === 'signin'
                          ? 'Sign in'
                          : mode === 'signup'
                            ? 'Create account'
                            : 'Send reset link'}
                </span>
              </button>
            </form>
          )}

          {mode === 'reset' && (
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className="w-full text-center text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"
            >
              Back to Sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
