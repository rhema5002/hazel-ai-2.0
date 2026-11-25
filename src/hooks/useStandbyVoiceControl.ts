import { useCallback, useEffect, useRef, useState } from 'react';
import {
  parseStandbyTranscript,
  type StandbyVoiceCommand,
} from '../utils/voiceCommandParser';

export type StandbyStatus = 'off' | 'standby' | 'engaged' | 'paused' | 'error';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionErrorEventLike {
  error?: string;
}
interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface UseStandbyVoiceControlOptions {
  enabled: boolean;
  onChangeEnabled: (next: boolean) => void;
  requireWakeWord: boolean;
  isBlocked: boolean; // Pause mic while TTS or Live Audio overlay is active
  onCommand: (command: StandbyVoiceCommand) => void;
}

const ENGAGED_TIMEOUT_MS = 15_000;
const BAND_COUNT = 7;
const ZERO_BANDS = Array.from({ length: BAND_COUNT }, () => 0.08);

export function useStandbyVoiceControl({
  enabled,
  onChangeEnabled,
  requireWakeWord,
  isBlocked,
  onCommand,
}: UseStandbyVoiceControlOptions) {
  const isSupported =
    typeof window !== 'undefined' &&
    Boolean(
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
        (window as unknown as Record<string, unknown>).webkitSpeechRecognition
    );

  const [hasGesture, setHasGesture] = useState<boolean>(() => {
    if (typeof navigator === 'undefined') return false;
    const ua = (
      navigator as unknown as { userActivation?: { hasBeenActive?: boolean } }
    ).userActivation;
    return Boolean(ua?.hasBeenActive);
  });
  const [micPreGranted, setMicPreGranted] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioBands, setAudioBands] = useState<number[]>(ZERO_BANDS);
  const [isSpeechDetected, setIsSpeechDetected] = useState(false);
  const [uptimeSeconds, setUptimeSeconds] = useState(0);
  const [commandsProcessed, setCommandsProcessed] = useState(0);
  const [isListeningActive, setIsListeningActive] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const engagedTimerRef = useRef<number | null>(null);
  const enabledRef = useRef(enabled);
  const hasGestureRef = useRef(hasGesture);
  const micPreGrantedRef = useRef(micPreGranted);
  const explicitActivationRef = useRef(false);
  const recognitionStartAtRef = useRef(0);
  const consecutiveQuickFailuresRef = useRef(0);
  const receivedResultInRunRef = useRef(false);
  const engagedRef = useRef(engaged);
  const blockedRef = useRef(isBlocked);
  const errorRef = useRef<string | null>(error);
  const canActivateRef = useRef(false);
  const requireWakeWordRef = useRef(requireWakeWord);
  const onCommandRef = useRef(onCommand);
  const onChangeEnabledRef = useRef(onChangeEnabled);
  const lastFinalRef = useRef<{ text: string; at: number }>({
    text: '',
    at: 0,
  });

  enabledRef.current = enabled;
  hasGestureRef.current = hasGesture;
  micPreGrantedRef.current = micPreGranted;
  engagedRef.current = engaged;
  blockedRef.current = isBlocked;
  errorRef.current = error;
  requireWakeWordRef.current = requireWakeWord;
  onCommandRef.current = onCommand;
  onChangeEnabledRef.current = onChangeEnabled;

  // Detect first user interaction and pre-granted microphone permission for built-in auto-start
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      void navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then((res) => {
          if (res.state === 'granted') {
            setMicPreGranted(true);
            micPreGrantedRef.current = true;
          }
        })
        .catch(() => {});
    }

    if (hasGesture) return;

    const markActive = () => {
      setHasGesture(true);
    };

    window.addEventListener('pointerdown', markActive, { once: true, capture: true });
    window.addEventListener('keydown', markActive, { once: true, capture: true });
    return () => {
      window.removeEventListener('pointerdown', markActive, true);
      window.removeEventListener('keydown', markActive, true);
    };
  }, [hasGesture]);

  const canActivate = enabled && isSupported && (hasGesture || micPreGranted);
  canActivateRef.current = canActivate;

  const clearEngagedTimer = useCallback(() => {
    if (engagedTimerRef.current !== null) {
      window.clearTimeout(engagedTimerRef.current);
      engagedTimerRef.current = null;
    }
  }, []);

  const enterEngaged = useCallback(() => {
    clearEngagedTimer();
    setEngaged(true);
    engagedRef.current = true;
    engagedTimerRef.current = window.setTimeout(() => {
      setEngaged(false);
      engagedRef.current = false;
    }, ENGAGED_TIMEOUT_MS);
  }, [clearEngagedTimer]);

  const exitEngaged = useCallback(() => {
    clearEngagedTimer();
    setEngaged(false);
    engagedRef.current = false;
  }, [clearEngagedTimer]);

  const stopRecognitionInstance = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    const inst = recognitionRef.current;
    recognitionRef.current = null;
    if (inst) {
      inst.onstart = null;
      inst.onresult = null;
      inst.onerror = null;
      inst.onend = null;
      try {
        inst.stop();
      } catch {
        // Ignore already-stopped errors
      }
    }
    setIsListeningActive(false);
    setInterimTranscript('');
  }, []);

  const startRecognition = useCallback(() => {
    if (!canActivateRef.current || blockedRef.current || errorRef.current) return;
    if (recognitionRef.current) return;

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const RecognitionCtor = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!RecognitionCtor) return;

    const recognition = new RecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';
    recognitionStartAtRef.current = Date.now();
    receivedResultInRunRef.current = false;

    recognition.onstart = () => {
      recognitionStartAtRef.current = Date.now();
      setIsListeningActive(true);
    };

    recognition.onresult = (event) => {
      receivedResultInRunRef.current = true;
      consecutiveQuickFailuresRef.current = 0;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const transcript = (res[0]?.transcript ?? '').trim();
        if (!transcript) continue;

        if (!res.isFinal) {
          interim = transcript;
          continue;
        }

        const now = Date.now();
        if (
          transcript === lastFinalRef.current.text &&
          now - lastFinalRef.current.at < 1500
        ) {
          continue;
        }
        lastFinalRef.current = { text: transcript, at: now };
        setInterimTranscript('');

        const parsed = parseStandbyTranscript(transcript, {
          isEngaged: engagedRef.current,
          requireWakeWord: requireWakeWordRef.current,
        });

        if (!parsed.command) continue;

        if (parsed.command.type === 'wake_only') {
          enterEngaged();
          onCommandRef.current(parsed.command);
        } else if (parsed.command.type === 'standby_sleep') {
          exitEngaged();
          setCommandsProcessed((c) => c + 1);
          onCommandRef.current(parsed.command);
        } else if (parsed.command.type === 'standby_off') {
          exitEngaged();
          explicitActivationRef.current = false;
          onChangeEnabledRef.current(false);
          setCommandsProcessed((c) => c + 1);
          onCommandRef.current(parsed.command);
        } else {
          if (engagedRef.current) {
            exitEngaged();
          }
          setCommandsProcessed((c) => c + 1);
          onCommandRef.current(parsed.command);
        }
      }
      setInterimTranscript(interim);
    };

    recognition.onerror = (errEvent) => {
      const code = errEvent?.error;
      if (code === 'no-speech') {
        return;
      }

      const fatalMessage =
        code === 'not-allowed' || code === 'service-not-allowed'
          ? 'Microphone access is blocked. Allow microphone permission in Settings to use "Hey Hazel".'
          : code === 'audio-capture'
            ? 'No microphone detected on this device.'
            : code === 'network'
              ? 'Speech recognition network service is unavailable right now.'
              : code === 'language-not-supported'
                ? 'Speech recognition does not support your browser language.'
                : null;

      if (fatalMessage) {
        if (explicitActivationRef.current || micPreGrantedRef.current) {
          setError(fatalMessage);
        } else {
          onChangeEnabledRef.current(false);
        }
        exitEngaged();
        stopRecognitionInstance();
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setIsListeningActive(false);
      setInterimTranscript('');

      const elapsedMs = Date.now() - recognitionStartAtRef.current;
      if (receivedResultInRunRef.current || elapsedMs >= 2000) {
        consecutiveQuickFailuresRef.current = 0;
      } else {
        consecutiveQuickFailuresRef.current += 1;
      }

      if (consecutiveQuickFailuresRef.current >= 3) {
        if (explicitActivationRef.current) {
          setError('Standby speech recognition stopped unexpectedly. Click to retry.');
        } else {
          onChangeEnabledRef.current(false);
        }
        exitEngaged();
        return;
      }

      if (canActivateRef.current && !blockedRef.current && !errorRef.current) {
        restartTimerRef.current = window.setTimeout(() => {
          restartTimerRef.current = null;
          startRecognition();
        }, 280);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setIsListeningActive(false);
      if (explicitActivationRef.current) {
        setError('Could not start standby voice recognition.');
      } else {
        onChangeEnabledRef.current(false);
      }
    }
  }, [enterEngaged, exitEngaged, stopRecognitionInstance]);

  // Real-time Web Audio microphone volume visualizer while Standby is actively listening
  useEffect(() => {
    if (!canActivate || isBlocked || error || !isListeningActive) {
      setAudioLevel(0);
      setAudioBands(ZERO_BANDS);
      setIsSpeechDetected(false);
      return;
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let rafId: number | null = null;
    let lastEmitAt = 0;
    let speechHoldUntil = 0;
    const smoothed = [...ZERO_BANDS];

    const startMeter = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        if (!AudioCtx) return;

        audioCtx = new AudioCtx();
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume().catch(() => {});
        }
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.65;
        source.connect(analyser);

        const freqData = new Uint8Array(analyser.frequencyBinCount);
        const timeData = new Uint8Array(analyser.fftSize);

        const tick = (now: number) => {
          if (cancelled) return;
          rafId = window.requestAnimationFrame(tick);

          if (now - lastEmitAt < 45) return;
          lastEmitAt = now;

          analyser.getByteFrequencyData(freqData);
          analyser.getByteTimeDomainData(timeData);

          let sumSq = 0;
          for (let i = 0; i < timeData.length; i++) {
            const norm = (timeData[i] - 128) / 128;
            sumSq += norm * norm;
          }
          const rms = Math.sqrt(sumSq / timeData.length);
          const normalizedLevel = Math.min(1, rms * 4.2);

          const nextBands: number[] = [];
          for (let b = 0; b < BAND_COUNT; b++) {
            const startBin = 1 + b * 3;
            let peak = 0;
            for (let k = startBin; k < Math.min(freqData.length, startBin + 3); k++) {
              if (freqData[k] > peak) peak = freqData[k];
            }
            const raw = Math.max(0.08, Math.min(1, (peak / 215) * 1.15));
            smoothed[b] = smoothed[b] * 0.45 + raw * 0.55;
            nextBands.push(Number(smoothed[b].toFixed(3)));
          }

          if (normalizedLevel > 0.085) {
            speechHoldUntil = now + 360;
          }

          setAudioLevel(normalizedLevel);
          setAudioBands(nextBands);
          setIsSpeechDetected(now < speechHoldUntil);
        };

        rafId = window.requestAnimationFrame(tick);
      } catch {
        // Keep recognition functional if metering fails
      }
    };

    void startMeter();

    return () => {
      cancelled = true;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      if (audioCtx) {
        void audioCtx.close().catch(() => {});
      }
      setAudioLevel(0);
      setAudioBands(ZERO_BANDS);
      setIsSpeechDetected(false);
    };
  }, [canActivate, error, isBlocked, isListeningActive]);

  useEffect(() => {
    if (!canActivate || error) {
      stopRecognitionInstance();
      if (!enabled) exitEngaged();
      return;
    }

    if (isBlocked) {
      stopRecognitionInstance();
      return;
    }

    startRecognition();
  }, [canActivate, enabled, error, isBlocked, startRecognition, stopRecognitionInstance, exitEngaged]);

  // Track cumulative hands-free uptime while Standby voice mode is active
  useEffect(() => {
    if (!enabled || !isSupported || error) return;
    const interval = window.setInterval(() => {
      setUptimeSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [enabled, error, isSupported]);

  useEffect(() => {
    return () => {
      clearEngagedTimer();
      stopRecognitionInstance();
    };
  }, [clearEngagedTimer, stopRecognitionInstance]);

  const toggleStandby = useCallback(() => {
    setError(null);
    setHasGesture(true);
    consecutiveQuickFailuresRef.current = 0;
    const nextEnabled = !enabled;
    explicitActivationRef.current = nextEnabled;
    if (!isSupported) {
      setError(
        'Standby voice control requires Web Speech API (Chrome, Edge, or Safari).'
      );
      return;
    }
    onChangeEnabled(nextEnabled);
  }, [enabled, isSupported, onChangeEnabled]);

  const enableStandbyWakeCall = useCallback(() => {
    setError(null);
    setHasGesture(true);
    consecutiveQuickFailuresRef.current = 0;
    explicitActivationRef.current = true;
    if (!isSupported) {
      setError(
        'Standby voice control requires Web Speech API (Chrome, Edge, or Safari).'
      );
      return false;
    }
    onChangeEnabled(true);
    enterEngaged();
    return true;
  }, [enterEngaged, isSupported, onChangeEnabled]);

  const disableStandby = useCallback(() => {
    setError(null);
    explicitActivationRef.current = false;
    consecutiveQuickFailuresRef.current = 0;
    onChangeEnabled(false);
    exitEngaged();
    stopRecognitionInstance();
  }, [exitEngaged, onChangeEnabled, stopRecognitionInstance]);

  const clearStandbyError = useCallback(() => {
    setError(null);
    setHasGesture(true);
    consecutiveQuickFailuresRef.current = 0;
    explicitActivationRef.current = true;
  }, []);

  const status: StandbyStatus = !enabled
    ? 'off'
    : error
      ? 'error'
      : !isSupported
        ? 'off'
        : isBlocked
          ? 'paused'
          : engaged
            ? 'engaged'
            : 'standby';

  return {
    isSupported,
    enabled,
    status,
    interimTranscript,
    error,
    audioLevel,
    audioBands,
    isSpeechDetected: isSpeechDetected || interimTranscript.trim().length > 0,
    uptimeSeconds,
    commandsProcessed,
    toggleStandby,
    enableStandbyWakeCall,
    disableStandby,
    clearStandbyError,
    enterEngaged,
    exitEngaged,
  };
}
