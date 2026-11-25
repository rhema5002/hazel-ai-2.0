import { useCallback, useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

// Capture beforeinstallprompt at module load so it is never missed before components mount
let cachedDeferredPrompt: BeforeInstallPromptEvent | null = null;
let cachedInstalled = false;
const listeners = new Set<() => void>();

function notifyListeners() {
  for (const fn of listeners) fn();
}

if (typeof window !== 'undefined') {
  const isStandaloneInit =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  cachedInstalled = isStandaloneInit;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    cachedDeferredPrompt = e as BeforeInstallPromptEvent;
    notifyListeners();
  });

  window.addEventListener('appinstalled', () => {
    cachedInstalled = true;
    cachedDeferredPrompt = null;
    notifyListeners();
  });
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(cachedDeferredPrompt);
  const [isInstalled, setIsInstalled] = useState<boolean>(cachedInstalled);
  const [isIOS, setIsIOS] = useState(false);
  const [isInIframe, setIsInIframe] = useState(false);

  useEffect(() => {
    const sync = () => {
      setDeferredPrompt(cachedDeferredPrompt);
      setIsInstalled(cachedInstalled);
    };

    listeners.add(sync);
    sync();

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));
    try {
      setIsInIframe(window.self !== window.top);
    } catch {
      setIsInIframe(true);
    }

    const mediaQuery = window.matchMedia?.('(display-mode: standalone)');
    const onDisplayModeChange = (ev: MediaQueryListEvent) => {
      if (ev.matches) {
        cachedInstalled = true;
        cachedDeferredPrompt = null;
        notifyListeners();
      }
    };
    mediaQuery?.addEventListener?.('change', onDisplayModeChange);

    return () => {
      listeners.delete(sync);
      mediaQuery?.removeEventListener?.('change', onDisplayModeChange);
    };
  }, []);

  const install = useCallback(async () => {
    const promptEvent = cachedDeferredPrompt;
    if (!promptEvent) return false;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === 'accepted') {
      cachedInstalled = true;
      cachedDeferredPrompt = null;
      notifyListeners();
      return true;
    }
    return false;
  }, []);

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    isInIframe,
    install,
  };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
