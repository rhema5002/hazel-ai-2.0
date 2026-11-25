import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Share,
  Smartphone,
  WifiOff,
  X,
} from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';
import { SparkEmblem } from './SparkEmblem';

const BANNER_DISMISSED_KEY = 'hazel_pwa_banner_dismissed_v1';
const BANNER_DISMISS_EVENT = 'hazel-pwa-banner-dismissed';

interface InstallGuideDialogProps {
  isOpen: boolean;
  isIOS: boolean;
  isInIframe: boolean;
  onClose: () => void;
}

const InstallGuideDialog: React.FC<InstallGuideDialogProps> = ({
  isOpen,
  isIOS,
  isInIframe,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Install Hazel web app"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
    >
      <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-[#18191C]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
              <Smartphone className="h-4.5 w-4.5" />
            </div>
            <div>
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Install Hazel Web App
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400">
                Run Hazel standalone on your device
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close install instructions"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isIOS ? (
          <ol className="mt-4 space-y-2.5 rounded-2xl bg-slate-50 p-3.5 text-xs leading-relaxed text-slate-700 dark:bg-zinc-900/60 dark:text-zinc-300">
            <li className="flex items-start gap-2">
              <span className="font-semibold text-blue-600 dark:text-blue-400">1.</span>
              <span>
                Tap the{' '}
                <strong className="inline-flex items-center gap-1 font-semibold">
                  <Share className="h-3.5 w-3.5" /> Share
                </strong>{' '}
                button in Safari&apos;s toolbar.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-semibold text-blue-600 dark:text-blue-400">2.</span>
              <span>
                Scroll down and tap{' '}
                <strong className="font-semibold">Add to Home Screen</strong>.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-semibold text-blue-600 dark:text-blue-400">3.</span>
              <span>
                Tap <strong className="font-semibold">Add</strong> to launch Hazel
                like a native app.
              </span>
            </li>
          </ol>
        ) : (
          <div className="mt-4 space-y-3 rounded-2xl bg-slate-50 p-3.5 text-xs leading-relaxed text-slate-700 dark:bg-zinc-900/60 dark:text-zinc-300">
            {isInIframe && (
              <p>
                Browsers only allow installing PWAs from a full browser tab (not
                inside an embedded preview frame). Open Hazel in its own tab first:
              </p>
            )}
            {isInIframe && typeof window !== 'undefined' && (
              <a
                href={window.location.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Open Hazel in New Tab to Install</span>
              </a>
            )}
            <p>
              In Chrome, Edge, or Safari, click the{' '}
              <strong className="font-semibold">Install Hazel</strong> icon in the
              address bar (or open your browser menu &rarr;{' '}
              <strong className="font-semibold">Install app / Add to Home Screen</strong>).
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-4 min-h-[38px] w-full rounded-xl bg-slate-100 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          Got it
        </button>
      </div>
    </div>
  );
};

interface PWAInstallButtonProps {
  variant?: 'header' | 'settings' | 'sidebar';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'header',
}) => {
  const { isInstallable, isInstalled, isIOS, isInIframe, install } =
    usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled && (variant === 'header' || variant === 'sidebar')) {
    return null;
  }

  if (isInstalled && variant === 'settings') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span>Installed</span>
      </span>
    );
  }

  const handleClick = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (!accepted) return;
      return;
    }
    setShowGuide(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        aria-label="Install Hazel web application"
        title={
          isInstallable
            ? 'Install Hazel app to your device'
            : 'How to install Hazel as a web app'
        }
        className={
          variant === 'settings'
            ? 'inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400'
            : variant === 'sidebar'
              ? 'flex min-h-[38px] w-full items-center gap-2.5 rounded-xl px-2.5 text-[13px] font-medium text-blue-700 transition-colors hover:bg-blue-50 hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-blue-300 dark:hover:bg-blue-950/40 dark:hover:text-blue-200'
              : 'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 whitespace-nowrap transition-colors hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-blue-600 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-950/80'
        }
      >
        <Download
          className={
            variant === 'sidebar' ? 'h-4 w-4 shrink-0' : 'h-3.5 w-3.5 shrink-0'
          }
        />
        <span>
          {variant === 'sidebar' ? 'Install Web App' : 'Install App'}
        </span>
      </button>

      <InstallGuideDialog
        isOpen={showGuide}
        isIOS={isIOS}
        isInIframe={isInIframe}
        onClose={() => setShowGuide(false)}
      />
    </>
  );
};

export const PWAInstallBanner: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, isInIframe, install } =
    usePWAInstall();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(BANNER_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    const syncDismissed = () => {
      try {
        setDismissed(window.localStorage.getItem(BANNER_DISMISSED_KEY) === '1');
      } catch {
        // Ignore storage restrictions
      }
    };
    window.addEventListener(BANNER_DISMISS_EVENT, syncDismissed);
    return () => {
      window.removeEventListener(BANNER_DISMISS_EVENT, syncDismissed);
    };
  }, []);

  if (isInstalled || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(BANNER_DISMISSED_KEY, '1');
    } catch {
      // Ignore storage quota errors
    }
    window.dispatchEvent(new Event(BANNER_DISMISS_EVENT));
  };

  const handleInstallAction = async () => {
    if (isInstallable) {
      await install();
      return;
    }
    setShowGuide(true);
  };

  return (
    <>
      <div
        role="region"
        aria-label="Install Hazel web app"
        className="shrink-0 border-b border-blue-200/70 bg-gradient-to-r from-blue-50/90 via-indigo-50/75 to-sky-50/90 px-3 py-2 sm:px-5 dark:border-blue-900/50 dark:from-blue-950/40 dark:via-indigo-950/35 dark:to-slate-900/60"
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white shadow-xs ring-1 ring-blue-200/70 dark:bg-[#1E1F20] dark:ring-blue-800/50">
              <SparkEmblem size={20} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-slate-900 sm:text-[13px] dark:text-white">
                Install Hazel on your device
              </p>
              <p className="truncate text-[11px] text-slate-600 dark:text-zinc-300">
                {isInstallable
                  ? 'Add to your home screen or desktop for instant standalone access and offline support.'
                  : isIOS
                    ? 'Add Hazel to your Home Screen in Safari for a full-screen app experience.'
                    : 'Run Hazel as a standalone desktop or mobile app with offline cache.'}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleInstallAction()}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-blue-600 dark:bg-blue-500 dark:hover:bg-blue-400"
            >
              <Download className="h-3.5 w-3.5 shrink-0" />
              <span>{isInstallable ? 'Install' : 'How to Install'}</span>
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss install banner"
              title="Dismiss"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-black/5 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <InstallGuideDialog
        isOpen={showGuide}
        isIOS={isIOS}
        isInIframe={isInIframe}
        onClose={() => setShowGuide(false)}
      />
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl border border-amber-400/50 bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white shadow-lg"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>Offline Mode — Cached app &amp; local chat history active</span>
    </div>
  );
};
