import { useEffect, useRef, useState } from 'react';

interface UseTypingEffectResult {
  displayedText: string;
  isTyping: boolean;
}

/**
 * Smoothly reveals incoming streaming assistant text with an adaptive
 * typing-effect simulation. Messages mounted from saved history (never seen
 * with `isStreaming: true`) render immediately with zero replay.
 */
export function useTypingEffect(
  fullText: string,
  isStreaming: boolean,
  enabled = true
): UseTypingEffectResult {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
    };
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  // Only animate messages that actually streamed during this component lifetime
  const shouldAnimateRef = useRef<boolean>(isStreaming);
  if (isStreaming) {
    shouldAnimateRef.current = true;
  }

  const instantMode = !enabled || prefersReducedMotion || !shouldAnimateRef.current;

  const [visibleLength, setVisibleLength] = useState<number>(() =>
    instantMode ? fullText.length : 0
  );
  const visibleLengthRef = useRef<number>(visibleLength);
  const fullTextRef = useRef<string>(fullText);
  const isStreamingRef = useRef<boolean>(isStreaming);
  const fracCarryRef = useRef<number>(0);

  fullTextRef.current = fullText;
  isStreamingRef.current = isStreaming;

  // Handle text reset / clear or instant mode snap
  useEffect(() => {
    if (instantMode) {
      if (visibleLengthRef.current !== fullText.length) {
        visibleLengthRef.current = fullText.length;
        fracCarryRef.current = 0;
        setVisibleLength(fullText.length);
      }
      return;
    }

    if (fullText.length < visibleLengthRef.current) {
      visibleLengthRef.current = fullText.length;
      fracCarryRef.current = 0;
      setVisibleLength(fullText.length);
    }
  }, [fullText, instantMode]);

  useEffect(() => {
    if (instantMode) return;
    if (visibleLengthRef.current >= fullText.length) return;

    let rafId = 0;
    let lastTime = performance.now();

    const step = (now: number) => {
      const targetLen = fullTextRef.current.length;
      const currentLen = visibleLengthRef.current;

      if (currentLen >= targetLen) {
        fracCarryRef.current = 0;
        return;
      }

      const dtSec = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      const remaining = targetLen - currentLen;

      // Adaptive natural pacing:
      // - Crisp character-by-character typing feel when near the buffer tip
      // - Smooth proportional acceleration during large SSE bursts / code blocks
      // - Rapid catch-up finish once the network stream ends
      const baseRate = isStreamingRef.current ? 88 : 260;
      const backlogBoost = remaining * (isStreamingRef.current ? 2.4 : 6.0);
      const charsPerSec = Math.min(2800, baseRate + backlogBoost);

      fracCarryRef.current += charsPerSec * dtSec;
      const wholeChars = Math.floor(fracCarryRef.current);

      if (wholeChars >= 1) {
        fracCarryRef.current -= wholeChars;
        const nextLen = Math.min(targetLen, currentLen + wholeChars);
        visibleLengthRef.current = nextLen;
        setVisibleLength(nextLen);

        if (nextLen >= targetLen) {
          fracCarryRef.current = 0;
          return;
        }
      }

      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [fullText, isStreaming, instantMode]);

  const displayedText = instantMode ? fullText : fullText.slice(0, visibleLength);
  const isTyping =
    !instantMode && (isStreaming || visibleLength < fullText.length);

  return { displayedText, isTyping };
}
