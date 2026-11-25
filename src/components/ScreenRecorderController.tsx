import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Download,
  Mic,
  MicOff,
  Monitor,
  Pause,
  Play,
  RotateCcw,
  Square,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { formatBytes } from '../services/chatStreamClient';
import {
  createInAppScreenStream,
  isInAppCaptureSupported,
} from '../utils/inAppScreenCapture';
import {
  describeScreenCaptureError,
  getScreenCaptureCapability,
  type ScreenCaptureCapability,
} from '../utils/screenCaptureSupport';
import { formatCountdownClock } from '../utils/timerParser';

export type ScreenCapturePhase =
  | 'idle'
  | 'sharing'
  | 'recording'
  | 'paused'
  | 'review';

interface ScreenRecorderControllerProps {
  isModalOpen: boolean;
  onOpenModal: () => void;
  onCloseModal: () => void;
  onPhaseChange?: (phase: ScreenCapturePhase) => void;
  onAttachSnapshotToChat: (file: File) => void;
}

export const ScreenRecorderController: React.FC<ScreenRecorderControllerProps> = ({
  isModalOpen,
  onOpenModal,
  onCloseModal,
  onPhaseChange,
  onAttachSnapshotToChat,
}) => {
  const [phase, setPhase] = useState<ScreenCapturePhase>('idle');
  const [includeMic, setIncludeMic] = useState(true);
  const [includeSystemAudio, setIncludeSystemAudio] = useState(true);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [screenCapability, setScreenCapability] = useState<ScreenCaptureCapability>(() =>
    getScreenCaptureCapability()
  );
  const [showFloatingPreview, setShowFloatingPreview] = useState(false);

  useEffect(() => {
    if (!isModalOpen) return;
    setScreenCapability(getScreenCaptureCapability());
    setErrorMsg(null);
  }, [isModalOpen]);

  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedSize, setRecordedSize] = useState(0);
  const [recordedMimeType, setRecordedMimeType] = useState('video/webm');
  const [captureSource, setCaptureSource] = useState<'native' | 'in-app'>('native');
  const [snapshotNotice, setSnapshotNotice] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const displayStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const mixedAudioCtxRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const timerIdRef = useRef<number | null>(null);
  const snapshotNoticeTimerRef = useRef<number | null>(null);
  const recordedUrlRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    onPhaseChange?.(phase);
  }, [phase, onPhaseChange]);

  const stopTimer = useCallback(() => {
    if (timerIdRef.current !== null) {
      window.clearInterval(timerIdRef.current);
      timerIdRef.current = null;
    }
  }, []);

  const releaseStreams = useCallback(() => {
    stopTimer();
    if (displayStreamRef.current) {
      for (const t of displayStreamRef.current.getTracks()) {
        t.onended = null;
        t.stop();
      }
      displayStreamRef.current = null;
    }
    if (micStreamRef.current) {
      for (const t of micStreamRef.current.getTracks()) {
        t.stop();
      }
      micStreamRef.current = null;
    }
    if (mixedAudioCtxRef.current) {
      void mixedAudioCtxRef.current.close().catch(() => {});
      mixedAudioCtxRef.current = null;
    }
    if (previewVideoRef.current) {
      previewVideoRef.current.srcObject = null;
    }
  }, [stopTimer]);

  const clearRecordingUrl = useCallback(() => {
    if (recordedUrlRef.current) {
      URL.revokeObjectURL(recordedUrlRef.current);
      recordedUrlRef.current = null;
    }
    setRecordedUrl(null);
    setRecordedSize(0);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (snapshotNoticeTimerRef.current !== null) {
        window.clearTimeout(snapshotNoticeTimerRef.current);
      }
      releaseStreams();
      clearRecordingUrl();
    };
  }, [releaseStreams, clearRecordingUrl]);

  useEffect(() => {
    if (!isModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseModal();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isModalOpen, onCloseModal]);

  useEffect(() => {
    if (
      (phase === 'sharing' || phase === 'recording' || phase === 'paused') &&
      showFloatingPreview &&
      previewVideoRef.current &&
      displayStreamRef.current
    ) {
      previewVideoRef.current.srcObject = displayStreamRef.current;
    }
  }, [phase, showFloatingPreview]);

  const finishRecording = useCallback(() => {
    stopTimer();
    const mimeType =
      mediaRecorderRef.current?.mimeType || 'video/webm';
    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];
    mediaRecorderRef.current = null;
    releaseStreams();

    if (blob.size > 0) {
      clearRecordingUrl();
      const url = URL.createObjectURL(blob);
      recordedUrlRef.current = url;
      setRecordedUrl(url);
      setRecordedSize(blob.size);
      setRecordedMimeType(mimeType);
      setPhase('review');
      onOpenModal();
    } else {
      setPhase('idle');
    }
  }, [clearRecordingUrl, onOpenModal, releaseStreams, stopTimer]);

  const beginRecordingOnStream = useCallback(
    (displayStream: MediaStream, micStream: MediaStream | null) => {
      if (typeof MediaRecorder === 'undefined') {
        setErrorMsg('Screen recording (MediaRecorder) is not supported in this browser.');
        return;
      }

      const tracks: MediaStreamTrack[] = [...displayStream.getVideoTracks()];
      const displayAudio = displayStream.getAudioTracks();
      const micAudio = micStream?.getAudioTracks() ?? [];

      if (displayAudio.length > 0 && micAudio.length > 0) {
        try {
          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext;
          const ctx = new AudioCtx();
          const dest = ctx.createMediaStreamDestination();
          ctx.createMediaStreamSource(new MediaStream(displayAudio)).connect(dest);
          ctx.createMediaStreamSource(new MediaStream(micAudio)).connect(dest);
          mixedAudioCtxRef.current = ctx;
          tracks.push(...dest.stream.getAudioTracks());
        } catch {
          tracks.push(micAudio[0]);
        }
      } else if (micAudio.length > 0) {
        tracks.push(micAudio[0]);
      } else if (displayAudio.length > 0) {
        tracks.push(displayAudio[0]);
      }

      const combined = new MediaStream(tracks);
      const preferredMime = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4',
      ].find((m) => MediaRecorder.isTypeSupported(m));

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(
          combined,
          preferredMime ? { mimeType: preferredMime } : undefined
        );
      } catch {
        setErrorMsg('Screen recording format is not supported in this browser.');
        releaseStreams();
        setPhase('idle');
        return;
      }

      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };
      recorder.onstop = () => {
        finishRecording();
      };

      mediaRecorderRef.current = recorder;
      recorder.start(500);
      setElapsedSec(0);
      setPhase('recording');
      stopTimer();
      timerIdRef.current = window.setInterval(() => {
        setElapsedSec((s) => s + 1);
      }, 1000);
      onCloseModal();
    },
    [finishRecording, onCloseModal, releaseStreams, stopTimer]
  );

  const startCapture = async (autoRecord: boolean, preferInApp = false) => {
    setErrorMsg(null);
    const cap = getScreenCaptureCapability();
    setScreenCapability(cap);

    releaseStreams();
    clearRecordingUrl();

    let displayStream: MediaStream | null = null;
    let usedInApp = false;

    const canTryNative =
      !preferInApp &&
      cap.mode === 'native' &&
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getDisplayMedia === 'function';

    if (canTryNative) {
      try {
        try {
          displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              frameRate: { ideal: 30, max: 60 },
            },
            audio: includeSystemAudio,
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
          displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false,
          });
        }
      } catch (err) {
        const details = describeScreenCaptureError(err);
        if ((details.isPolicyBlocked || details.isUnsupported) && isInAppCaptureSupported()) {
          // Seamless fallback to in-app screen capture when blocked by iframe/browser policy
          displayStream = null;
        } else {
          if (mountedRef.current) {
            setErrorMsg(details.message);
          }
          return;
        }
      }
    }

    if (!displayStream) {
      if (!isInAppCaptureSupported()) {
        if (mountedRef.current) {
          setErrorMsg(
            cap.reason || 'Screen sharing and recording are not supported in this browser.'
          );
        }
        return;
      }

      // Close modal first so the setup dialog does not appear in the initial frame
      onCloseModal();
      await new Promise((resolve) => window.setTimeout(resolve, 70));
      if (!mountedRef.current) return;

      try {
        displayStream = createInAppScreenStream({ fps: 12, maxWidth: 1080 });
        usedInApp = true;
      } catch (err) {
        if (mountedRef.current) {
          onOpenModal();
          setErrorMsg(
            err instanceof Error ? err.message : 'Unable to start in-app screen capture.'
          );
        }
        return;
      }
    }

    setCaptureSource(usedInApp ? 'in-app' : 'native');

    if (!mountedRef.current) {
      displayStream.getTracks().forEach((t) => t.stop());
      return;
    }

    let micStream: MediaStream | null = null;
    if (autoRecord && includeMic) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
          },
          video: false,
        });
      } catch {
        // Proceed with display video/audio if mic permission is unavailable
      }
    }

    if (!mountedRef.current) {
      displayStream.getTracks().forEach((t) => t.stop());
      micStream?.getTracks().forEach((t) => t.stop());
      return;
    }

    displayStreamRef.current = displayStream;
    micStreamRef.current = micStream;

    const primaryVideoTrack = displayStream.getVideoTracks()[0];
    if (primaryVideoTrack) {
      primaryVideoTrack.onended = () => {
        if (
          mediaRecorderRef.current &&
          mediaRecorderRef.current.state !== 'inactive'
        ) {
          mediaRecorderRef.current.stop();
        } else {
          releaseStreams();
          setPhase('idle');
        }
      };
    }

    if (autoRecord) {
      beginRecordingOnStream(displayStream, micStream);
    } else {
      setShowFloatingPreview(true);
      setPhase('sharing');
      onCloseModal();
    }
  };

  const handleStartRecordingFromSharing = async () => {
    const displayStream = displayStreamRef.current;
    if (!displayStream) return;

    let micStream = micStreamRef.current;
    if (includeMic && !micStream && navigator.mediaDevices?.getUserMedia) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
          },
          video: false,
        });
        if (!mountedRef.current) {
          micStream.getTracks().forEach((t) => t.stop());
          return;
        }
        micStreamRef.current = micStream;
      } catch {
        // Proceed with display video/audio if mic permission is unavailable
      }
    }

    if (!mountedRef.current) return;
    beginRecordingOnStream(displayStream, micStream);
  };

  const handlePauseResume = () => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    if (rec.state === 'recording') {
      rec.pause();
      stopTimer();
      setPhase('paused');
    } else if (rec.state === 'paused') {
      rec.resume();
      stopTimer();
      timerIdRef.current = window.setInterval(() => {
        setElapsedSec((s) => s + 1);
      }, 1000);
      setPhase('recording');
    }
  };

  const handleStopCapture = () => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      rec.stop();
    } else {
      releaseStreams();
      setPhase('idle');
    }
  };

  const handleTakeSnapshotToChat = async () => {
    const stream = displayStreamRef.current;
    if (!stream) return;

    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;

    try {
      await video.play().catch(() => {});
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
        await new Promise<void>((resolve) => {
          const onReady = () => resolve();
          video.addEventListener('loadeddata', onReady, { once: true });
          window.setTimeout(resolve, 450);
        });
      }

      if (!video.videoWidth || !video.videoHeight) return;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob((blob) => {
        if (!blob || !mountedRef.current) return;
        const filename = `screen-capture-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        const file = new File([blob], filename, { type: 'image/png' });
        onAttachSnapshotToChat(file);
        setSnapshotNotice('Screenshot attached to prompt');
        if (snapshotNoticeTimerRef.current !== null) {
          window.clearTimeout(snapshotNoticeTimerRef.current);
        }
        snapshotNoticeTimerRef.current = window.setTimeout(() => {
          setSnapshotNotice(null);
          snapshotNoticeTimerRef.current = null;
        }, 2200);
      }, 'image/png');
    } finally {
      video.pause();
      video.srcObject = null;
    }
  };

  const handleDownloadRecording = () => {
    if (!recordedUrl) return;
    const ext = recordedMimeType.toLowerCase().includes('mp4') ? 'mp4' : 'webm';
    const a = document.createElement('a');
    a.href = recordedUrl;
    a.download = `hazel-session-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleImportMediaFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrorMsg(null);

    if (file.type.startsWith('image/')) {
      onAttachSnapshotToChat(file);
      onCloseModal();
      return;
    }

    if (file.type.startsWith('video/')) {
      clearRecordingUrl();
      const url = URL.createObjectURL(file);
      recordedUrlRef.current = url;
      setRecordedUrl(url);
      setRecordedSize(file.size);
      setRecordedMimeType(file.type || 'video/mp4');
      setPhase('review');
      return;
    }

    setErrorMsg('Please select an image screenshot or video recording.');
  };

  const isLiveCapturing =
    phase === 'sharing' || phase === 'recording' || phase === 'paused';

  return (
    <>
      <input
        ref={importInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleImportMediaFile}
      />

      {/* Floating Non-Blocking Capture Bar during Screen Share / Recording */}
      {isLiveCapturing && (
        <div
          role="region"
          aria-label="Screen capture controls"
          data-hazel-capture-ignore="true"
          className="fixed right-4 bottom-24 z-40 flex flex-col items-end gap-2 sm:right-6"
        >
          {showFloatingPreview && (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-black shadow-2xl dark:border-zinc-700">
              <video
                ref={previewVideoRef}
                autoPlay
                playsInline
                muted
                className="h-32 w-56 object-contain"
              />
            </div>
          )}

          {snapshotNotice && (
            <div className="rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white shadow-md dark:bg-zinc-100 dark:text-zinc-900">
              {snapshotNotice}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 shadow-xl backdrop-blur-xs dark:border-zinc-700 dark:bg-[#222428]/95">
            {phase === 'recording' || phase === 'paused' ? (
              <div className="flex items-center gap-2 pr-1.5 text-xs font-semibold text-slate-800 dark:text-zinc-100">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    phase === 'recording'
                      ? 'animate-pulse bg-rose-600'
                      : 'bg-amber-500'
                  }`}
                />
                <span className="font-mono tabular-nums">
                  {formatCountdownClock(elapsedSec)}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 pr-1.5 text-xs font-medium text-blue-700 dark:text-blue-300">
                <Monitor className="h-3.5 w-3.5" />
                <span>{captureSource === 'in-app' ? 'Sharing app screen' : 'Sharing screen'}</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowFloatingPreview((s) => !s)}
              aria-label={showFloatingPreview ? 'Hide preview' : 'Show preview'}
              title={showFloatingPreview ? 'Hide preview' : 'Preview'}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 dark:text-zinc-300 dark:hover:bg-zinc-700 ${
                showFloatingPreview ? 'bg-slate-200/80 dark:bg-zinc-700' : ''
              }`}
            >
              <Monitor className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={handleTakeSnapshotToChat}
              aria-label="Capture screenshot to chat"
              title="Attach screenshot to chat"
              className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              <Camera className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Snap</span>
            </button>

            {phase === 'sharing' ? (
              <button
                type="button"
                onClick={() => void handleStartRecordingFromSharing()}
                aria-label="Start recording shared screen"
                className="inline-flex h-8 items-center gap-1 rounded-full bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-700"
              >
                <Video className="h-3.5 w-3.5" />
                <span>Record</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePauseResume}
                aria-label={phase === 'paused' ? 'Resume recording' : 'Pause recording'}
                title={phase === 'paused' ? 'Resume' : 'Pause'}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                {phase === 'paused' ? (
                  <Play className="h-4 w-4 translate-x-0.5" />
                ) : (
                  <Pause className="h-4 w-4" />
                )}
              </button>
            )}

            <button
              type="button"
              onClick={handleStopCapture}
              aria-label="Stop screen capture"
              className="inline-flex h-8 items-center gap-1 rounded-full bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              <Square className="h-3 w-3 fill-current" />
              <span>Stop</span>
            </button>
          </div>
        </div>
      )}

      {/* Setup / Review Modal */}
      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Screen sharing and recording"
          onClick={onCloseModal}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-[#18191C]"
          >
            <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4 dark:border-zinc-800">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                  {phase === 'review' ? 'Recording Ready' : 'Screen Share & Recording'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-zinc-400">
                  {phase === 'review'
                    ? `${formatCountdownClock(elapsedSec)} · ${formatBytes(recordedSize)}`
                    : 'Capture your screen, window, or browser tab for tutorials or debugging.'}
                </p>
              </div>
              <button
                type="button"
                onClick={onCloseModal}
                aria-label="Close dialog"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              {errorMsg && (
                <div
                  role="alert"
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                >
                  <span>{errorMsg}</span>
                  {isInAppCaptureSupported() && (
                    <button
                      type="button"
                      onClick={() => void startCapture(false, true)}
                      className="rounded-full bg-rose-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-rose-700"
                    >
                      Use in-app capture
                    </button>
                  )}
                </div>
              )}

              {!errorMsg && screenCapability.reason && phase !== 'review' && (
                <p
                  className={`rounded-xl border px-3.5 py-2.5 text-xs font-medium ${
                    screenCapability.supported
                      ? 'border-indigo-200 bg-indigo-50/80 text-indigo-800 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200'
                      : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200'
                  }`}
                >
                  {screenCapability.reason}
                </p>
              )}

              {phase === 'review' && recordedUrl ? (
                <>
                  <video
                    src={recordedUrl}
                    controls
                    className="aspect-video w-full rounded-2xl border border-slate-200 bg-black dark:border-zinc-700"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        clearRecordingUrl();
                        setPhase('idle');
                      }}
                      className="inline-flex min-h-[42px] items-center gap-2 rounded-full border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>New recording</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleDownloadRecording}
                      className="inline-flex min-h-[42px] items-center gap-2 rounded-full bg-blue-600 px-5 text-xs font-semibold text-white hover:bg-blue-700"
                    >
                      <Download className="h-4 w-4" />
                      <span>
                        Download {recordedMimeType.toLowerCase().includes('mp4') ? 'MP4' : 'WebM'}
                      </span>
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2.5">
                    <button
                      type="button"
                      onClick={() => setIncludeMic((m) => !m)}
                      className="flex min-h-[48px] w-full items-center justify-between rounded-2xl border border-slate-200 px-4 py-2.5 text-left transition-colors hover:bg-slate-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
                    >
                      <div className="flex items-center gap-3">
                        {includeMic ? (
                          <Mic className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        ) : (
                          <MicOff className="h-4 w-4 text-slate-400" />
                        )}
                        <div>
                          <div className="text-sm font-medium text-slate-900 dark:text-zinc-100">
                            Include microphone narration
                          </div>
                          <div className="text-xs text-slate-500 dark:text-zinc-400">
                            Voiceover commentary alongside your screen capture
                          </div>
                        </div>
                      </div>
                      <span
                        className={`inline-flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${
                          includeMic ? 'bg-blue-600' : 'bg-slate-300 dark:bg-zinc-700'
                        }`}
                      >
                        <span
                          className={`h-5 w-5 rounded-full bg-white transition-transform ${
                            includeMic ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setIncludeSystemAudio((a) => !a)}
                      className="flex min-h-[48px] w-full items-center justify-between rounded-2xl border border-slate-200 px-4 py-2.5 text-left transition-colors hover:bg-slate-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
                    >
                      <div className="flex items-center gap-3">
                        <Monitor className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                        <div>
                          <div className="text-sm font-medium text-slate-900 dark:text-zinc-100">
                            Request tab or system audio
                          </div>
                          <div className="text-xs text-slate-500 dark:text-zinc-400">
                            When supported by your selected browser tab or screen
                          </div>
                        </div>
                      </div>
                      <span
                        className={`inline-flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${
                          includeSystemAudio ? 'bg-blue-600' : 'bg-slate-300 dark:bg-zinc-700'
                        }`}
                      >
                        <span
                          className={`h-5 w-5 rounded-full bg-white transition-transform ${
                            includeSystemAudio ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </span>
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2">
                    <button
                      type="button"
                      onClick={() => importInputRef.current?.click()}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-slate-200 px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      <Upload className="h-4 w-4" />
                      <span>Import screenshot / video</span>
                    </button>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={!screenCapability.canAttempt}
                        onClick={() => void startCapture(false)}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      >
                        <Monitor className="h-4 w-4" />
                        <span>Share screen &amp; snap</span>
                      </button>
                      <button
                        type="button"
                        disabled={!screenCapability.canAttempt}
                        onClick={() => void startCapture(true)}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-rose-600 px-5 text-xs font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <Video className="h-4 w-4" />
                        <span>Start recording</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
