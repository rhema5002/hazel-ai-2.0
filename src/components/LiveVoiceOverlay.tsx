import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  CameraOff,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  PhoneOff,
  RefreshCw,
  RotateCcw,
  Volume2,
  X,
} from 'lucide-react';
import {
  LIVE_VOICES,
  LiveVoiceSessionClient,
  type LiveConnectionState,
  type LiveMemoryEvent,
  type LiveVoiceName,
} from '../services/liveSessionClient';
import type { AppView, AvatarGesture, MemoryItem, TimerWidgetData } from '../types/chat';
import {
  createInAppScreenStream,
  isInAppCaptureSupported,
} from '../utils/inAppScreenCapture';
import {
  describeScreenCaptureError,
  getScreenCaptureCapability,
} from '../utils/screenCaptureSupport';
import { parseNaturalTimerCommand } from '../utils/timerParser';
import { inferAvatarGestureFromText, LiveAvatar2D } from './LiveAvatar2D';
import { SparkEmblem } from './SparkEmblem';
import { TimerWidget } from './TimerWidget';

export interface LiveTranscriptTurn {
  role: 'user' | 'assistant';
  text: string;
}

type VisualSourceMode = 'none' | 'camera' | 'screen';

interface LiveVoiceOverlayProps {
  isOpen: boolean;
  defaultVoice?: LiveVoiceName;
  view?: AppView;
  guestMemories?: MemoryItem[];
  onScheduleTimer?: (timer: TimerWidgetData) => void;
  onMemoryEvent?: (event: LiveMemoryEvent) => void;
  onClose: (transcriptTurns: LiveTranscriptTurn[], liveTimers: TimerWidgetData[]) => void;
}

export const LiveVoiceOverlay: React.FC<LiveVoiceOverlayProps> = ({
  isOpen,
  defaultVoice = 'Zephyr',
  view = 'chat',
  guestMemories,
  onScheduleTimer,
  onMemoryEvent,
  onClose,
}) => {
  const [voice, setVoice] = useState<LiveVoiceName>(defaultVoice);
  const [status, setStatus] = useState<LiveConnectionState>('connecting');
  const [muted, setMuted] = useState(false);
  const [visualMode, setVisualMode] = useState<VisualSourceMode>('none');
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('user');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [levels, setLevels] = useState({ input: 0, output: 0 });
  const [turns, setTurns] = useState<LiveTranscriptTurn[]>([]);
  const [liveTimers, setLiveTimers] = useState<TimerWidgetData[]>([]);

  const clientRef = useRef<LiveVoiceSessionClient | null>(null);
  const turnsRef = useRef<LiveTranscriptTurn[]>([]);
  const liveTimersRef = useRef<TimerWidgetData[]>([]);
  const parsedTurnIndicesRef = useRef<Set<number>>(new Set());
  const toolTimerThisTurnRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const visualStreamRef = useRef<MediaStream | null>(null);
  const frameTimerRef = useRef<number | null>(null);
  const initialCaptureTimerRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);
  const isOpenRef = useRef(isOpen);
  const visualReqSeqRef = useRef(0);
  isOpenRef.current = isOpen;

  const onScheduleTimerRef = useRef(onScheduleTimer);
  onScheduleTimerRef.current = onScheduleTimer;
  const onMemoryEventRef = useRef(onMemoryEvent);
  onMemoryEventRef.current = onMemoryEvent;
  const guestMemoriesRef = useRef(guestMemories);
  guestMemoriesRef.current = guestMemories;

  const addLiveTimer = useCallback((incoming: TimerWidgetData) => {
    const now = Date.now();
    const normIncomingLabel = incoming.label.trim().toLowerCase();
    const isDup = liveTimersRef.current.some((t) => {
      const sameDuration = Math.abs(t.durationSeconds - incoming.durationSeconds) <= 2;
      if (!sameDuration) return false;
      const sameLabel = t.label.trim().toLowerCase() === normIncomingLabel;
      return now - t.createdAt < (sameLabel ? 60_000 : 12_000);
    });
    if (isDup) return;
    const normalized: TimerWidgetData = {
      ...incoming,
      targetTime:
        typeof incoming.targetTime === 'number'
          ? incoming.targetTime
          : incoming.createdAt + incoming.durationSeconds * 1000,
    };
    const next = [...liveTimersRef.current, normalized];
    liveTimersRef.current = next;
    setLiveTimers(next);
    onScheduleTimerRef.current?.(normalized);
  }, []);

  const appendTurnDelta = (role: 'user' | 'assistant', delta: string) => {
    if (!delta) return;
    const prev = turnsRef.current;
    const last = prev[prev.length - 1];
    let next: LiveTranscriptTurn[];
    if (last && last.role === role) {
      next = [...prev.slice(0, -1), { role, text: last.text + delta }];
    } else {
      next = [...prev, { role, text: delta.trimStart() }];
    }
    turnsRef.current = next;
    setTurns(next);
  };

  const stopVisualFeed = useCallback(() => {
    visualReqSeqRef.current += 1;
    if (frameTimerRef.current !== null) {
      window.clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }
    if (initialCaptureTimerRef.current !== null) {
      window.clearTimeout(initialCaptureTimerRef.current);
      initialCaptureTimerRef.current = null;
    }
    if (visualStreamRef.current) {
      for (const track of visualStreamRef.current.getTracks()) {
        track.onended = null;
        track.stop();
      }
      visualStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.onloadeddata = null;
      videoRef.current.srcObject = null;
    }
    setVisualMode('none');
  }, []);

  const captureAndSendFrame = useCallback(() => {
    if (!mountedRef.current || !isOpenRef.current) return;
    const videoEl = videoRef.current;
    if (!videoEl || videoEl.readyState < 2 || !videoEl.videoWidth || !videoEl.videoHeight) {
      return;
    }
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }
    const canvas = canvasRef.current;
    const maxDim = 768;
    const scale = Math.min(1, maxDim / Math.max(videoEl.videoWidth, videoEl.videoHeight));
    canvas.width = Math.max(1, Math.round(videoEl.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(videoEl.videoHeight * scale));

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    const base64 = dataUrl.split(',')[1];
    if (base64) {
      clientRef.current?.sendVideoFrame(base64);
    }
  }, []);

  const attachVisualStream = useCallback(
    (stream: MediaStream, nextMode: 'camera' | 'screen') => {
      if (!mountedRef.current || !isOpenRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      if (frameTimerRef.current !== null) {
        window.clearInterval(frameTimerRef.current);
        frameTimerRef.current = null;
      }
      if (initialCaptureTimerRef.current !== null) {
        window.clearTimeout(initialCaptureTimerRef.current);
        initialCaptureTimerRef.current = null;
      }

      visualStreamRef.current = stream;
      setVisualMode(nextMode);
      setErrorMsg(null);

      const primaryTrack = stream.getVideoTracks()[0];
      if (primaryTrack) {
        primaryTrack.onended = () => {
          stopVisualFeed();
        };
      }

      requestAnimationFrame(() => {
        if (!mountedRef.current || !isOpenRef.current || visualStreamRef.current !== stream) {
          return;
        }
        const videoEl = videoRef.current;
        if (videoEl) {
          videoEl.srcObject = stream;
          videoEl.onloadeddata = () => {
            if (initialCaptureTimerRef.current !== null) {
              window.clearTimeout(initialCaptureTimerRef.current);
            }
            initialCaptureTimerRef.current = window.setTimeout(() => {
              initialCaptureTimerRef.current = null;
              captureAndSendFrame();
            }, 250);
          };
        }
      });

      // Stream frames every 2.5s to keep live vision responsive while reducing API rate
      frameTimerRef.current = window.setInterval(() => {
        captureAndSendFrame();
      }, 2500);
    },
    [captureAndSendFrame, stopVisualFeed]
  );

  const startSession = useCallback(
    (selectedVoice: LiveVoiceName) => {
      clientRef.current?.stop();
      setErrorMsg(null);
      setStatus('connecting');

      const client = new LiveVoiceSessionClient({
        onStateChange: (next) => setStatus(next),
        onInputTranscript: (delta) => appendTurnDelta('user', delta),
        onOutputTranscript: (delta) => appendTurnDelta('assistant', delta),
        onTurnComplete: () => {
          const alreadyHandledByTool = toolTimerThisTurnRef.current;
          toolTimerThisTurnRef.current = false;
          // Also inspect latest user utterance for natural timer commands when no tool fired
          turnsRef.current.forEach((turn, idx) => {
            if (turn.role !== 'user' || parsedTurnIndicesRef.current.has(idx)) return;
            parsedTurnIndicesRef.current.add(idx);
            if (alreadyHandledByTool) return;
            const parsed = parseNaturalTimerCommand(turn.text);
            if (parsed) {
              addLiveTimer({
                kind: 'timer',
                id: `${parsed.isReminder ? 'rem' : 'tmr'}-live-${Date.now().toString(36)}-${idx}`,
                label: parsed.label,
                durationSeconds: parsed.durationSeconds,
                createdAt: Date.now(),
                targetTime: parsed.targetTime,
                isReminder: parsed.isReminder,
                reminderNote: parsed.reminderNote,
              });
            }
          });
        },
        onTimer: (timer) => {
          toolTimerThisTurnRef.current = true;
          addLiveTimer(timer);
        },
        onMemoryEvent: (evt) => {
          onMemoryEventRef.current?.(evt);
        },
        onAudioLevel: (lvl) => setLevels(lvl),
        onError: (msg) => setErrorMsg(msg),
      });

      clientRef.current = client;
      void client.start(selectedVoice, view, guestMemoriesRef.current);
    },
    [addLiveTimer, view]
  );

  useEffect(() => {
    if (!isOpen) return;
    setVoice(defaultVoice);
    turnsRef.current = [];
    liveTimersRef.current = [];
    parsedTurnIndicesRef.current = new Set();
    toolTimerThisTurnRef.current = false;
    setTurns([]);
    setLiveTimers([]);
    setMuted(false);
    setErrorMsg(null);
  }, [isOpen, defaultVoice]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    startSession(voice);

    return () => {
      stopVisualFeed();
      clientRef.current?.stop();
      clientRef.current = null;
    };
  }, [isOpen, voice, startSession, stopVisualFeed]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  useEffect(() => {
    clientRef.current?.setMuted(muted);
  }, [muted]);

  const startCamera = async (facing: 'user' | 'environment') => {
    stopVisualFeed();
    const reqId = ++visualReqSeqRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing,
          width: { ideal: 960 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      if (!mountedRef.current || !isOpenRef.current || reqId !== visualReqSeqRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      setCameraFacing(facing);
      attachVisualStream(stream, 'camera');
    } catch {
      if (!mountedRef.current || !isOpenRef.current || reqId !== visualReqSeqRef.current) return;
      setErrorMsg('Camera access was denied or unavailable on this device.');
      stopVisualFeed();
    }
  };

  const toggleCamera = async () => {
    if (visualMode === 'camera') {
      stopVisualFeed();
      return;
    }
    await startCamera(cameraFacing);
  };

  const flipCamera = async () => {
    const nextFacing = cameraFacing === 'user' ? 'environment' : 'user';
    await startCamera(nextFacing);
  };

  const toggleScreenShare = async () => {
    if (visualMode === 'screen') {
      stopVisualFeed();
      return;
    }

    const cap = getScreenCaptureCapability();
    setErrorMsg(null);
    stopVisualFeed();
    const reqId = ++visualReqSeqRef.current;

    try {
      let stream: MediaStream | null = null;

      if (
        cap.mode === 'native' &&
        typeof navigator !== 'undefined' &&
        typeof navigator.mediaDevices?.getDisplayMedia === 'function'
      ) {
        try {
          try {
            stream = await navigator.mediaDevices.getDisplayMedia({
              video: {
                frameRate: { ideal: 5, max: 15 },
              },
              audio: false,
            });
          } catch (primaryErr) {
            const errName = primaryErr instanceof Error ? primaryErr.name : '';
            const shouldRetryBasic =
              errName === 'NotSupportedError' ||
              errName === 'OverconstrainedError' ||
              errName === 'TypeError';
            if (!shouldRetryBasic) {
              throw primaryErr;
            }
            stream = await navigator.mediaDevices.getDisplayMedia({
              video: true,
              audio: false,
            });
          }
        } catch (nativeErr) {
          const details = describeScreenCaptureError(nativeErr);
          if ((details.isPolicyBlocked || details.isUnsupported) && isInAppCaptureSupported()) {
            stream = null;
          } else {
            throw nativeErr;
          }
        }
      }

      if (!stream) {
        if (!isInAppCaptureSupported()) {
          setErrorMsg(cap.reason || 'Screen sharing is not supported in this browser.');
          return;
        }
        stream = createInAppScreenStream({ fps: 8, maxWidth: 960 });
      }

      if (!mountedRef.current || !isOpenRef.current || reqId !== visualReqSeqRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      attachVisualStream(stream, 'screen');
    } catch (err) {
      if (!mountedRef.current || !isOpenRef.current || reqId !== visualReqSeqRef.current) return;
      const details = describeScreenCaptureError(err);
      if (!details.isCancellation) {
        setErrorMsg(details.message);
      }
      stopVisualFeed();
    }
  };

  const handleHangUp = () => {
    stopVisualFeed();
    clientRef.current?.stop();
    clientRef.current = null;
    const finalTurns = turnsRef.current
      .map((t) => ({ ...t, text: t.text.trim() }))
      .filter((t) => t.text.length > 0);
    onClose(finalTurns, liveTimersRef.current);
  };

  const liveGesture = useMemo<AvatarGesture>(() => {
    if (status === 'connecting') return 'thinking';
    const lastTurn = turns[turns.length - 1];
    if (!lastTurn) return 'idle';
    if (lastTurn.role === 'assistant') {
      return inferAvatarGestureFromText(lastTurn.text);
    }
    return 'idle';
  }, [status, turns]);

  if (!isOpen) return null;

  const statusText =
    status === 'connecting'
      ? 'Connecting to Hazel Live…'
      : status === 'error'
        ? 'Connection interrupted'
        : status === 'closed'
          ? 'Session ended'
          : status === 'speaking'
            ? 'Hazel is speaking'
            : muted
              ? 'Microphone muted'
              : visualMode === 'screen'
                ? 'Listening & watching your screen'
                : visualMode === 'camera'
                  ? 'Listening & seeing via camera'
                  : 'Listening — speak naturally';

  const isWorkspaceLive = view === 'workspace';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={
        isWorkspaceLive
          ? 'Workspace Hazel Live voice and visual conversation'
          : 'Hazel Live voice and visual conversation'
      }
      className={`fixed inset-0 z-50 flex h-[100dvh] flex-col bg-gradient-to-b text-slate-900 dark:text-zinc-100 ${
        isWorkspaceLive
          ? 'from-[#FDF8F8] via-white to-[#FDEEEE] dark:from-[#131314] dark:via-[#181416] dark:to-[#180E10]'
          : 'from-[#F8FAFD] via-white to-[#EEF3FC] dark:from-[#131314] dark:via-[#16181D] dark:to-[#0E1118]'
      }`}
    >
      {/* Top Bar */}
      <div className="flex shrink-0 items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <SparkEmblem size={28} streaming={status === 'speaking' || status === 'connecting'} />
          <span className="font-display truncate whitespace-nowrap text-sm font-semibold tracking-tight sm:text-base">
            {isWorkspaceLive ? 'Workspace Live' : 'Hazel Live'}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <label className="sr-only" htmlFor="live-voice-select">
            Voice persona
          </label>
          <div className="inline-flex max-w-[170px] items-center gap-1.5 rounded-full border border-slate-200/90 bg-white/90 px-2.5 py-1.5 text-xs font-medium text-slate-700 sm:max-w-none sm:px-3 dark:border-zinc-700/80 dark:bg-[#1E1F20] dark:text-zinc-200">
            <Volume2
              className={`h-3.5 w-3.5 shrink-0 ${
                isWorkspaceLive
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-blue-600 dark:text-blue-400'
              }`}
              aria-hidden="true"
            />
            <select
              id="live-voice-select"
              value={voice}
              onChange={(e) => setVoice(e.target.value as LiveVoiceName)}
              aria-label="Select Hazel voice"
              className="min-w-0 truncate bg-transparent pr-1 text-xs font-medium focus:outline-none dark:bg-[#1E1F20]"
            >
              {LIVE_VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} · {v.tone}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleHangUp}
            aria-label="Close Live mode"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-200/70 focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Main 2D Avatar & Live Vision Stage */}
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-between px-4 py-2 sm:px-6">
        {/* Floating Camera / Screen Share Preview */}
        {visualMode !== 'none' && (
          <div className="absolute top-2 right-4 z-20 overflow-hidden rounded-2xl border border-slate-200/90 bg-black shadow-lg sm:right-6 dark:border-zinc-700">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`h-28 w-40 object-cover sm:h-36 sm:w-52 ${
                visualMode === 'camera' && cameraFacing === 'user' ? '-scale-x-100' : ''
              }`}
            />
            <div className="flex items-center justify-between bg-black/75 px-2.5 py-1 text-[11px] font-medium text-white">
              <span>{visualMode === 'screen' ? 'Screen shared' : 'Camera live'}</span>
              <div className="flex items-center gap-1">
                {visualMode === 'camera' && (
                  <button
                    type="button"
                    onClick={flipCamera}
                    aria-label="Switch camera"
                    title="Switch camera"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-white/20"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={stopVisualFeed}
                  aria-label="Stop visual feed"
                  title="Turn off"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-white/20"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 2D Animated Anime Hazel Character */}
        <div className="flex flex-col items-center gap-2 pt-1">
          <LiveAvatar2D
            status={status}
            inputLevel={levels.input}
            outputLevel={levels.output}
            muted={muted}
            gesture={liveGesture}
            appearance={isWorkspaceLive ? 'red' : 'blue'}
            size="lg"
          />
          <p
            aria-live="polite"
            className="font-display text-sm font-medium tracking-tight text-slate-600 dark:text-zinc-300"
          >
            {statusText}
          </p>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div
            role="alert"
            className="my-2 flex max-w-md flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="text-xs leading-relaxed sm:text-sm">{errorMsg}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {(status === 'error' || status === 'closed') && (
                <button
                  type="button"
                  onClick={() => startSession(voice)}
                  className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full bg-rose-600 px-3.5 text-xs font-medium text-white hover:bg-rose-700"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Reconnect</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                aria-label="Dismiss alert"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-rose-700 hover:bg-rose-200/60 dark:text-rose-200 dark:hover:bg-rose-900/60"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Active Voice-Triggered Timers */}
        {liveTimers.length > 0 && (
          <div className="w-full max-w-xl space-y-1.5 py-1">
            {liveTimers.map((t) => (
              <TimerWidget key={t.id} timer={t} compact />
            ))}
          </div>
        )}

        {/* Live Captions Feed */}
        <div className="chat-scroll my-2 w-full max-w-xl flex-1 overflow-y-auto rounded-2xl border border-slate-200/70 bg-white/65 p-3.5 backdrop-blur-xs dark:border-zinc-800 dark:bg-[#1B1C1E]/70">
          {turns.length === 0 ? (
            <p className="py-5 text-center text-xs text-slate-500 dark:text-zinc-400">
              Talk naturally with Hazel. Turn on your camera or share your screen anytime so she can see and help in real time.
            </p>
          ) : (
            <div className="space-y-3">
              {turns.map((turn, idx) => (
                <div
                  key={idx}
                  className={`flex flex-col ${
                    turn.role === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  <span className="mb-0.5 text-[11px] font-medium text-slate-400 dark:text-zinc-500">
                    {turn.role === 'user' ? 'You' : 'Hazel'}
                  </span>
                  <div
                    className={`max-w-[88%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                      turn.role === 'user'
                        ? 'bg-[#E3ECF9] text-slate-900 dark:bg-[#282A2C] dark:text-zinc-100'
                        : 'bg-slate-100 text-slate-800 dark:bg-[#22252A] dark:text-zinc-200'
                    }`}
                  >
                    {turn.text}
                  </div>
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>
          )}
        </div>

        {/* Bottom Thumb-Reach Live Controls */}
        <div className="flex shrink-0 items-center justify-center gap-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:gap-4">
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
            aria-pressed={muted}
            title={muted ? 'Unmute mic' : 'Mute mic'}
            className={`inline-flex h-14 w-14 items-center justify-center rounded-full border transition-all active:scale-95 focus-visible:outline-2 focus-visible:outline-blue-600 ${
              muted
                ? 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                : 'border-slate-200 bg-white text-slate-800 shadow-sm hover:bg-slate-50 dark:border-zinc-700 dark:bg-[#24262A] dark:text-zinc-100 dark:hover:bg-[#2E3035]'
            }`}
          >
            {muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
          </button>

          <button
            type="button"
            onClick={toggleCamera}
            aria-label={visualMode === 'camera' ? 'Turn off camera' : 'Turn on camera'}
            aria-pressed={visualMode === 'camera'}
            title={visualMode === 'camera' ? 'Turn off camera' : 'Camera'}
            className={`inline-flex h-14 w-14 items-center justify-center rounded-full border transition-all active:scale-95 focus-visible:outline-2 focus-visible:outline-blue-600 ${
              visualMode === 'camera'
                ? 'border-blue-400 bg-blue-100 text-blue-800 dark:border-blue-700 dark:bg-blue-950/70 dark:text-blue-300'
                : 'border-slate-200 bg-white text-slate-800 shadow-sm hover:bg-slate-50 dark:border-zinc-700 dark:bg-[#24262A] dark:text-zinc-100 dark:hover:bg-[#2E3035]'
            }`}
          >
            {visualMode === 'camera' ? (
              <Camera className="h-6 w-6" />
            ) : (
              <CameraOff className="h-6 w-6" />
            )}
          </button>

          <button
            type="button"
            onClick={toggleScreenShare}
            aria-label={visualMode === 'screen' ? 'Stop sharing screen' : 'Share screen with Hazel'}
            aria-pressed={visualMode === 'screen'}
            title={visualMode === 'screen' ? 'Stop sharing screen' : 'Share screen'}
            className={`inline-flex h-14 w-14 items-center justify-center rounded-full border transition-all active:scale-95 focus-visible:outline-2 focus-visible:outline-blue-600 ${
              visualMode === 'screen'
                ? 'border-indigo-400 bg-indigo-100 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300'
                : 'border-slate-200 bg-white text-slate-800 shadow-sm hover:bg-slate-50 dark:border-zinc-700 dark:bg-[#24262A] dark:text-zinc-100 dark:hover:bg-[#2E3035]'
            }`}
          >
            {visualMode === 'screen' ? (
              <MonitorOff className="h-6 w-6" />
            ) : (
              <MonitorUp className="h-6 w-6" />
            )}
          </button>

          <button
            type="button"
            onClick={handleHangUp}
            aria-label="End live voice session"
            className="inline-flex h-14 min-w-[56px] items-center justify-center gap-2 rounded-full bg-rose-600 px-6 text-sm font-semibold text-white shadow-md transition-all hover:bg-rose-700 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500"
          >
            <PhoneOff className="h-5 w-5" />
            <span>End</span>
          </button>
        </div>
      </div>
    </div>
  );
};
