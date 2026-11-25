import type { ActiveReminderAlert } from '../types/chat';
import { formatReminderClockTime } from '../utils/timerParser';

export type BrowserNotificationStatus =
  | 'granted'
  | 'denied'
  | 'default'
  | 'unsupported';

export function isBrowserNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getBrowserNotificationPermission(): BrowserNotificationStatus {
  if (!isBrowserNotificationSupported()) return 'unsupported';
  return window.Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationStatus> {
  if (!isBrowserNotificationSupported()) return 'unsupported';
  if (window.Notification.permission === 'granted') return 'granted';
  if (window.Notification.permission === 'denied') return 'denied';
  try {
    const result = await window.Notification.requestPermission();
    return result;
  } catch {
    return getBrowserNotificationPermission();
  }
}

export function dispatchBrowserReminderNotification(
  alert: ActiveReminderAlert,
  onClick?: () => void
): Notification | null {
  if (!isBrowserNotificationSupported()) return null;
  if (window.Notification.permission !== 'granted') return null;

  const title = alert.isReminder
    ? `Hazel Reminder: ${alert.label}`
    : `Timer Complete: ${alert.label}`;
  const timeText = formatReminderClockTime(alert.targetTime);
  const body = alert.note && alert.note !== alert.label
    ? `${alert.note}${timeText ? ` (${timeText})` : ''}`
    : timeText
      ? `Scheduled for ${timeText}. Click to open Hazel.`
      : 'Time is up. Click to open Hazel.';

  try {
    const notif = new window.Notification(title, {
      body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: `hazel-reminder-${alert.id}`,
      requireInteraction: true,
    });
    notif.onclick = () => {
      try {
        window.focus();
      } catch {
        // Ignore window focus restrictions
      }
      onClick?.();
      notif.close();
    };
    return notif;
  } catch {
    return null;
  }
}

export function playReminderChimeLoop(): () => void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return () => {};
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    let stopped = false;

    const ringBurst = () => {
      if (stopped) return;
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const start = ctx.currentTime + idx * 0.11;
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.exponentialRampToValueAtTime(0.14, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.65);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.7);
      });
    };

    ringBurst();
    const interval = window.setInterval(ringBurst, 2600);

    return () => {
      stopped = true;
      window.clearInterval(interval);
      void ctx.close().catch(() => {});
    };
  } catch {
    return () => {};
  }
}
