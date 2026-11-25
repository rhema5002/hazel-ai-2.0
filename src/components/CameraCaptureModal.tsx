import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Download,
  FlipHorizontal2,
  RefreshCw,
  RotateCcw,
  SwitchCamera,
  X,
} from 'lucide-react';

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAttachCaptureToChat: (file: File) => void;
}

export const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  isOpen,
  onClose,
  onAttachCaptureToChat,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturedUrlRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const isOpenRef = useRef(isOpen);
  const requestSeqRef = useRef(0);
  isOpenRef.current = isOpen;

  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [mirrored, setMirrored] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);

  const stopStream = useCallback(() => {
    requestSeqRef.current += 1;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const clearSnapshot = useCallback(() => {
    if (capturedUrlRef.current) {
      URL.revokeObjectURL(capturedUrlRef.current);
      capturedUrlRef.current = null;
    }
    setCapturedUrl(null);
    setCapturedBlob(null);
  }, []);

  const startCamera = useCallback(async () => {
    if (!isOpenRef.current || !mountedRef.current) return;
    setErrorMsg(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMsg('Camera access is not supported in this browser.');
      return;
    }

    stopStream();
    const reqId = ++requestSeqRef.current;
    setIsLoading(true);
    try {
      const videoConstraints: MediaTrackConstraints = selectedDeviceId
        ? {
            deviceId: { exact: selectedDeviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          }
        : {
            facingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 },
          };

      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });

      if (!mountedRef.current || !isOpenRef.current || reqId !== requestSeqRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      if (navigator.mediaDevices.enumerateDevices) {
        const list = await navigator.mediaDevices.enumerateDevices();
        if (mountedRef.current && isOpenRef.current && reqId === requestSeqRef.current) {
          setDevices(list.filter((d) => d.kind === 'videoinput'));
        }
      }
    } catch (err) {
      if (!mountedRef.current || !isOpenRef.current || reqId !== requestSeqRef.current) {
        return;
      }
      if (err instanceof Error && err.name === 'NotAllowedError') {
        setErrorMsg(
          'Camera permission was denied. Allow camera access in your browser site settings and retry.'
        );
      } else if (err instanceof Error && err.name === 'NotFoundError') {
        setErrorMsg('No camera device was detected on this system.');
      } else {
        setErrorMsg('Could not access the camera. Check if another app is using it.');
      }
    } finally {
      if (mountedRef.current && reqId === requestSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, [facingMode, selectedDeviceId, stopStream]);

  useEffect(() => {
    if (isOpen && !capturedUrl) {
      void startCamera();
    } else if (!isOpen) {
      stopStream();
      clearSnapshot();
    }
  }, [isOpen, capturedUrl, startCamera, stopStream, clearSnapshot]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopStream();
      clearSnapshot();
    };
  }, [stopStream, clearSnapshot]);

  const handleClose = useCallback(() => {
    stopStream();
    clearSnapshot();
    onClose();
  }, [stopStream, clearSnapshot, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  const handleCapturePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (mirrored && facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob || !mountedRef.current || !isOpenRef.current) return;
        if (capturedUrlRef.current) URL.revokeObjectURL(capturedUrlRef.current);
        const nextUrl = URL.createObjectURL(blob);
        capturedUrlRef.current = nextUrl;
        setCapturedBlob(blob);
        setCapturedUrl(nextUrl);
        stopStream();
      },
      'image/jpeg',
      0.92
    );
  };

  const handleAttachPhoto = () => {
    if (!capturedBlob) return;
    const filename = `camera-photo-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
    const file = new File([capturedBlob], filename, { type: 'image/jpeg' });
    onAttachCaptureToChat(file);
    clearSnapshot();
    onClose();
  };

  const handleDownloadPhoto = () => {
    if (!capturedUrl) return;
    const a = document.createElement('a');
    a.href = capturedUrl;
    a.download = `hazel-camera-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Camera access and photo capture"
      onClick={handleClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-[#18191C]"
      >
        <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4 dark:border-zinc-800">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
              Camera Capture
            </h2>
            <p className="text-xs text-slate-500 dark:text-zinc-400">
              Preview your camera and attach a snapshot directly to your prompt
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close camera"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {errorMsg ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-rose-200/80 bg-rose-50/70 px-5 py-10 text-center dark:border-rose-900/60 dark:bg-rose-950/30">
              <Camera className="h-7 w-7 text-rose-500" />
              <p className="max-w-sm text-xs leading-relaxed font-medium text-rose-700 dark:text-rose-300">
                {errorMsg}
              </p>
              <button
                type="button"
                onClick={() => void startCamera()}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full bg-rose-600 px-4 text-xs font-semibold text-white hover:bg-rose-700"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Retry camera access</span>
              </button>
            </div>
          ) : (
            <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 dark:border-zinc-800">
              {capturedUrl ? (
                <img
                  src={capturedUrl}
                  alt="Captured camera snapshot"
                  className="aspect-video w-full object-contain"
                />
              ) : (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`aspect-video w-full object-cover ${
                    mirrored && facingMode === 'user' ? '-scale-x-100' : ''
                  }`}
                />
              )}
              {isLoading && !capturedUrl && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs font-medium text-white">
                  Requesting camera access…
                </div>
              )}
            </div>
          )}

          {!capturedUrl && !errorMsg && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {devices.length > 1 && (
                  <select
                    value={selectedDeviceId}
                    onChange={(e) => setSelectedDeviceId(e.target.value)}
                    aria-label="Select camera device"
                    className="h-9 max-w-[190px] truncate rounded-xl border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  >
                    <option value="">Default camera</option>
                    {devices.map((dev, idx) => (
                      <option key={`${dev.deviceId || 'camera'}-${idx}`} value={dev.deviceId}>
                        {dev.label || `Camera ${idx + 1}`}
                      </option>
                    ))}
                  </select>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setSelectedDeviceId('');
                    setFacingMode((m) => (m === 'user' ? 'environment' : 'user'));
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  <SwitchCamera className="h-3.5 w-3.5" />
                  <span>{facingMode === 'user' ? 'Front' : 'Rear'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setMirrored((m) => !m)}
                  aria-pressed={mirrored}
                  title="Mirror preview"
                  className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-colors ${
                    mirrored
                      ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700/60 dark:bg-blue-950/50 dark:text-blue-300'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'
                  }`}
                >
                  <FlipHorizontal2 className="h-3.5 w-3.5" />
                  <span>Mirror</span>
                </button>
              </div>

              <button
                type="button"
                onClick={handleCapturePhoto}
                disabled={isLoading}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-full bg-blue-600 px-5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                <Camera className="h-4 w-4" />
                <span>Take photo</span>
              </button>
            </div>
          )}

          {capturedUrl && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => clearSnapshot()}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Retake</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadPhoto}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Save</span>
                </button>
                <button
                  type="button"
                  onClick={handleAttachPhoto}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-blue-600 px-5 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  <Check className="h-4 w-4" />
                  <span>Attach to prompt</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
