import React, { useEffect, useId, useRef, useState } from 'react';
import type { LiveConnectionState } from '../services/liveSessionClient';
import type { AvatarGesture } from '../types/chat';

export type LiveAvatarSize = 'sm' | 'md' | 'lg';

interface LiveAvatar2DProps {
  status?: LiveConnectionState;
  inputLevel?: number;
  outputLevel?: number;
  muted?: boolean;
  gesture?: AvatarGesture;
  size?: LiveAvatarSize;
  className?: string;
}

type BlinkState = 'open' | 'half' | 'closed';
type MouthShape = 'smile' | 'i' | 'e' | 'a' | 'o';

const VOWEL_CYCLE: MouthShape[] = ['a', 'e', 'o', 'i', 'a', 'o'];

const SIZE_CLASSES: Record<LiveAvatarSize, string> = {
  sm: 'h-40 w-32 sm:h-44 sm:w-36',
  md: 'h-56 w-48 sm:h-64 sm:w-56',
  lg: 'h-72 w-64 sm:h-80 sm:w-72',
};

export function inferAvatarGestureFromText(rawText: string): AvatarGesture {
  const text = rawText.trim();
  if (!text) return 'idle';

  if (
    /\b(not sure|confused|unclear|didn't catch|could you clarify|repeat that|what did you mean|wait,?\s*what|i'm lost|hard to tell)\b/i.test(
      text
    ) ||
    /^hmm\?/i.test(text)
  ) {
    return 'confused';
  }

  if (
    /\b(i disagree|not quite|don't think so|actually,?\s*no|nope|wouldn't recommend|can't do that|that's incorrect)\b/i.test(
      text
    ) ||
    /^(?:no|nope|nah)\b[,.! ]/i.test(text)
  ) {
    return 'disagree';
  }

  if (
    /\b(hmm+|let me think|let's see|one sec|one moment|hold on|figuring|thinking about)\b/i.test(
      text
    )
  ) {
    return 'thinking';
  }

  if (
    /\b(yay|awesome|amazing|wonderful|congrats|congratulations|love that|so happy|excited|great job|fantastic|haha|nice!)\b/i.test(
      text
    )
  ) {
    return 'happy';
  }

  if (
    /\b(yes|yeah|yep|sure|of course|definitely|absolutely|totally|agreed|makes sense|got it|sounds good|you're right|exactly)\b/i.test(
      text
    )
  ) {
    return 'agree';
  }

  return 'idle';
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export const LiveAvatar2D: React.FC<LiveAvatar2DProps> = ({
  status = 'connected',
  inputLevel = 0,
  outputLevel = 0,
  muted = false,
  gesture = 'idle',
  size = 'lg',
  className = '',
}) => {
  const uid = useId().replace(/:/g, '');
  const hairMainId = `hairMainGrad-${uid}`;
  const hairBackId = `hairBackGrad-${uid}`;
  const irisId = `irisGrad-${uid}`;
  const shirtId = `shirtGrad-${uid}`;
  const bustShadowId = `bustShadowGrad-${uid}`;
  const skirtId = `skirtGrad-${uid}`;
  const leftEyeClipId = `leftEyeClip-${uid}`;
  const rightEyeClipId = `rightEyeClip-${uid}`;
  const bottomCropClipId = `bottomCropClip-${uid}`;

  const containerRef = useRef<HTMLDivElement>(null);
  const auraRef = useRef<HTMLDivElement>(null);
  const jumpGroupRef = useRef<SVGGElement>(null);
  const backHairGroupRef = useRef<SVGGElement>(null);
  const bodyGroupRef = useRef<SVGGElement>(null);
  const headGroupRef = useRef<SVGGElement>(null);
  const leftIrisGroupRef = useRef<SVGGElement>(null);
  const rightIrisGroupRef = useRef<SVGGElement>(null);
  const leftBrowRef = useRef<SVGPathElement>(null);
  const rightBrowRef = useRef<SVGPathElement>(null);
  const frontHairGroupRef = useRef<SVGGElement>(null);

  const [blink, setBlink] = useState<BlinkState>('open');
  const [mouthShape, setMouthShape] = useState<MouthShape>('smile');

  const pointerGazeRef = useRef<{ x: number; y: number; activeUntil: number }>({
    x: 0,
    y: 0,
    activeUntil: 0,
  });
  const saccadeRef = useRef({ x: 0, y: 0 });
  const gazeRef = useRef({ x: 0, y: 0 });
  const reducedMotionRef = useRef(false);
  const gestureWeightsRef = useRef({
    think: 0,
    confused: 0,
    happy: 0,
    agree: 0,
    disagree: 0,
  });
  const gestureStartRef = useRef<{ kind: AvatarGesture; at: number }>({
    kind: gesture,
    at: typeof performance !== 'undefined' ? performance.now() : 0,
  });

  const propsRef = useRef({ status, inputLevel, outputLevel, muted, gesture });
  if (gestureStartRef.current.kind !== gesture) {
    gestureStartRef.current = {
      kind: gesture,
      at: typeof performance !== 'undefined' ? performance.now() : 0,
    };
  }
  propsRef.current = { status, inputLevel, outputLevel, muted, gesture };

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      reducedMotionRef.current = mq.matches;
      const onChange = (e: MediaQueryListEvent) => {
        reducedMotionRef.current = e.matches;
      };
      mq.addEventListener?.('change', onChange);
      return () => mq.removeEventListener?.('change', onChange);
    }
  }, []);

  // Natural blinking loop (2.2s - 5.8s interval, ~150ms open->half->closed->open + occasional double blink)
  useEffect(() => {
    let cancelled = false;
    const timeouts: number[] = [];

    const runBlink = (allowDouble: boolean) => {
      if (cancelled) return;
      setBlink('half');
      timeouts.push(
        window.setTimeout(() => {
          if (cancelled) return;
          setBlink('closed');
        }, 40)
      );
      timeouts.push(
        window.setTimeout(() => {
          if (cancelled) return;
          setBlink('half');
        }, 115)
      );
      timeouts.push(
        window.setTimeout(() => {
          if (cancelled) return;
          setBlink('open');
          if (allowDouble && Math.random() < 0.22) {
            timeouts.push(window.setTimeout(() => runBlink(false), 160));
          } else {
            scheduleNext();
          }
        }, 160)
      );
    };

    const scheduleNext = () => {
      const delay = 2200 + Math.random() * 3600;
      timeouts.push(window.setTimeout(() => runBlink(true), delay));
    };

    scheduleNext();
    return () => {
      cancelled = true;
      for (const t of timeouts) window.clearTimeout(t);
    };
  }, []);

  // Subtle random eye saccades every 1.4s - 3.2s
  useEffect(() => {
    let cancelled = false;
    let timerId = 0;

    const tickSaccade = () => {
      if (cancelled) return;
      saccadeRef.current = {
        x: (Math.random() - 0.5) * 4.5,
        y: (Math.random() - 0.5) * 2.5,
      };
      timerId = window.setTimeout(tickSaccade, 1400 + Math.random() * 1800);
    };

    tickSaccade();
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, []);

  // 60fps smooth idle breathing, head sway, gentle gesture expressions & gaze interpolation
  useEffect(() => {
    let rafId = 0;
    const start = performance.now();
    let lastNow = start;

    const frame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000));
      lastNow = now;
      const elapsed = (now - start) / 1000;
      const gestureElapsed = Math.max(0, (now - gestureStartRef.current.at) / 1000);
      const motionScale = reducedMotionRef.current ? 0.25 : 1;
      const breathPhase = elapsed * motionScale;

      const {
        status: curStatus,
        inputLevel: curInput,
        outputLevel: curOutput,
        muted: curMuted,
        gesture: curGesture,
      } = propsRef.current;

      const weights = gestureWeightsRef.current;
      const blendRate = 1 - Math.exp(-8.5 * dt);
      weights.think = lerp(weights.think, curGesture === 'thinking' ? 1 : 0, blendRate);
      weights.confused = lerp(weights.confused, curGesture === 'confused' ? 1 : 0, blendRate);
      weights.happy = lerp(weights.happy, curGesture === 'happy' ? 1 : 0, blendRate);
      weights.agree = lerp(weights.agree, curGesture === 'agree' ? 1 : 0, blendRate);
      weights.disagree = lerp(weights.disagree, curGesture === 'disagree' ? 1 : 0, blendRate);

      const usePointer = now < pointerGazeRef.current.activeUntil;
      let targetX = usePointer ? pointerGazeRef.current.x : saccadeRef.current.x;
      let targetY = usePointer ? pointerGazeRef.current.y : saccadeRef.current.y;
      if (weights.think > 0.25) {
        targetX = lerp(targetX, 3.0, weights.think);
        targetY = lerp(targetY, -2.5, weights.think);
      } else if (weights.confused > 0.25) {
        targetX = lerp(targetX, -2.2, weights.confused);
        targetY = lerp(targetY, -1.5, weights.confused);
      }

      const nextGazeX = gazeRef.current.x + (targetX - gazeRef.current.x) * 0.16;
      const nextGazeY = gazeRef.current.y + (targetY - gazeRef.current.y) * 0.16;
      gazeRef.current = { x: nextGazeX, y: nextGazeY };

      const breath = Math.sin(breathPhase * Math.PI * 0.5);
      const sway = Math.sin(breathPhase * 0.85);

      // Cheerful happy bounce anchored cleanly inside bottom crop
      const hopPhase = gestureElapsed * 4.2 * motionScale;
      const hopWave = Math.pow(Math.abs(Math.sin(hopPhase)), 0.85);
      const jumpHeight = hopWave * 10 * weights.happy * motionScale;

      // Natural Agree nod & Disagree head shake
      const nodSin =
        Math.sin(gestureElapsed * 5.6 * motionScale) +
        0.18 * Math.sin(gestureElapsed * 11.2 * motionScale);
      const nodY = nodSin * 4.8 * weights.agree * motionScale;
      const shakeSin = Math.sin(gestureElapsed * 6.4 * motionScale);
      const shakeX = shakeSin * 4.6 * weights.disagree * motionScale;
      const shakeTilt = shakeSin * 4.0 * weights.disagree * motionScale;

      const bodyLift =
        breath * -2.2 -
        (curStatus === 'speaking' ? curOutput * 3.5 : 0) +
        nodY * 0.16;
      const bodyScaleY = 1 + breath * 0.008;

      const headTilt =
        sway * 1.4 +
        (curStatus === 'listening' && !curMuted && curInput > 0.06 ? -2.2 : 0) +
        (curStatus === 'speaking' ? Math.sin(breathPhase * 5.2) * curOutput * 3.2 : 0) +
        weights.think * -5.0 +
        weights.confused * 7.8 +
        shakeTilt;

      const headY =
        breath * -2.8 -
        (curStatus === 'speaking' ? curOutput * 2.5 : 0) +
        nodY +
        weights.think * 1.2;

      const hairBounce =
        breath * 1.4 +
        curOutput * 3.2 +
        Math.sin(hopPhase * 2 - 0.9) * 3.2 * weights.happy * motionScale;

      const activeEnergy = Math.max(curOutput, curMuted ? 0 : curInput, weights.happy * 0.55);

      if (auraRef.current) {
        auraRef.current.style.transform = `scale(${1 + activeEnergy * 0.18})`;
      }
      if (jumpGroupRef.current) {
        jumpGroupRef.current.setAttribute('transform', `translate(0, ${(-jumpHeight).toFixed(2)})`);
      }
      if (backHairGroupRef.current) {
        backHairGroupRef.current.setAttribute(
          'transform',
          `translate(${shakeX * 0.72}, ${headY + hairBounce * 0.4}) rotate(${headTilt * 0.65} 180 150)`
        );
      }
      if (bodyGroupRef.current) {
        bodyGroupRef.current.setAttribute(
          'transform',
          `translate(0, ${bodyLift}) scale(1, ${bodyScaleY})`
        );
      }
      if (headGroupRef.current) {
        headGroupRef.current.setAttribute(
          'transform',
          `translate(${shakeX}, ${headY}) rotate(${headTilt} 180 155)`
        );
      }

      const gazeTransform = `translate(${nextGazeX}, ${nextGazeY})`;
      if (leftIrisGroupRef.current) {
        leftIrisGroupRef.current.setAttribute('transform', gazeTransform);
      }
      if (rightIrisGroupRef.current) {
        rightIrisGroupRef.current.setAttribute('transform', gazeTransform);
      }

      const baseOuterY = curStatus === 'speaking' ? 132 - curOutput * 3 : 134;
      const leftOuterY =
        baseOuterY - weights.think * 2.4 - weights.confused * 3.0 - weights.happy * 3.2 + weights.disagree * 2.2;
      const rightOuterY =
        baseOuterY + weights.confused * 2.0 - weights.happy * 3.2 + weights.disagree * 2.2;
      const leftArchY =
        126 - weights.think * 2.6 - weights.confused * 3.6 - weights.happy * 3.6 + weights.disagree * 1.6;
      const rightArchY =
        126 + weights.confused * 1.4 - weights.happy * 3.6 + weights.disagree * 1.6;

      if (leftBrowRef.current) {
        leftBrowRef.current.setAttribute(
          'd',
          `M127 ${leftOuterY.toFixed(1)} Q145 ${leftArchY.toFixed(1)} 162 ${(133 + weights.disagree * 2.2).toFixed(1)}`
        );
      }
      if (rightBrowRef.current) {
        rightBrowRef.current.setAttribute(
          'd',
          `M198 ${(133 + weights.disagree * 2.2).toFixed(1)} Q215 ${rightArchY.toFixed(1)} 233 ${rightOuterY.toFixed(1)}`
        );
      }
      if (frontHairGroupRef.current) {
        frontHairGroupRef.current.setAttribute(
          'transform',
          `translate(0, ${hairBounce * 0.25})`
        );
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Lip-sync mouth shape driven by Hazel's live 24kHz voice output level
  useEffect(() => {
    if (status !== 'speaking' || outputLevel < 0.04) {
      setMouthShape('smile');
      return;
    }

    const vowelIdx = Math.floor((performance.now() / 115) % VOWEL_CYCLE.length);
    if (outputLevel > 0.34) {
      setMouthShape(VOWEL_CYCLE[vowelIdx] === 'i' ? 'a' : VOWEL_CYCLE[vowelIdx]);
    } else if (outputLevel > 0.14) {
      setMouthShape(vowelIdx % 2 === 0 ? 'e' : 'o');
    } else {
      setMouthShape('i');
    }
  }, [status, outputLevel]);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    pointerGazeRef.current = {
      x: Math.max(-5.5, Math.min(5.5, nx * 5.5)),
      y: Math.max(-3.5, Math.min(3.5, ny * 3.5)),
      activeUntil: performance.now() + 2200,
    };
  };

  const showHappyEyes = gesture === 'happy' && status !== 'speaking';

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      className={`relative flex select-none items-center justify-center ${SIZE_CLASSES[size]} ${className}`.trim()}
    >
      {/* Subtle reactive aura behind the 2D character */}
      <div
        ref={auraRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-4 rounded-full bg-gradient-to-tr from-blue-500/20 via-sky-400/15 to-indigo-500/20 blur-2xl transition-transform duration-150"
      />

      <svg
        viewBox="0 0 360 445"
        className="relative h-full w-full drop-shadow-[0_14px_28px_rgba(37,99,235,0.16)]"
        role="img"
        aria-label="Hazel 2D animated character"
      >
        <defs>
          <linearGradient id={hairMainId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4377E0" />
            <stop offset="55%" stopColor="#2A58BE" />
            <stop offset="100%" stopColor="#1B3D8A" />
          </linearGradient>
          <linearGradient id={hairBackId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2851AA" />
            <stop offset="100%" stopColor="#152D6B" />
          </linearGradient>
          <linearGradient id={irisId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1D3D88" />
            <stop offset="55%" stopColor="#3B7AE8" />
            <stop offset="100%" stopColor="#85C7FF" />
          </linearGradient>
          <linearGradient id={shirtId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="62%" stopColor="#F6F9FE" />
            <stop offset="100%" stopColor="#E4ECF7" />
          </linearGradient>
          <linearGradient id={bustShadowId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#CBD6E8" stopOpacity="0" />
            <stop offset="100%" stopColor="#A6B9D9" stopOpacity="0.78" />
          </linearGradient>
          <linearGradient id={skirtId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2E4575" />
            <stop offset="50%" stopColor="#23365E" />
            <stop offset="100%" stopColor="#172442" />
          </linearGradient>
          <clipPath id={leftEyeClipId}>
            <ellipse cx="145" cy="158" rx="19" ry="15.5" />
          </clipPath>
          <clipPath id={rightEyeClipId}>
            <ellipse cx="215" cy="158" rx="19" ry="15.5" />
          </clipPath>
          <clipPath id={bottomCropClipId}>
            <rect x="-20" y="-30" width="400" height="466" />
          </clipPath>
        </defs>

        <g clipPath={`url(#${bottomCropClipId})`}>
          <g ref={jumpGroupRef}>
            {/* Back Hair Layer (longer, softer layered locks framing shoulders) */}
            <g ref={backHairGroupRef}>
              <path
                d="M94 132 C82 182, 76 244, 88 286 C100 296, 114 282, 124 290 C142 298, 164 294, 180 298 C196 294, 218 298, 236 290 C246 282, 260 296, 272 286 C284 244, 278 182, 266 132 C254 74, 222 48, 180 48 C138 48, 106 74, 94 132 Z"
                fill={`url(#${hairBackId})`}
                stroke="#152447"
                strokeWidth="2.8"
                strokeLinejoin="round"
              />
            </g>

            {/* Body, Figure-8 Hourglass Silhouette, Fuller Bust & High-Waisted Skirt */}
            <g ref={bodyGroupRef}>
              {/* Arms cropped cleanly at the bottom like before, spaced clear of bust & hips */}
              <path
                d="M108 272 C86 294, 68 332, 66 384 L65 456 L89 456 L91 384 C93 346, 104 312, 118 294 Z"
                fill="#FCE0CD"
                stroke="#3B2A24"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
              <path
                d="M252 272 C274 294, 292 332, 294 384 L295 456 L271 456 L269 384 C267 346, 256 312, 242 294 Z"
                fill="#FCE0CD"
                stroke="#3B2A24"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />

              {/* Slender Neck & Upper Chest Skin */}
              <path
                d="M164 206 L163 244 C150 248, 134 258, 126 274 L234 274 C226 258, 210 248, 197 244 L196 206 Z"
                fill="#FCE0CD"
                stroke="#3B2A24"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
              {/* Subtle chin shadow on neck */}
              <path
                d="M165 210 Q180 227 195 210 L195 224 Q180 234 165 224 Z"
                fill="#EBC1A8"
              />
              {/* Delicate collarbone & subtle upper-chest contour lines */}
              <path
                d="M148 258 Q163 263 175 260"
                fill="none"
                stroke="#D6A58B"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
              <path
                d="M212 258 Q197 263 185 260"
                fill="none"
                stroke="#D6A58B"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
              <path
                d="M174 268 Q180 273 186 268"
                fill="none"
                stroke="#D6A58B"
                strokeWidth="1.5"
                strokeLinecap="round"
              />

              {/* High-Waisted Fitted Skirt (Cinched Waist flaring into Full Figure-8 Hips) */}
              <path
                d="M141 356 L219 356 C225 374, 245 390, 245 415 C245 428, 243 442, 240 456 L120 456 C117 442, 115 428, 115 415 C115 390, 135 374, 141 356 Z"
                fill={`url(#${skirtId})`}
                stroke="#16213B"
                strokeWidth="2.8"
                strokeLinejoin="round"
              />
              {/* Waistband seam & hip contour highlights */}
              <path
                d="M139 367 Q180 372 221 367"
                fill="none"
                stroke="#16213B"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
              <path
                d="M127 396 C122 406, 122 418, 125 429"
                fill="none"
                stroke="#5D7BB8"
                strokeWidth="2.2"
                strokeLinecap="round"
                opacity="0.55"
              />
              <path
                d="M233 396 C238 406, 238 418, 235 429"
                fill="none"
                stroke="#5D7BB8"
                strokeWidth="2.2"
                strokeLinecap="round"
                opacity="0.55"
              />
              <path
                d="M162 378 Q160 402 156 428"
                fill="none"
                stroke="#152038"
                strokeWidth="1.8"
                strokeLinecap="round"
                opacity="0.55"
              />
              <path
                d="M198 378 Q200 402 204 428"
                fill="none"
                stroke="#152038"
                strokeWidth="1.8"
                strokeLinecap="round"
                opacity="0.55"
              />

              {/* Fitted Feminine Scoop-Neck Top (Noticeably Fuller Bust tapering to Cinched Waist) */}
              <path
                d="M148 246 C132 250, 108 264, 92 286 L112 304 L122 292 C114 306, 113 322, 121 334 C129 345, 138 351, 141 360 Q180 365 219 360 C222 351, 231 345, 239 334 C247 322, 246 306, 238 292 L248 304 L268 286 C252 264, 228 250, 212 246 C202 277, 158 277, 148 246 Z"
                fill={`url(#${shirtId})`}
                stroke="#2B3345"
                strokeWidth="2.8"
                strokeLinejoin="round"
              />

              {/* Scoop-neck collar rib */}
              <path
                d="M148 246 C158 278, 202 278, 212 246"
                fill="none"
                stroke="#2B3345"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <path
                d="M145 250 C157 284, 203 284, 215 250"
                fill="none"
                stroke="#CBD5E1"
                strokeWidth="1.7"
                strokeLinecap="round"
              />

              {/* Fuller Bust Volume & Deep Under-Bust Contour Shading */}
              <path
                d="M117 310 C123 338, 162 344, 180 326 C198 344, 237 338, 243 310 C244 328, 232 344, 216 348 C199 352, 186 344, 180 336 C174 344, 161 352, 144 348 C128 344, 116 328, 117 310 Z"
                fill={`url(#${bustShadowId})`}
              />
              {/* Rounded anime bust-line & center fabric tension creases */}
              <path
                d="M120 314 C129 336, 162 341, 177 324"
                fill="none"
                stroke="#3E4C63"
                strokeWidth="2.3"
                strokeLinecap="round"
                opacity="0.86"
              />
              <path
                d="M240 314 C231 336, 198 341, 183 324"
                fill="none"
                stroke="#3E4C63"
                strokeWidth="2.3"
                strokeLinecap="round"
                opacity="0.86"
              />
              {/* Subtle center cleavage shadow & soft upper-bust highlights */}
              <path
                d="M180 294 Q180 309 180 322"
                fill="none"
                stroke="#9EB2D4"
                strokeWidth="1.9"
                strokeLinecap="round"
                opacity="0.8"
              />
              <path
                d="M133 292 Q153 286 169 296"
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="2.8"
                strokeLinecap="round"
                opacity="0.95"
              />
              <path
                d="M227 292 Q207 286 191 296"
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="2.8"
                strokeLinecap="round"
                opacity="0.95"
              />
              <path
                d="M146 344 Q152 352 149 358"
                fill="none"
                stroke="#CBD5E1"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              <path
                d="M214 344 Q208 352 211 358"
                fill="none"
                stroke="#CBD5E1"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </g>

            {/* Head, Facial Features & Front Bangs */}
            <g ref={headGroupRef}>
              {/* Ears */}
              <path
                d="M116 152 C106 152, 106 175, 118 179"
                fill="#FCE0CD"
                stroke="#3B2A24"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
              <path
                d="M244 152 C254 152, 254 175, 242 179"
                fill="#FCE0CD"
                stroke="#3B2A24"
                strokeWidth="2.4"
                strokeLinecap="round"
              />

              {/* Softer Feminine Anime Head Contour */}
              <path
                d="M118 130 C116 90, 141 68, 180 68 C219 68, 244 90, 242 130 C242 165, 232 189, 212 206 C197 219, 187 224, 180 224 C173 224, 163 219, 148 206 C128 189, 118 165, 118 130 Z"
                fill="#FCE4D2"
                stroke="#3B2A24"
                strokeWidth="2.7"
                strokeLinejoin="round"
              />

              {/* Soft rosy anime cheek blush */}
              <ellipse cx="137" cy="175" rx="12" ry="6" fill="#F89CA2" opacity="0.42" />
              <ellipse cx="223" cy="175" rx="12" ry="6" fill="#F89CA2" opacity="0.42" />

              {/* Subtle Anime Nose */}
              <path
                d="M179 172 L177 179 L181 181"
                fill="none"
                stroke="#B98772"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Eyes Layer (Happy Arches / Closed / Half / Open) */}
              {showHappyEyes ? (
                <g>
                  <path
                    d="M126 161 Q145 144 164 161"
                    fill="none"
                    stroke="#1E2538"
                    strokeWidth="4.2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M122 156 L127 159"
                    fill="none"
                    stroke="#1E2538"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                  />
                  <path
                    d="M196 161 Q215 144 234 161"
                    fill="none"
                    stroke="#1E2538"
                    strokeWidth="4.2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M238 156 L233 159"
                    fill="none"
                    stroke="#1E2538"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                  />
                </g>
              ) : blink === 'closed' ? (
                <g>
                  <path
                    d="M126 161 Q145 168 164 160"
                    fill="none"
                    stroke="#232B3D"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                  />
                  <path
                    d="M121 157 L128 162 M123 163 L130 163 M162 160 L167 157"
                    fill="none"
                    stroke="#232B3D"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                  />
                  <path
                    d="M196 160 Q215 168 234 161"
                    fill="none"
                    stroke="#232B3D"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                  />
                  <path
                    d="M193 157 L198 160 M230 163 L237 163 M232 162 L239 157"
                    fill="none"
                    stroke="#232B3D"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                  />
                </g>
              ) : (
                <g>
                  {/* Sclera */}
                  <ellipse cx="145" cy="158" rx="19" ry={blink === 'half' ? 8 : 15} fill="#FFFFFF" />
                  <ellipse cx="215" cy="158" rx="19" ry={blink === 'half' ? 8 : 15} fill="#FFFFFF" />

                  {/* Left Iris & Pupil */}
                  <g clipPath={`url(#${leftEyeClipId})`}>
                    <g ref={leftIrisGroupRef}>
                      <ellipse cx="145" cy="159" rx="12.4" ry="14" fill={`url(#${irisId})`} stroke="#172B5E" strokeWidth="1.6" />
                      <ellipse cx="145" cy="160" rx="5.2" ry="6.2" fill="#111D3E" />
                      <circle cx="140" cy="153" r="3.6" fill="#FFFFFF" />
                      <circle cx="150" cy="165" r="1.8" fill="#FFFFFF" opacity="0.92" />
                    </g>
                  </g>

                  {/* Right Iris & Pupil */}
                  <g clipPath={`url(#${rightEyeClipId})`}>
                    <g ref={rightIrisGroupRef}>
                      <ellipse cx="215" cy="159" rx="12.4" ry="14" fill={`url(#${irisId})`} stroke="#172B5E" strokeWidth="1.6" />
                      <ellipse cx="215" cy="160" rx="5.2" ry="6.2" fill="#111D3E" />
                      <circle cx="210" cy="153" r="3.6" fill="#FFFFFF" />
                      <circle cx="220" cy="165" r="1.8" fill="#FFFFFF" opacity="0.92" />
                    </g>
                  </g>

                  {/* Upper eyelid crease + winged feminine lashes */}
                  {blink === 'half' ? (
                    <>
                      <path d="M126 156 Q145 162 164 156 L164 143 L126 143 Z" fill="#FCE4D2" />
                      <path d="M196 156 Q215 162 234 156 L234 143 L196 143 Z" fill="#FCE4D2" />
                      <path d="M124 155 Q145 161 165 156" fill="none" stroke="#1E2538" strokeWidth="4" strokeLinecap="round" />
                      <path d="M195 156 Q215 161 236 155" fill="none" stroke="#1E2538" strokeWidth="4" strokeLinecap="round" />
                    </>
                  ) : (
                    <>
                      <path
                        d="M123 155 C132 141, 157 141, 165 154"
                        fill="none"
                        stroke="#1E2538"
                        strokeWidth="4.4"
                        strokeLinecap="round"
                      />
                      <path
                        d="M119 148 Q123 152 127 154 M121 153 L125 155"
                        fill="none"
                        stroke="#1E2538"
                        strokeWidth="2.8"
                        strokeLinecap="round"
                      />
                      <path
                        d="M195 154 C203 141, 228 141, 237 155"
                        fill="none"
                        stroke="#1E2538"
                        strokeWidth="4.4"
                        strokeLinecap="round"
                      />
                      <path
                        d="M241 148 Q237 152 233 154 M239 153 L235 155"
                        fill="none"
                        stroke="#1E2538"
                        strokeWidth="2.8"
                        strokeLinecap="round"
                      />
                      {/* Delicate eyelid crease */}
                      <path d="M132 141 Q145 137 158 142" fill="none" stroke="#B98772" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
                      <path d="M202 142 Q215 137 228 141" fill="none" stroke="#B98772" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
                      {/* Subtle lower lash */}
                      <path d="M134 171 Q145 174 156 171" fill="none" stroke="#6E554B" strokeWidth="1.6" strokeLinecap="round" />
                      <path d="M204 171 Q215 174 226 171" fill="none" stroke="#6E554B" strokeWidth="1.6" strokeLinecap="round" />
                    </>
                  )}
                </g>
              )}

              {/* Soft Curved Blue Eyebrows */}
              <path
                ref={leftBrowRef}
                d="M127 134 Q145 126 162 133"
                fill="none"
                stroke="#244CA8"
                strokeWidth="2.8"
                strokeLinecap="round"
              />
              <path
                ref={rightBrowRef}
                d="M198 133 Q215 126 233 134"
                fill="none"
                stroke="#244CA8"
                strokeWidth="2.8"
                strokeLinecap="round"
              />

              {/* Mouth Shapes (Lip Sync + Gesture Expression + Soft Rosy Lip Tint) */}
              {mouthShape === 'smile' && gesture === 'confused' && (
                <path
                  d="M170 199 Q175 196 180 199 T190 198"
                  fill="none"
                  stroke="#8F434A"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
              )}
              {mouthShape === 'smile' && gesture === 'thinking' && (
                <path
                  d="M173 199 Q180 201 187 198"
                  fill="none"
                  stroke="#8F434A"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
              )}
              {mouthShape === 'smile' && gesture === 'disagree' && (
                <path
                  d="M170 200 Q180 197 190 200"
                  fill="none"
                  stroke="#8F434A"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
              )}
              {mouthShape === 'smile' &&
                gesture !== 'confused' &&
                gesture !== 'thinking' &&
                gesture !== 'disagree' && (
                  <g>
                    <path
                      d="M168 197 Q180 205 192 197"
                      fill="none"
                      stroke="#8F434A"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M174 203 Q180 205.5 186 203"
                      fill="none"
                      stroke="#E5989B"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      opacity="0.75"
                    />
                  </g>
                )}
              {mouthShape === 'i' && (
                <path
                  d="M169 197 Q180 203 191 197 Q180 200 169 197 Z"
                  fill="#A84C57"
                  stroke="#6B3137"
                  strokeWidth="2.2"
                  strokeLinejoin="round"
                />
              )}
              {mouthShape === 'e' && (
                <path
                  d="M168 195 Q180 194 192 195 Q190 205 180 205 Q170 205 168 195 Z"
                  fill="#8D3440"
                  stroke="#6B3137"
                  strokeWidth="2.2"
                  strokeLinejoin="round"
                />
              )}
              {mouthShape === 'a' && (
                <g>
                  <path
                    d="M168 194 Q180 192 192 194 Q191 210 180 210 Q169 210 168 194 Z"
                    fill="#852D39"
                    stroke="#6B3137"
                    strokeWidth="2.2"
                    strokeLinejoin="round"
                  />
                  <ellipse cx="180" cy="206" rx="7.5" ry="3.2" fill="#EE919A" />
                </g>
              )}
              {mouthShape === 'o' && (
                <g>
                  <ellipse
                    cx="180"
                    cy="201"
                    rx="6.6"
                    ry="7.8"
                    fill="#852D39"
                    stroke="#6B3137"
                    strokeWidth="2.2"
                  />
                  <ellipse cx="180" cy="206" rx="3.8" ry="2.2" fill="#EE919A" />
                </g>
              )}

              {/* Front Hair & Longer Face-Framing Locks */}
              <g ref={frontHairGroupRef}>
                <path
                  d="M107 156 C99 110, 122 55, 180 55 C238 55, 261 110, 253 156 C260 196, 252 242, 234 268 C240 236, 241 190, 236 148 C230 124, 218 106, 206 100 C210 114, 204 128, 194 136 C198 118, 192 104, 182 96 C178 114, 166 128, 152 135 C158 118, 155 104, 148 96 C134 108, 124 128, 122 154 C119 192, 120 236, 126 268 C108 242, 100 196, 107 156 Z"
                  fill={`url(#${hairMainId})`}
                  stroke="#152447"
                  strokeWidth="2.8"
                  strokeLinejoin="round"
                />
                {/* Clean anime hair shine arcs */}
                <path
                  d="M138 86 Q156 76 174 84"
                  fill="none"
                  stroke="#85BCFF"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  opacity="0.72"
                />
                <path
                  d="M196 84 Q212 78 224 88"
                  fill="none"
                  stroke="#85BCFF"
                  strokeWidth="3"
                  strokeLinecap="round"
                  opacity="0.68"
                />
              </g>
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
};
