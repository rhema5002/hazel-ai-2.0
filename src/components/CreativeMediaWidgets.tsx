import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Download,
  Film,
  Image as ImageIcon,
  Music2,
  Pause,
  Play,
  RotateCcw,
} from 'lucide-react';
import type {
  ImageWidgetData,
  SongWidgetData,
  VideoWidgetData,
} from '../types/chat';

/* -------------------------------------------------------------------------- */
/*  Safe SVG Sanitizer (pure DOMParser allowlist, zero XSS)                   */
/* -------------------------------------------------------------------------- */

export function sanitizeSvgMarkup(rawSvg: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return '';
    const svg = doc.querySelector('svg');
    if (!svg) return '';

    const blockedTags = new Set([
      'script',
      'foreignobject',
      'iframe',
      'object',
      'embed',
      'link',
      'image',
    ]);
    const hasUnsafeCssUrl = (css: string) =>
      /url\s*\(\s*['"]?\s*(?:https?:|\/\/|javascript:|data:text\/html)/i.test(css) ||
      /expression\s*\(/i.test(css);
    const walk = (el: Element) => {
      const children = Array.from(el.children);
      for (const child of children) {
        const tag = child.tagName.toLowerCase();
        if (blockedTags.has(tag)) {
          child.remove();
          continue;
        }
        if (tag === 'style' && hasUnsafeCssUrl(child.textContent ?? '')) {
          child.remove();
          continue;
        }
        if (
          (tag === 'animate' || tag === 'set' || tag === 'animatemotion') &&
          /^(?:href|xlink:href|src)$/i.test(child.getAttribute('attributeName') ?? '')
        ) {
          child.remove();
          continue;
        }
        for (const attr of Array.from(child.attributes)) {
          const name = attr.name.toLowerCase();
          const val = attr.value.trim().toLowerCase();
          if (
            name.startsWith('on') ||
            val.startsWith('javascript:') ||
            val.startsWith('data:text/html') ||
            (name === 'style' && hasUnsafeCssUrl(attr.value)) ||
            ((name === 'href' || name === 'xlink:href' || name === 'src') &&
              (val.startsWith('http:') ||
                val.startsWith('https:') ||
                val.startsWith('//') ||
                (val.startsWith('data:') && !val.startsWith('data:image/'))))
          ) {
            child.removeAttribute(attr.name);
          }
        }
        walk(child);
      }
    };

    for (const attr of Array.from(svg.attributes)) {
      if (attr.name.toLowerCase().startsWith('on')) {
        svg.removeAttribute(attr.name);
      }
    }
    walk(svg);

    if (!svg.getAttribute('viewBox')) {
      svg.setAttribute('viewBox', '0 0 800 600');
    }
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    return new XMLSerializer().serializeToString(svg);
  } catch {
    return '';
  }
}

/* -------------------------------------------------------------------------- */
/*  Image Widget (SVG Vector Art + PNG / SVG Export)                          */
/* -------------------------------------------------------------------------- */

export const ImageWidget: React.FC<{ data: ImageWidgetData }> = ({ data }) => {
  const cleanSvg = useMemo(() => sanitizeSvgMarkup(data.svgMarkup), [data.svgMarkup]);
  const [renderedPngUrl, setRenderedPngUrl] = useState<string | null>(null);

  useEffect(() => {
    setRenderedPngUrl(null);
    if (!cleanSvg) return;
    let revoked = false;
    const blob = new Blob([cleanSvg], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(blob);
    const img = new window.Image();
    img.onload = () => {
      if (revoked) {
        URL.revokeObjectURL(svgUrl);
        return;
      }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 768;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          setRenderedPngUrl(canvas.toDataURL('image/png'));
        }
      } catch {
        // Fallback silently to inline SVG data URI if PNG conversion fails
      } finally {
        URL.revokeObjectURL(svgUrl);
      }
    };
    img.onerror = () => URL.revokeObjectURL(svgUrl);
    img.src = svgUrl;

    return () => {
      revoked = true;
      URL.revokeObjectURL(svgUrl);
    };
  }, [cleanSvg]);

  const downloadFile = (url: string, ext: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'hazel-art'}.${ext}`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleDownloadSvg = () => {
    const blob = new Blob([cleanSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    downloadFile(url, 'svg');
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!cleanSvg) return null;

  const svgDataUri = `data:image/svg+xml;utf8,${encodeURIComponent(cleanSvg)}`;

  return (
    <div className="my-2 overflow-hidden rounded-2xl border border-slate-200/90 bg-[#F8FAFD] shadow-xs dark:border-zinc-700/80 dark:bg-[#1B1C1E]">
      <div className="flex items-center justify-between border-b border-slate-200/70 px-3.5 py-2 dark:border-zinc-800">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-zinc-200">
          <ImageIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <span className="truncate">{data.title}</span>
          <span className="text-[11px] font-normal text-slate-400 dark:text-zinc-500">
            · {data.style}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {renderedPngUrl && (
            <button
              type="button"
              onClick={() => downloadFile(renderedPngUrl, 'png')}
              className="inline-flex min-h-[32px] items-center gap-1 rounded-full bg-white px-2.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-700"
            >
              <Download className="h-3 w-3" />
              <span>PNG</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleDownloadSvg}
            className="inline-flex min-h-[32px] items-center gap-1 rounded-full bg-white px-2.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-700"
          >
            <Download className="h-3 w-3" />
            <span>SVG</span>
          </button>
        </div>
      </div>

      <div className="bg-slate-900/5 p-2 dark:bg-black/30">
        <img
          src={renderedPngUrl || svgDataUri}
          alt={data.title}
          className="aspect-[4/3] w-full rounded-xl object-contain"
        />
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/*  Song Widget (Multi-Track Web Audio Synth + WAV Export + Lyrics)           */
/* -------------------------------------------------------------------------- */

const CHORD_FREQS: Record<string, number[]> = {
  C: [261.63, 329.63, 392.0],
  Cm: [261.63, 311.13, 392.0],
  Cmaj7: [261.63, 329.63, 392.0, 493.88],
  D: [293.66, 369.99, 440.0],
  Dm: [293.66, 349.23, 440.0],
  Dm7: [293.66, 349.23, 440.0, 523.25],
  E: [329.63, 415.3, 493.88],
  Em: [329.63, 392.0, 493.88],
  Em7: [329.63, 392.0, 493.88, 587.33],
  F: [174.61, 220.0, 261.63],
  Fm: [174.61, 207.65, 261.63],
  Fmaj7: [174.61, 220.0, 261.63, 329.63],
  G: [196.0, 246.94, 293.66],
  Gm: [196.0, 233.08, 293.66],
  G7: [196.0, 246.94, 293.66, 349.23],
  A: [220.0, 277.18, 329.63],
  Am: [220.0, 261.63, 329.63],
  Am7: [220.0, 261.63, 329.63, 392.0],
  Bb: [233.08, 293.66, 349.23],
  Bm: [246.94, 293.66, 369.99],
};

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function scheduleSongOnAudioContext(
  ctx: BaseAudioContext,
  song: SongWidgetData,
  startOffset: number
): void {
  const bpm = Math.max(60, Math.min(165, song.bpm || 96));
  const beatSec = 60 / bpm;
  const barSec = beatSec * 4;
  const bars = 8; // ~18-24 second rich composition loop
  const chords = song.chords.length > 0 ? song.chords : ['Am7', 'Fmaj7', 'C', 'G'];
  const melody = song.melodyNotes.length > 0 ? song.melodyNotes : [69, 72, 76, 74, 72, 71, 69, 67];
  const bass = song.bassNotes.length > 0 ? song.bassNotes : [45, 41, 36, 43];

  const master = ctx.createGain();
  master.gain.value = 0.55;
  master.connect(ctx.destination);

  for (let bar = 0; bar < bars; bar++) {
    const barStart = startOffset + bar * barSec;
    const chordName = chords[bar % chords.length];
    const chordTones = CHORD_FREQS[chordName] ?? CHORD_FREQS.Am7;

    // Warm Pad Chords
    for (const freq of chordTones) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = song.drumStyle === 'synthwave' ? 'sawtooth' : 'triangle';
      osc.frequency.value = freq;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = song.drumStyle === 'ambient' ? 900 : 1450;

      g.gain.setValueAtTime(0.001, barStart);
      g.gain.linearRampToValueAtTime(0.09, barStart + 0.15);
      g.gain.exponentialRampToValueAtTime(0.001, barStart + barSec * 0.96);

      osc.connect(filter);
      filter.connect(g);
      g.connect(master);
      osc.start(barStart);
      osc.stop(barStart + barSec);
    }

    // Bass Line
    const bassMidi = bass[bar % bass.length] ?? 45;
    for (let step = 0; step < 2; step++) {
      const t = barStart + step * beatSec * 2;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = midiToFreq(bassMidi);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.24, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + beatSec * 1.85);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + beatSec * 1.9);
    }

    // Melody Line (eighth notes)
    for (let step = 0; step < 8; step++) {
      if ((bar + step) % 5 === 4 && song.drumStyle === 'lofi') continue;
      const t = barStart + step * (beatSec / 2);
      const note = melody[(bar * 4 + step) % melody.length] ?? 72;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = song.drumStyle === 'rock' ? 'square' : 'sine';
      osc.frequency.value = midiToFreq(note);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.11, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + beatSec * 0.45);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + beatSec * 0.48);
    }

    // Drum Groove (unless ambient)
    if (song.drumStyle !== 'ambient') {
      for (let beat = 0; beat < 4; beat++) {
        const t = barStart + beat * beatSec;
        // Kick on 0 & 2
        if (beat === 0 || beat === 2) {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.frequency.setValueAtTime(130, t);
          osc.frequency.exponentialRampToValueAtTime(42, t + 0.14);
          g.gain.setValueAtTime(0.32, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
          osc.connect(g);
          g.connect(master);
          osc.start(t);
          osc.stop(t + 0.19);
        }
        // Snare clap on 1 & 3
        if (beat === 1 || beat === 3) {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(210, t);
          osc.frequency.exponentialRampToValueAtTime(90, t + 0.09);
          g.gain.setValueAtTime(0.16, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
          osc.connect(g);
          g.connect(master);
          osc.start(t);
          osc.stop(t + 0.12);
        }
      }
    }
  }
}

function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const length = buffer.length * buffer.numberOfChannels * 2 + 44;
  const arrayBuffer = new ArrayBuffer(length);
  const view = new DataView(arrayBuffer);
  const channels: Float32Array[] = [];
  for (let i = 0; i < buffer.numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  let offset = 0;
  const writeString = (str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    offset += str.length;
  };

  writeString('RIFF');
  view.setUint32(offset, length - 8, true);
  offset += 4;
  writeString('WAVE');
  writeString('fmt ');
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, buffer.numberOfChannels, true);
  offset += 2;
  view.setUint32(offset, buffer.sampleRate, true);
  offset += 4;
  view.setUint32(offset, buffer.sampleRate * buffer.numberOfChannels * 2, true);
  offset += 4;
  view.setUint16(offset, buffer.numberOfChannels * 2, true);
  offset += 2;
  view.setUint16(offset, 16, true);
  offset += 2;
  writeString('data');
  view.setUint32(offset, length - offset - 4, true);
  offset += 4;

  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

export const SongWidget: React.FC<{ data: SongWidgetData }> = ({ data }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showLyrics, setShowLyrics] = useState(true);
  const [exporting, setExporting] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const bpm = Math.max(60, Math.min(165, data.bpm || 96));
  const durationSec = (60 / bpm) * 4 * 8;

  const stopPlayback = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (ctxRef.current) {
      void ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    setIsPlaying(false);
    setProgress(0);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPlayback();
    };
  }, []);

  const togglePlay = async () => {
    if (isPlaying) {
      stopPlayback();
      return;
    }
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') await ctx.resume();
      if (!mountedRef.current) {
        void ctx.close().catch(() => {});
        return;
      }
      ctxRef.current = ctx;

      const startTime = ctx.currentTime + 0.05;
      scheduleSongOnAudioContext(ctx, data, startTime);
      setIsPlaying(true);

      const tick = () => {
        if (!ctxRef.current) return;
        const elapsed = ctxRef.current.currentTime - startTime;
        const pct = Math.min(1, Math.max(0, elapsed / durationSec));
        setProgress(pct);
        if (pct >= 1) {
          stopPlayback();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      stopPlayback();
    }
  };

  const handleDownloadWav = async () => {
    if (typeof OfflineAudioContext === 'undefined') return;
    setExporting(true);
    try {
      const sampleRate = 44100;
      const offline = new OfflineAudioContext(1, Math.ceil(durationSec * sampleRate), sampleRate);
      scheduleSongOnAudioContext(offline, data, 0);
      const rendered = await offline.startRendering();
      const wavBlob = audioBufferToWavBlob(rendered);
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'hazel-song'}.wav`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // Ignore audio export errors on restricted browsers
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="my-2 overflow-hidden rounded-2xl border border-slate-200/90 bg-[#F8FAFD] shadow-xs dark:border-zinc-700/80 dark:bg-[#1B1C1E]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Stop song' : 'Play song'}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-blue-600 text-white shadow-xs transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
          >
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-0.5" />}
          </button>
          <div>
            <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-white">
              <Music2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span>{data.title}</span>
            </div>
            <div className="text-xs text-slate-500 dark:text-zinc-400">
              {data.genre} · {data.mood} · {bpm} BPM · Key {data.key}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDownloadWav}
          disabled={exporting}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          <Download className="h-3.5 w-3.5" />
          <span>{exporting ? 'Exporting…' : 'Download WAV'}</span>
        </button>
      </div>

      {/* Progress & Chords */}
      <div className="px-4 py-2.5">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-blue-600 transition-[width] duration-75 dark:bg-blue-400"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 dark:text-zinc-400">
          <span className="font-mono">Chords: {data.chords.join(' → ')}</span>
          <span className="font-mono tabular-nums">
            {Math.floor(progress * durationSec)}s / {Math.round(durationSec)}s
          </span>
        </div>
      </div>

      {/* Lyrics Accordion */}
      {data.lyrics && (
        <div className="border-t border-slate-200/70 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setShowLyrics((s) => !s)}
            className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"
          >
            <span>Lyrics</span>
            {showLyrics ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showLyrics && (
            <div className="px-4 pb-3 text-xs leading-relaxed whitespace-pre-wrap text-slate-700 dark:text-zinc-300">
              {data.lyrics}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/*  Video Widget (60fps HTML5 Canvas Motion Renderer + WebM Export)           */
/* -------------------------------------------------------------------------- */

export function drawVideoFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  data: VideoWidgetData
): void {
  const palette =
    data.palette.length >= 4
      ? data.palette
      : ['#0B1026', '#1D2B64', '#3E64FF', '#9BE8FF', '#F8FAFC'];
  const duration = Math.max(4, data.durationSeconds || 8);
  const progress = Math.min(0.999, Math.max(0, t / duration));
  const scenes = data.scenes.length > 0 ? data.scenes : [{ caption: data.title, intensity: 0.7, focus: 'center' }];
  const sceneIdx = Math.min(scenes.length - 1, Math.floor(progress * scenes.length));
  const scene = scenes[sceneIdx];

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, w * 0.4, h);
  grad.addColorStop(0, palette[0]);
  grad.addColorStop(0.55, palette[1]);
  grad.addColorStop(1, palette[2] || palette[1]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Atmospheric glow orb / sun / moon
  const orbX = w * (0.5 + Math.sin(t * 0.45) * 0.16);
  const orbY = h * (0.36 + Math.cos(t * 0.35) * 0.06);
  const glow = ctx.createRadialGradient(orbX, orbY, 8, orbX, orbY, w * 0.32);
  glow.addColorStop(0, palette[4] || '#FFFFFF');
  glow.addColorStop(0.35, palette[3] || '#7DD3FC');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(orbX, orbY, w * 0.32, 0, Math.PI * 2);
  ctx.fill();

  // Archetype-specific kinetic layers
  if (data.archetype === 'mountain-sunrise') {
    const layers = [0.68, 0.76, 0.84];
    layers.forEach((baseY, idx) => {
      ctx.fillStyle = palette[Math.min(palette.length - 1, idx)];
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 24) {
        const y =
          h * baseY -
          Math.abs(Math.sin(x * 0.008 + idx * 1.4 + t * (0.12 + idx * 0.05))) *
            (95 - idx * 20);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    });
  } else if (data.archetype === 'ocean-waves') {
    for (let wave = 0; wave < 4; wave++) {
      ctx.fillStyle = palette[(wave + 1) % palette.length];
      ctx.globalAlpha = 0.45 + wave * 0.12;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 16) {
        const y =
          h * (0.56 + wave * 0.09) +
          Math.sin(x * 0.015 + t * (1.8 + wave * 0.45) + wave) * (14 + wave * 3);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (data.archetype === 'cyber-rain') {
    // Neon city skyline + rain streaks
    ctx.fillStyle = palette[0];
    for (let b = 0; b < 14; b++) {
      const bx = (b * (w / 13)) - ((t * 18) % (w / 13));
      const bh = 70 + ((b * 47) % 130);
      ctx.fillRect(bx, h - bh, w / 14 - 4, bh);
      ctx.fillStyle = palette[3] || '#38BDF8';
      ctx.globalAlpha = 0.6;
      ctx.fillRect(bx + 6, h - bh + 10, 6, bh - 20);
      ctx.globalAlpha = 1;
      ctx.fillStyle = palette[0];
    }
    ctx.strokeStyle = palette[4] || '#E0F2FE';
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.55;
    for (let r = 0; r < 55; r++) {
      const rx = ((r * 73 + t * 90) % (w + 40)) - 20;
      const ry = ((r * 59 + t * 340) % (h + 40)) - 20;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - 4, ry + 18);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else {
    // Particles & kinetic orbits (cosmic-nebula / geometric-pulse / botanical-breeze)
    for (let p = 0; p < 36; p++) {
      const angle = p * 0.62 + t * (0.45 + (p % 3) * 0.2);
      const radius = 35 + ((p * 17) % (w * 0.36));
      const px = w * 0.5 + Math.cos(angle) * radius;
      const py = h * 0.48 + Math.sin(angle * 0.85) * radius * 0.55;
      ctx.fillStyle = palette[(p % (palette.length - 1)) + 1];
      ctx.globalAlpha = 0.65;
      ctx.beginPath();
      ctx.arc(px, py, 2.5 + (p % 4) * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Cinematic bottom caption bar
  if (scene?.caption) {
    ctx.fillStyle = 'rgba(10, 12, 18, 0.56)';
    ctx.fillRect(0, h - 54, w, 54);
    ctx.fillStyle = '#F8FAFC';
    ctx.font = '600 15px "DM Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(scene.caption.slice(0, 72), w / 2, h - 27);
  }
}

export const VideoWidget: React.FC<{ data: VideoWidgetData }> = ({ data }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [exporting, setExporting] = useState(false);

  const duration = Math.max(4, data.durationSeconds || 8);
  const elapsedRef = useRef(0);

  useEffect(() => {
    let rafId = 0;
    let lastNow = performance.now();
    let lastUiSync = lastNow;

    const renderLoop = (now: number) => {
      const dt = (now - lastNow) / 1000;
      lastNow = now;
      if (isPlaying) {
        elapsedRef.current = (elapsedRef.current + dt) % duration;
        if (now - lastUiSync >= 100) {
          lastUiSync = now;
          setElapsed(elapsedRef.current);
        }
      }

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        drawVideoFrame(ctx, canvas.width, canvas.height, elapsedRef.current, data);
      }

      rafId = requestAnimationFrame(renderLoop);
    };

    rafId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafId);
  }, [data, duration, isPlaying]);

  const handleReplay = () => {
    elapsedRef.current = 0;
    setElapsed(0);
    setIsPlaying(true);
  };

  const handleExportWebM = async () => {
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
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
      const donePromise = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: resolvedType }));
      });

      elapsedRef.current = 0;
      setIsPlaying(true);
      recorder.start();
      await new Promise((r) => setTimeout(r, Math.min(duration, 8) * 1000));
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
      const videoBlob = await donePromise;

      const url = URL.createObjectURL(videoBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'hazel-clip'}.${ext}`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // Ignore export failures in unsupported embedded browsers
    } finally {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      setExporting(false);
    }
  };

  return (
    <div className="my-2 overflow-hidden rounded-2xl border border-slate-200/90 bg-[#F8FAFD] shadow-xs dark:border-zinc-700/80 dark:bg-[#1B1C1E]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 px-3.5 py-2 dark:border-zinc-800">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-zinc-200">
          <Film className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <span className="truncate">{data.title}</span>
          <span className="text-[11px] font-normal text-slate-400 dark:text-zinc-500">
            · {duration}s clip
          </span>
        </div>

        <button
          type="button"
          onClick={handleExportWebM}
          disabled={exporting}
          className="inline-flex min-h-[32px] items-center gap-1 rounded-full bg-white px-2.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-700"
        >
          <Download className="h-3 w-3" />
          <span>{exporting ? 'Recording…' : 'Export WebM'}</span>
        </button>
      </div>

      <div className="bg-black">
        <canvas
          ref={canvasRef}
          width={640}
          height={360}
          className="aspect-video w-full"
        />
      </div>

      <div className="flex items-center gap-3 px-3.5 py-2">
        <button
          type="button"
          onClick={() => setIsPlaying((p) => !p)}
          aria-label={isPlaying ? 'Pause video' : 'Play video'}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700"
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-0.5" />}
        </button>
        <button
          type="button"
          onClick={handleReplay}
          aria-label="Replay video"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-blue-600 dark:bg-blue-400"
            style={{ width: `${(elapsed / duration) * 100}%` }}
          />
        </div>
        <span className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-zinc-400">
          {elapsed.toFixed(1)}s / {duration}s
        </span>
      </div>
    </div>
  );
};
