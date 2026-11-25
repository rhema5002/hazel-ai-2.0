export interface InAppScreenStreamOptions {
  fps?: number;
  maxWidth?: number;
}

export function isInAppCaptureSupported(): boolean {
  if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined') {
    return false;
  }
  const proto = HTMLCanvasElement.prototype as HTMLCanvasElement & {
    webkitCaptureStream?: (frameRate?: number) => MediaStream;
  };
  return typeof proto.captureStream === 'function' || typeof proto.webkitCaptureStream === 'function';
}

function isColorVisible(color: string | null | undefined): boolean {
  if (!color) return false;
  const trimmed = color.trim().toLowerCase();
  if (!trimmed || trimmed === 'transparent' || trimmed === 'none') return false;
  if (trimmed === 'rgba(0, 0, 0, 0)' || trimmed === 'rgba(0,0,0,0)') return false;
  return true;
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number,
  lineHeight: number,
  textAlign: string
) {
  if (maxWidth <= 2 || maxHeight <= 2) return;
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  if (words.length === 0 || (words.length === 1 && !words[0])) return;

  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !currentLine) {
      currentLine = candidate;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }

  let drawY = y;
  for (const line of lines) {
    if (drawY + lineHeight * 0.5 > y + maxHeight + 4) break;
    let drawX = x;
    if (textAlign === 'center') {
      drawX = x + maxWidth / 2;
      ctx.textAlign = 'center';
    } else if (textAlign === 'right' || textAlign === 'end') {
      drawX = x + maxWidth;
      ctx.textAlign = 'right';
    } else {
      ctx.textAlign = 'left';
    }
    ctx.fillText(line, drawX, drawY, maxWidth);
    drawY += lineHeight;
  }
}

/**
 * Renders the live Hazel app viewport onto an offscreen canvas and exposes
 * a standard MediaStream via `canvas.captureStream()`, enabling screen sharing,
 * snapshots, and video recording even on mobile browsers/PWAs without `getDisplayMedia`.
 */
export function createInAppScreenStream(
  options: InAppScreenStreamOptions = {}
): MediaStream {
  if (!isInAppCaptureSupported()) {
    throw new Error('In-app screen capture (canvas.captureStream) is not supported in this browser.');
  }

  const fps = Math.max(4, Math.min(30, options.fps ?? 12));
  const maxWidth = options.maxWidth ?? 1080;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    throw new Error('Could not initialize 2D canvas context for in-app screen capture.');
  }

  const updateCanvasSize = () => {
    const vw = Math.max(320, window.innerWidth || 390);
    const vh = Math.max(240, window.innerHeight || 844);
    const scale = Math.min(window.devicePixelRatio || 1, maxWidth / vw, 2);
    const targetW = Math.max(2, Math.round(vw * scale) & ~1);
    const targetH = Math.max(2, Math.round(vh * scale) & ~1);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    return { vw, vh, scaleX: targetW / vw, scaleY: targetH / vh };
  };

  let textRange: Range | null = null;
  try {
    textRange = document.createRange();
  } catch {
    textRange = null;
  }

  const renderFrame = () => {
    const { vw, vh, scaleX, scaleY } = updateCanvasSize();

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const bodyBg = window.getComputedStyle(document.body).backgroundColor;
    const isDark = document.documentElement.classList.contains('dark');
    ctx.fillStyle = isColorVisible(bodyBg) ? bodyBg : isDark ? '#131314' : '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.scale(scaleX, scaleY);

    const rootEl = document.getElementById('root') || document.body;

    const paintNode = (node: Node, parentEl: Element | null, parentStyle: CSSStyleDeclaration | null) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const raw = node.nodeValue;
        if (!raw || !raw.trim() || !parentEl || !parentStyle) return;

        let rect: DOMRect;
        if (textRange) {
          try {
            textRange.selectNodeContents(node);
            rect = textRange.getBoundingClientRect();
          } catch {
            rect = parentEl.getBoundingClientRect();
          }
        } else {
          rect = parentEl.getBoundingClientRect();
        }

        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.right <= 0 ||
          rect.bottom <= 0 ||
          rect.left >= vw ||
          rect.top >= vh
        ) {
          return;
        }

        const fontSizeNum = parseFloat(parentStyle.fontSize) || 14;
        const rawLineHeight = parseFloat(parentStyle.lineHeight);
        const lineHeight = Number.isFinite(rawLineHeight)
          ? rawLineHeight
          : Math.round(fontSizeNum * 1.35);

        ctx.save();
        ctx.fillStyle = parentStyle.color || (isDark ? '#E4E4E7' : '#0F172A');
        ctx.font = `${parentStyle.fontStyle || 'normal'} ${parentStyle.fontWeight || '400'} ${fontSizeNum}px ${parentStyle.fontFamily || 'sans-serif'}`;
        ctx.textBaseline = 'top';
        drawWrappedText(
          ctx,
          raw,
          rect.left,
          rect.top,
          rect.width,
          rect.height,
          lineHeight,
          parentStyle.textAlign || 'left'
        );
        ctx.restore();
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as HTMLElement;
      if (el.getAttribute('data-hazel-capture-ignore') === 'true') return;

      const style = window.getComputedStyle(el);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        parseFloat(style.opacity || '1') <= 0.01
      ) {
        return;
      }

      const rect = el.getBoundingClientRect();
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.right <= 0 ||
        rect.bottom <= 0 ||
        rect.left >= vw ||
        rect.top >= vh
      ) {
        return;
      }

      const opacity = Math.max(0, Math.min(1, parseFloat(style.opacity || '1')));
      const radius = parseFloat(style.borderRadius) || 0;
      const hasBg = isColorVisible(style.backgroundColor);
      const borderWidth = parseFloat(style.borderTopWidth) || 0;
      const hasBorder = borderWidth > 0 && isColorVisible(style.borderTopColor);

      ctx.save();
      if (opacity < 1) {
        ctx.globalAlpha *= opacity;
      }

      if (hasBg || hasBorder) {
        ctx.beginPath();
        drawRoundedRectPath(ctx, rect.left, rect.top, rect.width, rect.height, radius);
        if (hasBg) {
          ctx.fillStyle = style.backgroundColor;
          ctx.fill();
        }
        if (hasBorder) {
          ctx.lineWidth = borderWidth;
          ctx.strokeStyle = style.borderTopColor;
          ctx.stroke();
        }
      }

      const shouldClip =
        style.overflow === 'hidden' ||
        style.overflow === 'auto' ||
        style.overflow === 'scroll' ||
        style.overflowX === 'hidden' ||
        style.overflowY === 'hidden' ||
        style.overflowY === 'auto';

      if (shouldClip) {
        ctx.beginPath();
        drawRoundedRectPath(ctx, rect.left, rect.top, rect.width, rect.height, radius);
        ctx.clip();
      }

      const tag = el.tagName;
      if (tag === 'CANVAS') {
        try {
          ctx.drawImage(el as HTMLCanvasElement, rect.left, rect.top, rect.width, rect.height);
        } catch {
          // Ignore tainted/unready canvas
        }
      } else if (tag === 'VIDEO') {
        const videoEl = el as HTMLVideoElement;
        if (videoEl.readyState >= 2) {
          try {
            ctx.drawImage(videoEl, rect.left, rect.top, rect.width, rect.height);
          } catch {
            // Ignore cross-origin video
          }
        }
      } else if (tag === 'IMG') {
        const imgEl = el as HTMLImageElement;
        if (imgEl.complete && imgEl.naturalWidth > 0) {
          try {
            ctx.drawImage(imgEl, rect.left, rect.top, rect.width, rect.height);
          } catch {
            // Ignore cross-origin image
          }
        }
      } else if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        const val =
          tag === 'SELECT'
            ? (el as HTMLSelectElement).selectedOptions?.[0]?.textContent || ''
            : (el as HTMLInputElement | HTMLTextAreaElement).value ||
              (el as HTMLInputElement | HTMLTextAreaElement).placeholder ||
              '';
        if (val) {
          const padLeft = parseFloat(style.paddingLeft) || 8;
          const padTop = parseFloat(style.paddingTop) || 6;
          const fontSizeNum = parseFloat(style.fontSize) || 13;
          ctx.fillStyle = style.color || (isDark ? '#E4E4E7' : '#0F172A');
          ctx.font = `${style.fontWeight || '400'} ${fontSizeNum}px ${style.fontFamily || 'sans-serif'}`;
          ctx.textBaseline = 'top';
          ctx.textAlign = 'left';
          ctx.fillText(
            val.slice(0, 120),
            rect.left + padLeft,
            rect.top + padTop,
            Math.max(10, rect.width - padLeft * 2)
          );
        }
      } else {
        for (let i = 0; i < el.childNodes.length; i++) {
          paintNode(el.childNodes[i], el, style);
        }
      }

      ctx.restore();
    };

    paintNode(rootEl, null, null);
    ctx.restore();
  };

  // Paint immediately so the stream's first frame is ready right away
  renderFrame();

  const captureFn =
    (canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }).captureStream ||
    (canvas as HTMLCanvasElement & { webkitCaptureStream?: (fps?: number) => MediaStream })
      .webkitCaptureStream;

  const stream = captureFn.call(canvas, fps);

  const timerId = window.setInterval(() => {
    try {
      renderFrame();
    } catch {
      // Keep interval resilient across transient DOM transitions
    }
  }, Math.round(1000 / fps));

  let stopped = false;
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(timerId);
  };

  stream.getTracks().forEach((track) => {
    const origStop = track.stop.bind(track);
    track.stop = () => {
      cleanup();
      origStop();
    };
    track.addEventListener('ended', cleanup, { once: true });
  });

  return stream;
}
