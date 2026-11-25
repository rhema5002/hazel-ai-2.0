import { isInAppCaptureSupported } from './inAppScreenCapture';

export type ScreenCaptureMode = 'native' | 'in-app' | 'unsupported';

export interface ScreenCaptureCapability {
  /** True whenever native `getDisplayMedia` OR built-in in-app screen capture is supported. */
  supported: boolean;
  /** True when native `navigator.mediaDevices.getDisplayMedia` is exposed by the browser. */
  nativeSupported: boolean;
  /** True when built-in `canvas.captureStream` in-app screen capture is supported. */
  inAppSupported: boolean;
  /** Preferred active capture mode for this runtime. */
  mode: ScreenCaptureMode;
  /** True when the app should allow invoking screen sharing / test share. */
  canAttempt: boolean;
  /** True when running inside an installed standalone/fullscreen/minimal-ui PWA window. */
  isStandalonePwa: boolean;
  /** True when running on a mobile/tablet OS browser. */
  isMobilePlatform: boolean;
  /** True when the document is not in a secure HTTPS/localhost context. */
  insecureContext: boolean;
  /** True when Permissions-Policy / Feature-Policy explicitly disallows `display-capture`. */
  policyBlocked: boolean;
  /** Concise status label for UI rows. */
  shortLabel: string;
  /** Helpful detail note for the current mode or restriction, or null when standard native mode is ready. */
  reason: string | null;
}

export interface ScreenCaptureErrorDetails {
  message: string;
  isCancellation: boolean;
  isPolicyBlocked: boolean;
  isUnsupported: boolean;
}

interface DocumentWithPermissionsPolicy extends Document {
  permissionsPolicy?: {
    allowsFeature?: (feature: string) => boolean;
  };
  featurePolicy?: {
    allowsFeature?: (feature: string) => boolean;
  };
}

function detectStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const standaloneMedia =
      typeof window.matchMedia === 'function' &&
      (window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches ||
        window.matchMedia('(display-mode: minimal-ui)').matches);
    const iosStandalone =
      typeof navigator !== 'undefined' &&
      'standalone' in navigator &&
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    return Boolean(standaloneMedia || iosStandalone);
  } catch {
    return false;
  }
}

function detectMobilePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const uaDataMobile = (navigator as Navigator & { userAgentData?: { mobile?: boolean } })
    .userAgentData?.mobile;
  if (uaDataMobile === true) return true;
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua)) {
    return true;
  }
  return (
    /Macintosh/i.test(ua) &&
    typeof navigator.maxTouchPoints === 'number' &&
    navigator.maxTouchPoints > 1
  );
}

function checkDisplayCapturePolicy(): boolean {
  if (typeof document === 'undefined') return true;
  try {
    const doc = document as DocumentWithPermissionsPolicy;
    if (typeof doc.permissionsPolicy?.allowsFeature === 'function') {
      return doc.permissionsPolicy.allowsFeature('display-capture');
    }
    if (typeof doc.featurePolicy?.allowsFeature === 'function') {
      return doc.featurePolicy.allowsFeature('display-capture');
    }
  } catch {
    // Ignore policy introspection errors and allow runtime attempt
  }
  return true;
}

/**
 * Checks runtime screen-sharing support across both native `getDisplayMedia`
 * and built-in in-app screen capture (`canvas.captureStream`), without browser allowlists or PWA blocks.
 */
export function getScreenCaptureCapability(): ScreenCaptureCapability {
  const isStandalonePwa = detectStandalonePwa();
  const isMobilePlatform = detectMobilePlatform();
  const insecureContext = typeof window !== 'undefined' && window.isSecureContext === false;

  const nativeSupported =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function';
  const inAppSupported = isInAppCaptureSupported();

  const policyAllowed = checkDisplayCapturePolicy();
  const policyBlocked = !policyAllowed;

  if (nativeSupported && !policyBlocked) {
    return {
      supported: true,
      nativeSupported: true,
      inAppSupported,
      mode: 'native',
      canAttempt: true,
      isStandalonePwa,
      isMobilePlatform,
      insecureContext,
      policyBlocked: false,
      shortLabel: 'Ready on prompt',
      reason: null,
    };
  }

  if (inAppSupported) {
    if (nativeSupported && policyBlocked) {
      return {
        supported: true,
        nativeSupported: true,
        inAppSupported: true,
        mode: 'in-app',
        canAttempt: true,
        isStandalonePwa,
        isMobilePlatform,
        insecureContext,
        policyBlocked: true,
        shortLabel: 'Supported (In-app & upload)',
        reason:
          'This embedded frame restricts the OS screen picker, so Hazel uses built-in in-app screen capture, recording, and screenshot/video import.',
      };
    }

    return {
      supported: true,
      nativeSupported: false,
      inAppSupported: true,
      mode: 'in-app',
      canAttempt: true,
      isStandalonePwa,
      isMobilePlatform,
      insecureContext,
      policyBlocked,
      shortLabel: 'Supported (In-app & upload)',
      reason:
        'In-app screen capture, recording, and screenshot/video import are ready on this browser. (OS-wide external tab/app picker requires a desktop browser.)',
    };
  }

  if (insecureContext) {
    return {
      supported: false,
      nativeSupported: false,
      inAppSupported: false,
      mode: 'unsupported',
      canAttempt: false,
      isStandalonePwa,
      isMobilePlatform,
      insecureContext: true,
      policyBlocked,
      shortLabel: 'Requires HTTPS',
      reason:
        'Live screen sharing requires a secure HTTPS connection (or localhost). Open Hazel over HTTPS to enable capture.',
    };
  }

  return {
    supported: false,
    nativeSupported: false,
    inAppSupported: false,
    mode: 'unsupported',
    canAttempt: false,
    isStandalonePwa,
    isMobilePlatform,
    insecureContext,
    policyBlocked,
    shortLabel: 'Not exposed by browser',
    reason:
      'Neither Display Capture API (getDisplayMedia) nor canvas.captureStream() is available in this browser.',
  };
}

/**
 * Translates `getDisplayMedia()` runtime errors into clear, actionable feedback.
 */
export function describeScreenCaptureError(err: unknown): ScreenCaptureErrorDetails {
  const name = err instanceof Error ? err.name : '';
  const rawMessage = err instanceof Error ? err.message : String(err ?? '');
  const lower = rawMessage.toLowerCase();

  if (name === 'AbortError') {
    return {
      message: 'Screen sharing prompt was cancelled before selecting a screen or window.',
      isCancellation: true,
      isPolicyBlocked: false,
      isUnsupported: false,
    };
  }

  if (name === 'SecurityError' || lower.includes('permissions policy') || lower.includes('disallowed')) {
    return {
      message:
        'OS screen sharing is blocked by a browser security or iframe Permissions-Policy (display-capture).',
      isCancellation: false,
      isPolicyBlocked: true,
      isUnsupported: false,
    };
  }

  if (name === 'NotAllowedError') {
    if (lower.includes('system') || lower.includes('os') || lower.includes('screen recording')) {
      return {
        message:
          'Screen recording permission is blocked by your operating system or browser settings. Enable Screen Recording for this browser and try again.',
        isCancellation: false,
        isPolicyBlocked: false,
        isUnsupported: false,
      };
    }

    return {
      message:
        'Screen sharing was cancelled, denied in browser permissions, or blocked by an embedded frame policy.',
      isCancellation: false,
      isPolicyBlocked: false,
      isUnsupported: false,
    };
  }

  if (name === 'NotSupportedError') {
    return {
      message:
        'OS screen sharing is not supported in this browser/OS window or with the selected audio option.',
      isCancellation: false,
      isPolicyBlocked: false,
      isUnsupported: true,
    };
  }

  if (name === 'InvalidStateError') {
    return {
      message:
        'Screen sharing must be started from an active, visible window right after clicking the Share button.',
      isCancellation: false,
      isPolicyBlocked: false,
      isUnsupported: false,
    };
  }

  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return {
      message:
        'No shareable screen, window, or browser tab matched the requested capture settings.',
      isCancellation: false,
      isPolicyBlocked: false,
      isUnsupported: false,
    };
  }

  return {
    message: rawMessage || 'Unable to start screen sharing in this browser.',
    isCancellation: false,
    isPolicyBlocked: false,
    isUnsupported: false,
  };
}
