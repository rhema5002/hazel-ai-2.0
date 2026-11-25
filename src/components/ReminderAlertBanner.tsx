import React from 'react';
import { Bell, BellRing, Clock, MessageSquare, RotateCcw, X } from 'lucide-react';
import type { BrowserNotificationStatus } from '../services/reminderNotifications';
import type { ActiveReminderAlert } from '../types/chat';
import { formatReminderClockTime } from '../utils/timerParser';

interface ReminderAlertBannerProps {
  alerts: ActiveReminderAlert[];
  activeSessionId?: string;
  notificationPermission: BrowserNotificationStatus;
  browserNotificationsEnabled: boolean;
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
  onSnooze: (alert: ActiveReminderAlert, minutes: number) => void;
  onJumpToSession?: (sessionId: string) => void;
  onEnableBrowserNotifications: () => void;
}

export const ReminderAlertBanner: React.FC<ReminderAlertBannerProps> = ({
  alerts,
  activeSessionId,
  notificationPermission,
  browserNotificationsEnabled,
  onDismiss,
  onDismissAll,
  onSnooze,
  onJumpToSession,
  onEnableBrowserNotifications,
}) => {
  if (alerts.length === 0) return null;

  const showNotifPrompt =
    browserNotificationsEnabled && notificationPermission === 'default';

  return (
    <div
      role="region"
      aria-label="Active reminder alerts"
      className="pointer-events-none fixed inset-x-0 top-3 z-[75] flex flex-col items-center gap-2 px-3 sm:px-6"
    >
      {alerts.slice(0, 3).map((alert) => {
        const scheduledClock = formatReminderClockTime(alert.targetTime);
        const canJump =
          Boolean(onJumpToSession) &&
          Boolean(alert.sessionId) &&
          alert.sessionId !== activeSessionId;

        return (
          <div
            key={alert.id}
            role="alertdialog"
            aria-labelledby={`reminder-alert-title-${alert.id}`}
            className="pointer-events-auto flex w-full max-w-xl flex-col gap-3 rounded-2xl border border-amber-300/90 bg-white/95 p-3.5 shadow-xl backdrop-blur-md sm:p-4 dark:border-amber-600/70 dark:bg-[#1B1D22]/95"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300">
                  <BellRing className="h-5 w-5 animate-bounce" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold tracking-wide text-amber-700 uppercase dark:text-amber-300">
                    <span>{alert.isReminder ? 'Reminder Alert' : 'Timer Expired'}</span>
                    {scheduledClock && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 font-mono font-medium normal-case tabular-nums text-slate-500 dark:text-zinc-400">
                          <Clock className="h-3 w-3" aria-hidden="true" />
                          {scheduledClock}
                        </span>
                      </>
                    )}
                  </div>
                  <h3
                    id={`reminder-alert-title-${alert.id}`}
                    className="mt-0.5 truncate font-display text-base font-semibold text-slate-900 dark:text-white"
                  >
                    {alert.label}
                  </h3>
                  {alert.note && alert.note !== alert.label && (
                    <p className="mt-0.5 text-xs text-slate-600 dark:text-zinc-300">
                      {alert.note}
                    </p>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => onDismiss(alert.id)}
                aria-label={`Dismiss ${alert.label}`}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onSnooze(alert, 5)}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-medium whitespace-nowrap text-slate-700 transition-colors hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Snooze 5m</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSnooze(alert, 1)}
                  className="inline-flex min-h-[36px] items-center rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-medium whitespace-nowrap text-slate-700 transition-colors hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  +1m
                </button>
                {canJump && alert.sessionId && (
                  <button
                    type="button"
                    onClick={() => {
                      onJumpToSession?.(alert.sessionId!);
                      onDismiss(alert.id);
                    }}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 text-xs font-medium whitespace-nowrap text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-900/70 dark:bg-blue-950/50 dark:text-blue-300"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>Open chat</span>
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => onDismiss(alert.id)}
                className="inline-flex min-h-[36px] items-center rounded-full bg-amber-600 px-4 text-xs font-semibold whitespace-nowrap text-white transition-colors hover:bg-amber-700"
              >
                Dismiss
              </button>
            </div>

            {showNotifPrompt && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 pt-2 text-[11.5px] text-slate-600 dark:border-zinc-800 dark:text-zinc-400">
                <span>Want desktop browser notifications even when minimized?</span>
                <button
                  type="button"
                  onClick={onEnableBrowserNotifications}
                  className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline dark:text-blue-400"
                >
                  <Bell className="h-3 w-3" />
                  <span>Enable notifications</span>
                </button>
              </div>
            )}
          </div>
        );
      })}

      {alerts.length > 1 && (
        <button
          type="button"
          onClick={onDismissAll}
          className="pointer-events-auto rounded-full border border-slate-200 bg-white/95 px-3.5 py-1.5 text-xs font-medium text-slate-700 shadow-md hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-200"
        >
          Dismiss all {alerts.length} alerts
        </button>
      )}
    </div>
  );
};
