import React from 'react';
import {
  ArrowRight,
  AudioLines,
  Code2,
  GraduationCap,
  LayoutPanelLeft,
  Lock,
  LogIn,
  LogOut,
  MessageSquare,
  Mic,
  Moon,
  Shield,
  Sun,
} from 'lucide-react';
import type { AuthUser } from '../services/authClient';
import type { AvatarGesture, ReasoningMode, ThemeMode } from '../types/chat';
import type { AuthModalMode } from './AuthModal';
import { LiveAvatar2D } from './LiveAvatar2D';
import { PWAInstallBanner, PWAInstallButton } from './PWAInstallButton';
import { SparkEmblem } from './SparkEmblem';

interface LandingWelcomePageProps {
  theme: ThemeMode;
  avatarGesture?: AvatarGesture;
  hasExistingChats: boolean;
  latestChatTitle?: string;
  authUser?: AuthUser | null;
  authLoading?: boolean;
  adminBootstrapAvailable?: boolean;
  onChangeTheme: (theme: ThemeMode) => void;
  onEnterChat: (options?: {
    mode?: ReasoningMode;
    starterPrompt?: string;
    startNew?: boolean;
  }) => void;
  onEnterWorkspace: () => void;
  onEnterAdmin: () => void;
  onTriggerHeyHazel: () => void;
  onOpenLive: () => void;
  onOpenAuth: (mode?: AuthModalMode, notice?: string) => void;
  onSignOut: () => void;
}

const CAPABILITY_CARDS: Array<{
  id: string;
  icon: React.FC<{ className?: string }>;
  title: string;
  description: string;
  actionLabel: string;
  mode: ReasoningMode;
  target: 'chat' | 'workspace' | 'voice';
  accentClass: string;
  starterPrompt?: string;
}> = [
  {
    id: 'conversation',
    icon: MessageSquare,
    title: 'Everyday Conversation',
    description:
      'Chat warmly like a friend about your day, swap everyday ideas, plan your week, or talk things through naturally.',
    actionLabel: 'Start chatting',
    mode: 'fast',
    target: 'chat',
    accentClass: 'text-blue-600 dark:text-blue-400',
  },
  {
    id: 'teacher',
    icon: GraduationCap,
    title: 'Teacher & Tutor',
    description:
      'Learn step by step from first principles with clear analogies, worked examples, and gentle practice questions.',
    actionLabel: 'Learn with Teacher',
    mode: 'teacher',
    target: 'chat',
    accentClass: 'text-amber-600 dark:text-amber-400',
    starterPrompt:
      'Teach me something fascinating step by step—ask me what topic or skill level I want to start with!',
  },
  {
    id: 'workspace',
    icon: LayoutPanelLeft,
    title: 'Build Workspace',
    description:
      'Build complete apps, explore AI/ML concepts, debug code, organize projects into folders, and preview live.',
    actionLabel: 'Open workspace',
    mode: 'coder',
    target: 'workspace',
    accentClass: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    id: 'voice',
    icon: Mic,
    title: '"Hey Hazel" Wake-Up Call',
    description:
      'Hands-free voice control with live audio level metering, command tracking, and natural spoken responses.',
    actionLabel: 'Say "Hey Hazel"',
    mode: 'fast',
    target: 'voice',
    accentClass: 'text-indigo-600 dark:text-indigo-400',
  },
];

export const LandingWelcomePage: React.FC<LandingWelcomePageProps> = ({
  theme,
  avatarGesture = 'idle',
  hasExistingChats,
  latestChatTitle,
  authUser = null,
  authLoading = false,
  adminBootstrapAvailable = false,
  onChangeTheme,
  onEnterChat,
  onEnterWorkspace,
  onEnterAdmin,
  onTriggerHeyHazel,
  onOpenLive,
  onOpenAuth,
  onSignOut,
}) => {
  const isAdmin = Boolean(authUser?.isAdmin);

  return (
    <div className="chat-scroll relative flex h-[100dvh] w-full flex-col overflow-y-auto bg-white text-slate-900 dark:bg-[#131314] dark:text-zinc-100">
      {/* Top Bar */}
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-200/70 bg-white/90 px-3 backdrop-blur-md sm:px-6 dark:border-zinc-800/80 dark:bg-[#131314]/90">
        <div className="flex items-center gap-2.5">
          <SparkEmblem size={26} />
          <span className="font-display text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
            Hazel
          </span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <PWAInstallButton variant="header" />

          {!authLoading &&
            (authUser ? (
              <>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={onEnterAdmin}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-emerald-200/90 bg-emerald-50/80 px-3 text-xs font-semibold text-emerald-800 whitespace-nowrap transition-colors hover:bg-emerald-100/80 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/70"
                  >
                    <Shield className="h-3.5 w-3.5 shrink-0" />
                    <span>Admin</span>
                  </button>
                )}
                <div className="inline-flex h-9 items-center gap-1 rounded-full border border-slate-200/90 bg-[#F4F6FA] pr-1 pl-2.5 text-xs dark:border-zinc-700/80 dark:bg-[#1E1F20]">
                  <span className="max-w-[140px] truncate font-medium text-slate-800 dark:text-zinc-100">
                    {isAdmin ? `Admin · ${authUser.fullName}` : authUser.fullName}
                  </span>
                  <button
                    type="button"
                    onClick={onSignOut}
                    aria-label="Sign out"
                    title="Sign out"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-white hover:text-rose-600 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-rose-400"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </button>
                </div>
              </>
            ) : (
              <>
                {adminBootstrapAvailable && (
                  <button
                    type="button"
                    onClick={() => onOpenAuth('claim_admin')}
                    className="hidden h-9 items-center gap-1.5 rounded-full border border-amber-200/90 bg-amber-50/80 px-3 text-xs font-semibold text-amber-800 whitespace-nowrap transition-colors hover:bg-amber-100/80 sm:inline-flex dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/70"
                  >
                    <Shield className="h-3.5 w-3.5 shrink-0" />
                    <span>Claim Admin</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onOpenAuth('signin')}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200/90 bg-white px-3 text-xs font-semibold text-slate-800 whitespace-nowrap transition-colors hover:border-blue-300 hover:bg-blue-50/60 dark:border-zinc-700/80 dark:bg-[#23252A] dark:text-zinc-100 dark:hover:border-blue-800 dark:hover:bg-zinc-800"
                >
                  <LogIn className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  <span>Sign in</span>
                </button>
              </>
            ))}

          <button
            type="button"
            onClick={() => onChangeTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200/90 bg-[#F4F6FA] text-slate-700 transition-colors hover:bg-slate-200/70 dark:border-zinc-700/80 dark:bg-[#1E1F20] dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {theme === 'dark' ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>
        </div>
      </header>

      <PWAInstallBanner />

      {/* Main Welcome Stage */}
      <main className="flex flex-1 justify-center px-3 py-4 sm:px-8 sm:py-10">
        <div className="my-auto flex w-full max-w-[920px] flex-col justify-center rounded-3xl border border-slate-200/80 bg-[#F8FAFD]/80 p-5 shadow-xs sm:p-8 lg:p-10 dark:border-zinc-800/90 dark:bg-[#18191C]/90">

          {/* Hero Section */}
          <div className="flex flex-col-reverse items-center justify-between gap-6 md:flex-row md:items-center md:gap-8">
            <div className="max-w-xl space-y-4">
              <div className="inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-blue-600 uppercase dark:text-blue-400">
                <SparkEmblem size={18} />
                <span>Welcome to Hazel</span>
              </div>

              <h1 className="font-display bg-gradient-to-r from-slate-950 via-blue-700 to-indigo-600 bg-clip-text text-[clamp(1.85rem,4vw,2.85rem)] leading-[1.12] font-semibold tracking-tight text-transparent dark:from-white dark:via-blue-300 dark:to-indigo-300">
                Think, learn, build, and talk — all in one place.
              </h1>

              <p className="text-[clamp(0.92rem,1.4vw,1.05rem)] leading-relaxed text-slate-600 dark:text-zinc-300">
                Start an easy everyday conversation, learn step by step with Teacher mode, open the full Build Workspace, or wake Hazel hands-free by saying{' '}
                <span className="font-semibold text-slate-900 dark:text-white">
                  &ldquo;Hey Hazel&rdquo;
                </span>
                .
              </p>

              {/* Primary Entry Actions */}
              <div className="flex flex-wrap items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => onEnterChat({ mode: 'fast', startNew: false })}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-blue-600 px-5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-blue-700 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:bg-blue-500 dark:hover:bg-blue-400"
                >
                  <MessageSquare className="h-4 w-4 shrink-0" />
                  <span>
                    {hasExistingChats && latestChatTitle
                      ? 'Continue Chat'
                      : 'Start Conversation'}
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => onEnterChat({ mode: 'teacher', startNew: true })}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 transition-colors hover:border-amber-300 hover:bg-amber-50/50 dark:border-zinc-700 dark:bg-[#23252A] dark:text-zinc-100 dark:hover:border-amber-700/60 dark:hover:bg-amber-950/30"
                >
                  <GraduationCap className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>Teacher Mode</span>
                </button>

                <button
                  type="button"
                  onClick={onEnterWorkspace}
                  title={isAdmin ? 'Open Hazel Workspace' : 'Hazel Workspace is locked (Admin only)'}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 whitespace-nowrap transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-zinc-700 dark:bg-[#23252A] dark:text-zinc-100 dark:hover:bg-zinc-800"
                >
                  {isAdmin ? (
                    <Code2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Lock className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  )}
                  <span>Workspace</span>
                  {!isAdmin && (
                    <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                      · Locked
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={onOpenLive}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-zinc-700 dark:bg-[#23252A] dark:text-zinc-100 dark:hover:bg-zinc-800"
                >
                  <AudioLines className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                  <span>Talk Live</span>
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={onOpenLive}
              title="Talk Live with Hazel"
              aria-label="Talk Live with Hazel"
              className="group relative flex shrink-0 flex-col items-center rounded-3xl border border-slate-200/80 bg-gradient-to-b from-blue-50/90 via-white/90 to-slate-100/80 px-4 pt-3 shadow-xs transition-all hover:border-blue-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-blue-600 dark:border-zinc-800 dark:from-blue-950/35 dark:via-[#1D2028] dark:to-[#18191D] dark:hover:border-blue-800/70"
            >
              <LiveAvatar2D size="md" gesture={avatarGesture} />
              <span className="pb-3 text-[11.5px] font-medium text-slate-500 transition-colors group-hover:text-blue-600 dark:text-zinc-400 dark:group-hover:text-blue-400">
                Tap to talk live
              </span>
            </button>
          </div>

          {/* Four Mode Cards */}
          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {CAPABILITY_CARDS.map((card) => {
              const Icon = card.icon;
              const isLockedWorkspace = card.target === 'workspace' && !isAdmin;
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => {
                    if (card.target === 'workspace') {
                      onEnterWorkspace();
                    } else if (card.target === 'voice') {
                      onTriggerHeyHazel();
                    } else {
                      onEnterChat({
                        mode: card.mode,
                        starterPrompt: card.starterPrompt,
                        startNew: true,
                      });
                    }
                  }}
                  className={`group flex flex-col justify-between rounded-2xl border p-4 text-left transition-all active:scale-[0.995] focus-visible:outline-2 focus-visible:outline-blue-600 ${
                    isLockedWorkspace
                      ? 'border-slate-200/80 bg-slate-50/80 hover:border-amber-300 dark:border-zinc-800 dark:bg-[#1B1D21] dark:hover:border-amber-800/60'
                      : 'border-slate-200/90 bg-white hover:border-blue-300 hover:shadow-sm dark:border-zinc-800 dark:bg-[#202226] dark:hover:border-zinc-700'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {isLockedWorkspace ? (
                          <Lock className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                        ) : (
                          <Icon className={`h-4 w-4 shrink-0 ${card.accentClass}`} />
                        )}
                        <span className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                          {card.title}
                        </span>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-blue-600 dark:text-zinc-500 dark:group-hover:text-blue-400" />
                    </div>
                    <p className="text-xs leading-relaxed text-slate-600 dark:text-zinc-400">
                      {isLockedWorkspace
                        ? 'Locked for standard & guest accounts. Administrator sign-in is required for coding tools, folders, and live previews.'
                        : card.description}
                    </p>
                  </div>
                  <div
                    className={`mt-3 flex items-center gap-1.5 text-[11.5px] font-semibold ${
                      isLockedWorkspace
                        ? 'text-amber-700 dark:text-amber-300'
                        : 'text-blue-600 dark:text-blue-400'
                    }`}
                  >
                    {isLockedWorkspace ? (
                      <span>Locked · Admin only</span>
                    ) : (
                      <span>{card.actionLabel}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
};
