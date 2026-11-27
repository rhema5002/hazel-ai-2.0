import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Film,
  Image as ImageIcon,
  Maximize2,
  Pause,
  Play,
  X,
} from 'lucide-react';
import type {
  ChatSession,
  ChatSpace,
  ImageWidgetData,
  VideoWidgetData,
} from '../types/chat';
import { drawVideoFrame, sanitizeSvgMarkup } from './CreativeMediaWidgets';

type GalleryItem =
  | {
      id: string;
      kind: 'image';
      createdAt: number;
      sessionTitle: string;
      data: ImageWidgetData;
    }
  | {
      id: string;
      kind: 'video';
      createdAt: number;
      sessionTitle: string;
      data: VideoWidgetData;
    };

interface MediaGalleryModalProps {
  isOpen: boolean;
  space?: ChatSpace;
  activeSession: ChatSession;
  allSessions: ChatSession[];
  onClose: () => void;
  onPromptSample: (prompt: string) => void;
}

const GalleryImageCard: React.FC<{
  item: Extract<GalleryItem, { kind: 'image' }>;
  onExpand: () => void;
}> = ({ item, onExpand }) => {
  const cleanSvg = useMemo(
    () => sanitizeSvgMarkup(item.data.svgMarkup),
    [item.data.svgMarkup]
  );
  const [pngUrl, setPngUrl] = useState<string | null>(null);

  useEffect(() => {
    setPngUrl(null);
    if (!cleanSvg) return;
    let cancelled = false;
    const blob = new Blob([cleanSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new window.Image();
    img.onload = () => {
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 768;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          setPngUrl(canvas.toDataURL('image/png'));
        }
      } catch {
        // Fallback silently to SVG URI
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [cleanSvg]);

  if (!cleanSvg) return null;

  const fallbackUri = `data:image/svg+xml;utf8,${encodeURIComponent(cleanSvg)}`;
  const slug =
    item.data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'hazel-art';

  const triggerDownload = (href: string, ext: string) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = `${slug}.${ext}`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleSvgDownload = () => {
    const blob = new Blob([cleanSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, 'svg');
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-[#F8FAFD] dark:border-zinc-700/80 dark:bg-[#1B1C1E]">
      <div className="group relative aspect-[4/3] w-full overflow-hidden bg-slate-900/5 dark:bg-black/30">
        <img
          src={pngUrl || fallbackUri}
          alt={item.data.title}
          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
        />
        <button
          type="button"
          onClick={onExpand}
          aria-label={`Inspect ${item.data.title}`}
          className="absolute top-2.5 right-2.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-xs transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-1 flex-col justify-between gap-3 p-3.5">
        <div>
          <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-zinc-100">
            {item.data.title}
          </h3>
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-zinc-400">
            Image · {item.data.style}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {pngUrl && (
            <button
              type="button"
              onClick={() => triggerDownload(pngUrl, 'png')}
              className="inline-flex min-h-[34px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              <Download className="h-3.5 w-3.5" />
              <span>PNG</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleSvgDownload}
            className="inline-flex min-h-[34px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            <Download className="h-3.5 w-3.5" />
            <span>SVG</span>
          </button>
        </div>
      </div>
    </article>
  );
};

const GalleryVideoCard: React.FC<{
  item: Extract<GalleryItem, { kind: 'video' }>;
  onExpand: () => void;
}> = ({ item, onExpand }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const elapsedRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [exporting, setExporting] = useState(false);

  const duration = Math.max(4, item.data.durationSeconds || 8);

  useEffect(() => {
    let rafId = 0;
    let lastNow = performance.now();
    const loop = (now: number) => {
      const dt = (now - lastNow) / 1000;
      lastNow = now;
      if (isPlaying) {
        elapsedRef.current = (elapsedRef.current + dt) % duration;
      }
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        drawVideoFrame(ctx, canvas.width, canvas.height, elapsedRef.current, item.data);
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [item.data, duration, isPlaying]);

  const handleExportWebM = async () => {
    const canvas = canvasRef.current;
    if (
      !canvas ||
      typeof canvas.captureStream !== 'function' ||
      typeof MediaRecorder === 'undefined'
    ) {
      return;
    }
    setExporting(true);
    let stream: MediaStream | null = null;
    try {
      stream = canvas.captureStream(30);
      const mimeCandidates = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4',
      ];
      const supportedMime =
        typeof MediaRecorder.isTypeSupported === 'function'
          ? mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m))
          : undefined;
      const recorder = supportedMime
        ? new MediaRecorder(stream, { mimeType: supportedMime })
        : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };
      const resolvedType = recorder.mimeType || supportedMime || 'video/webm';
      const ext = resolvedType.includes('mp4') ? 'mp4' : 'webm';
      const done = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: resolvedType }));
      });
      elapsedRef.current = 0;
      setIsPlaying(true);
      recorder.start();
      await new Promise((r) => setTimeout(r, Math.min(duration, 8) * 1000));
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
      const blob = await done;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${
        item.data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'hazel-clip'
      }.${ext}`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // Ignore export errors in unsupported browsers
    } finally {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      setExporting(false);
    }
  };

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-[#F8FAFD] dark:border-zinc-700/80 dark:bg-[#1B1C1E]">
      <div className="group relative aspect-[4/3] w-full overflow-hidden bg-black">
        <canvas
          ref={canvasRef}
          width={640}
          height={480}
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-x-2.5 top-2.5 flex items-center justify-between opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={() => setIsPlaying((p) => !p)}
            aria-label={isPlaying ? 'Pause video preview' : 'Play video preview'}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-xs"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-0.5" />}
          </button>
          <button
            type="button"
            onClick={onExpand}
            aria-label={`Inspect ${item.data.title}`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-xs"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col justify-between gap-3 p-3.5">
        <div>
          <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-zinc-100">
            {item.data.title}
          </h3>
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-zinc-400">
            Video · {duration}s clip
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportWebM}
          disabled={exporting}
          className="inline-flex min-h-[34px] w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          <Download className="h-3.5 w-3.5" />
          <span>{exporting ? 'Recording WebM…' : 'Download WebM'}</span>
        </button>
      </div>
    </article>
  );
};

const LightboxVideoPlayer: React.FC<{ data: VideoWidgetData }> = ({ data }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const elapsedRef = useRef(0);
  const duration = Math.max(4, data.durationSeconds || 8);

  useEffect(() => {
    let rafId = 0;
    let lastNow = performance.now();
    const loop = (now: number) => {
      const dt = (now - lastNow) / 1000;
      lastNow = now;
      elapsedRef.current = (elapsedRef.current + dt) % duration;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        drawVideoFrame(ctx, canvas.width, canvas.height, elapsedRef.current, data);
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [data, duration]);

  return (
    <canvas
      ref={canvasRef}
      width={960}
      height={540}
      className="aspect-video w-full rounded-xl bg-black"
    />
  );
};

export const MediaGalleryModal: React.FC<MediaGalleryModalProps> = ({
  isOpen,
  space = 'chat',
  activeSession,
  allSessions,
  onClose,
  onPromptSample,
}) => {
  const [scope, setScope] = useState<'session' | 'all'>('session');
  const [filter, setFilter] = useState<'all' | 'image' | 'video'>('all');
  const [expanded, setExpanded] = useState<GalleryItem | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setExpanded(null);
    }
  }, [isOpen]);

  const items = useMemo(() => {
    const sourceSessions = scope === 'session' ? [activeSession] : allSessions;
    const collected: GalleryItem[] = [];
    for (const sess of sourceSessions) {
      for (const msg of sess.messages) {
        if (!msg.widgets) continue;
        for (const w of msg.widgets) {
          if (w.kind === 'image') {
            collected.push({
              id: w.id,
              kind: 'image',
              createdAt: msg.createdAt,
              sessionTitle: sess.title,
              data: w,
            });
          } else if (w.kind === 'video') {
            collected.push({
              id: w.id,
              kind: 'video',
              createdAt: msg.createdAt,
              sessionTitle: sess.title,
              data: w,
            });
          }
        }
      }
    }
    return collected
      .filter((item) => (filter === 'all' ? true : item.kind === filter))
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [scope, activeSession, allSessions, filter]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Session media gallery"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 backdrop-blur-xs sm:p-6"
    >
      <div className="flex max-h-[88dvh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-[#18191C]">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 px-5 py-4 dark:border-zinc-800">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
              {space === 'workspace' ? 'Workspace Media Gallery' : 'Media Gallery'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-zinc-400">
              {items.length} {items.length === 1 ? 'item' : 'items'} ·{' '}
              {scope === 'session'
                ? space === 'workspace'
                  ? 'Current workspace'
                  : 'Current session'
                : space === 'workspace'
                  ? 'All workspaces'
                  : 'All chats'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-zinc-800">
              <button
                type="button"
                onClick={() => setScope('session')}
                className={`min-h-[32px] rounded-md px-2.5 text-xs font-medium transition-colors ${
                  scope === 'session'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-zinc-700 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                {space === 'workspace' ? 'Current workspace' : 'Current chat'}
              </button>
              <button
                type="button"
                onClick={() => setScope('all')}
                className={`min-h-[32px] rounded-md px-2.5 text-xs font-medium transition-colors ${
                  scope === 'all'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-zinc-700 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                {space === 'workspace' ? 'All workspaces' : 'All chats'}
              </button>
            </div>

            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-zinc-800">
              {(['all', 'image', 'video'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setFilter(tab)}
                  className={`min-h-[32px] rounded-md px-2.5 text-xs font-medium capitalize transition-colors ${
                    filter === tab
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-zinc-700 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  {tab === 'all' ? 'All' : tab === 'image' ? 'Images' : 'Videos'}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close gallery"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Grid Body */}
        <div className="chat-scroll flex-1 overflow-y-auto p-5">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-zinc-800 dark:text-zinc-400">
                <ImageIcon className="h-6 w-6" />
              </div>
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                No generated images or videos yet
              </h3>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500 dark:text-zinc-400">
                Ask Hazel to generate an image or an animated video clip in this session and every creation will appear here for viewing and download.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onPromptSample('Generate an image of a glowing lantern floating over a calm mountain lake at twilight');
                  }}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  <span>Create sample image</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onPromptSample('Generate a video of ocean waves shimmering under northern lights');
                  }}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  <Film className="h-3.5 w-3.5" />
                  <span>Create sample video</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) =>
                item.kind === 'image' ? (
                  <GalleryImageCard
                    key={item.id}
                    item={item}
                    onExpand={() => setExpanded(item)}
                  />
                ) : (
                  <GalleryVideoCard
                    key={item.id}
                    item={item}
                    onExpand={() => setExpanded(item)}
                  />
                )
              )}
            </div>
          )}
        </div>
      </div>

      {/* Lightbox Detail Overlay */}
      {expanded && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={expanded.data.title}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs"
          onClick={() => setExpanded(null)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl border border-zinc-700 bg-[#141518] p-4 text-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold">{expanded.data.title}</h3>
                <p className="truncate text-xs text-zinc-400">{expanded.data.prompt}</p>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(null)}
                aria-label="Close expanded preview"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-300 hover:bg-zinc-800 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {expanded.kind === 'image' ? (
              (() => {
                const safeSvg = sanitizeSvgMarkup(expanded.data.svgMarkup);
                if (!safeSvg) {
                  return (
                    <div className="flex h-64 items-center justify-center rounded-xl bg-black/30 text-xs text-zinc-400">
                      Preview unavailable for this artwork.
                    </div>
                  );
                }
                return (
                  <img
                    src={`data:image/svg+xml;utf8,${encodeURIComponent(safeSvg)}`}
                    alt={expanded.data.title}
                    className="max-h-[72dvh] w-full rounded-xl bg-black/30 object-contain"
                  />
                );
              })()
            ) : (
              <LightboxVideoPlayer data={expanded.data} />
            )}
          </div>
        </div>
      )}
    </div>
  );
};
