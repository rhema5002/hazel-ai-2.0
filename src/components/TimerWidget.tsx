import React, { useEffect, useRef, useState } from 'react';
import { Bell, BellRing, Clock, Pause, Play, Plus, RotateCcw, Timer, VolumeX } from 'lucide-react';
import type { TimerWidgetData } from '../types/chat';
import { formatCountdownClock, formatReminderClockTime } from '../utils/timerParser';

interface TimerWidgetProps {
  timer: TimerWidgetData;
  compact?: boolean;
}

export interface HazelTimerControlDetail {
  action: 'pause' | 'resume' | 'add_minute' | 'reset' | 'stop_alarm' | 'expired';
  timer: TimerWidgetData;
  nextTargetTime?: number;
  nextDurationSeconds?: number;
}

export function emitTimerControl(detail: HazelTimerControlDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<HazelTimerControlDetail>('hazel:timer-control', { detail }));
}

function playGentleChime(): () => void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    let stopped = false;

    const ringBurst = (offsetSec: number) => {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const start = ctx.currentTime + offsetSec + idx * 0.11;
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.exponentialRampToValueAtTime(0.14, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.65);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.7);
      });
    };

    ringBurst(0);
    const interval = window.setInterval(() => {
      if (!stopped) ringBurst(0);
    }, 2200);

    return () => {
      stopped = true;
      window.clearInterval(interval);
      void ctx.close().catch(() => {});
    };
  } catch {
    return () => {};
  }
}

export const TimerWidget: React.FC<TimerWidgetProps> = ({
  timer,
  compact = false,
}) => {
  const initialTarget =
    typeof timer.targetTime === 'number'
      ? timer.targetTime
      : timer.createdAt + timer.durationSeconds * 1000;
  const initialRemaining = Math.max(
    0,
    Math.ceil((initialTarget - Date.now()) / 1000)
  );

  const [totalDuration, setTotalDuration] = useState(timer.durationSeconds);
  const [remaining, setRemaining] = useState(initialRemaining);
  const [running, setRunning] = useState(initialRemaining > 0);
  const [ringing, setRinging] = useState(false);

  const targetEndRef = useRef<number>(Date.now() + initialRemaining * 1000);
  const stopChimeRef = useRef<(() => void) | null>(null);
  const timerRef = useRef(timer);
  timerRef.current = timer;

  useEffect(() => {
    if (!running) return;
    targetEndRef.current = Date.now() + remaining * 1000;

    const interval = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((targetEndRef.current - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) {
        setRunning(false);
        setRinging(true);
        const hasGlobalHandler = Boolean(
          (window as unknown as { __HAZEL_GLOBAL_REMINDER_MANAGER__?: boolean })
            .__HAZEL_GLOBAL_REMINDER_MANAGER__
        );
        if (!hasGlobalHandler) {
          stopChimeRef.current?.();
          stopChimeRef.current = playGentleChime();
        }
        emitTimerControl({ action: 'expired', timer: timerRef.current });
        window.clearInterval(interval);
      }
    }, 250);

    return () => window.clearInterval(interval);
  }, [running]);

  useEffect(() => {
    const onGlobalDismiss = (evt: Event) => {
      const custom = evt as CustomEvent<{ id?: string }>;
      if (!custom.detail?.id || custom.detail.id === timerRef.current.id) {
        stopChimeRef.current?.();
        stopChimeRef.current = null;
        setRinging(false);
      }
    };
    const onGlobalSnooze = (evt: Event) => {
      const custom = evt as CustomEvent<{ id?: string; nextTargetTime?: number; nextDurationSeconds?: number }>;
      if (custom.detail?.id === timerRef.current.id && custom.detail.nextTargetTime) {
        stopChimeRef.current?.();
        stopChimeRef.current = null;
        setRinging(false);
        const left = Math.max(
          1,
          Math.ceil((custom.detail.nextTargetTime - Date.now()) / 1000)
        );
        targetEndRef.current = custom.detail.nextTargetTime;
        setTotalDuration(custom.detail.nextDurationSeconds ?? left);
        setRemaining(left);
        setRunning(true);
      }
    };

    window.addEventListener('hazel:alert-dismissed', onGlobalDismiss);
    window.addEventListener('hazel:alert-snoozed', onGlobalSnooze);
    return () => {
      window.removeEventListener('hazel:alert-dismissed', onGlobalDismiss);
      window.removeEventListener('hazel:alert-snoozed', onGlobalSnooze);
      stopChimeRef.current?.();
    };
  }, []);

  const stopAlarm = () => {
    stopChimeRef.current?.();
    stopChimeRef.current = null;
    setRinging(false);
    emitTimerControl({ action: 'stop_alarm', timer });
  };

  const handleToggleRun = () => {
    stopAlarm();
    if (remaining <= 0) {
      const nextTarget = Date.now() + totalDuration * 1000;
      setRemaining(totalDuration);
      targetEndRef.current = nextTarget;
      setRunning(true);
      emitTimerControl({
        action: 'resume',
        timer,
        nextTargetTime: nextTarget,
        nextDurationSeconds: totalDuration,
      });
      return;
    }
    const nextRunning = !running;
    const nextTarget = Date.now() + remaining * 1000;
    if (nextRunning) {
      targetEndRef.current = nextTarget;
    }
    setRunning(nextRunning);
    emitTimerControl({
      action: nextRunning ? 'resume' : 'pause',
      timer,
      nextTargetTime: nextRunning ? nextTarget : undefined,
      nextDurationSeconds: totalDuration,
    });
  };

  const handleAddMinute = () => {
    stopAlarm();
    const next = remaining + 60;
    const nextTarget = Date.now() + next * 1000;
    const nextTotal = totalDuration + 60;
    targetEndRef.current = nextTarget;
    setTotalDuration(nextTotal);
    setRemaining(next);
    setRunning(true);
    emitTimerControl({
      action: 'add_minute',
      timer,
      nextTargetTime: nextTarget,
      nextDurationSeconds: nextTotal,
    });
  };

  const handleReset = () => {
    stopAlarm();
    setRunning(false);
    setTotalDuration(timer.durationSeconds);
    setRemaining(timer.durationSeconds);
    targetEndRef.current = Date.now() + timer.durationSeconds * 1000;
    emitTimerControl({ action: 'reset', timer });
  };

  const progress =
    totalDuration > 0 ? Math.max(0, Math.min(1, remaining / totalDuration)) : 0;
  const radius = compact ? 22 : 28;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);
  const targetClock =
    timer.isReminder && running && remaining > 0
      ? formatReminderClockTime(targetEndRef.current)
      : '';

  return (
    <div
      className={`my-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3.5 shadow-xs transition-colors ${
        ringing
          ? 'border-amber-400 bg-amber-50/90 dark:border-amber-500/70 dark:bg-amber-950/40'
          : 'border-slate-200/90 bg-[#F8FAFD] dark:border-zinc-700/80 dark:bg-[#1B1C1E]'
      }`}
    >
      <div className="flex items-center gap-3.5">
        <div className="relative flex items-center justify-center">
          <svg
            width={compact ? 56 : 68}
            height={compact ? 56 : 68}
            viewBox={compact ? '0 0 56 56' : '0 0 68 68'}
            className="-rotate-90"
            aria-hidden="true"
          >
            <circle
              cx={compact ? 28 : 34}
              cy={compact ? 28 : 34}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="4.5"
              className="text-slate-200 dark:text-zinc-700"
            />
            <circle
              cx={compact ? 28 : 34}
              cy={compact ? 28 : 34}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="4.5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              className={`transition-[stroke-dashoffset] duration-300 ${
                ringing
                  ? 'text-amber-500'
                  : running
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-slate-400 dark:text-zinc-500'
              }`}
            />
          </svg>
          <span className="absolute flex items-center justify-center text-slate-600 dark:text-zinc-300">
            {ringing ? (
              <BellRing className="h-4 w-4 animate-bounce text-amber-600 dark:text-amber-400" />
            ) : timer.isReminder ? (
              <Bell className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            ) : (
              <Timer className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            )}
          </span>
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-zinc-400">
            <span>{timer.label}</span>
            {timer.isReminder && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-blue-600 dark:text-blue-400">Reminder</span>
              </>
            )}
          </div>
          <div
            aria-live="off"
            className="font-mono text-2xl font-semibold tracking-tight tabular-nums text-slate-900 dark:text-white"
          >
            {formatCountdownClock(remaining)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 dark:text-zinc-500">
            <span>
              {ringing
                ? 'Time is up!'
                : running
                  ? timer.isReminder
                    ? 'Reminder scheduled'
                    : 'Counting down'
                  : remaining === 0
                    ? 'Completed'
                    : 'Paused'}
            </span>
            {targetClock && (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-0.5 font-mono tabular-nums">
                  <Clock className="h-2.5 w-2.5" aria-hidden="true" />
                  {targetClock}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        {ringing && (
          <button
            type="button"
            onClick={stopAlarm}
            aria-label="Silence timer alarm"
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-amber-600 px-3.5 text-xs font-semibold text-white hover:bg-amber-700"
          >
            <VolumeX className="h-3.5 w-3.5" />
            <span>Stop</span>
          </button>
        )}

        <button
          type="button"
          onClick={handleToggleRun}
          aria-label={running ? 'Pause timer' : 'Start timer'}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-blue-600 dark:bg-blue-500 dark:hover:bg-blue-400"
        >
          {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-0.5" />}
        </button>

        <button
          type="button"
          onClick={handleAddMinute}
          aria-label="Add one minute"
          title="+1 min"
          className="inline-flex h-10 items-center gap-0.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-zinc-700 dark:bg-[#282A2C] dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          <Plus className="h-3 w-3" />
          <span>1m</span>
        </button>

        <button
          type="button"
          onClick={handleReset}
          aria-label="Reset timer"
          title="Reset"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-zinc-700 dark:bg-[#282A2C] dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
