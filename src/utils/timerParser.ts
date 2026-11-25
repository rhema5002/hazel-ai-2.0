export interface ParsedTimerCommand {
  durationSeconds: number;
  label: string;
  targetTime: number;
  isReminder: boolean;
  reminderNote?: string;
}

const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  'forty-five': 45,
  fifty: 50,
  sixty: 60,
  ninety: 90,
  half: 0.5,
};

function normalizeNumberWords(input: string): string {
  let out = input.toLowerCase();
  out = out.replace(/\bhalf an hour\b/g, '30 minutes');
  out = out.replace(/\bhalf a minute\b/g, '30 seconds');
  out = out.replace(/\ba quarter hour\b/g, '15 minutes');
  for (const [word, val] of Object.entries(WORD_NUMBERS)) {
    const rx = new RegExp(
      `\\b${word}\\b(?=\\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\\b)`,
      'gi'
    );
    out = out.replace(rx, String(val));
  }
  return out;
}

function cleanReminderLabel(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^(?:to|about|that|for)\s+/i, '')
    .replace(/[.!?]+$/, '')
    .replace(/^["']|["']$/g, '')
    .trim();
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1, 60);
}

/**
 * Resolves a spoken or typed time-of-day expression (e.g. "3:30 PM", "18:45", "7am", "noon")
 * to the next upcoming local epoch timestamp within 24 hours.
 */
export function resolveTimeOfDayToEpoch(
  timeStr: string,
  nowMs: number = Date.now()
): { targetTime: number; durationSeconds: number } | null {
  const s = timeStr.trim().toLowerCase();
  if (!s) return null;

  let hour24 = -1;
  let minute = 0;

  if (/\bnoon\b/.test(s)) {
    hour24 = 12;
    minute = 0;
  } else if (/\bmidnight\b/.test(s)) {
    hour24 = 0;
    minute = 0;
  } else {
    const m = /^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i.exec(
      s.replace(/\s+/g, ' ')
    );
    if (!m) return null;
    const rawHour = Number.parseInt(m[1], 10);
    const rawMin = m[2] ? Number.parseInt(m[2], 10) : 0;
    const meridiem = m[3]?.replace(/\./g, '').toLowerCase();

    if (!Number.isFinite(rawHour) || !Number.isFinite(rawMin) || rawMin < 0 || rawMin > 59) {
      return null;
    }

    if (meridiem === 'am' || meridiem === 'pm') {
      if (rawHour < 1 || rawHour > 12) return null;
      hour24 = rawHour % 12;
      if (meridiem === 'pm') hour24 += 12;
      minute = rawMin;
    } else {
      if (rawHour < 0 || rawHour > 23) return null;
      // 24-hour unambiguous if > 12 or has leading zero with colon, else pick next upcoming AM/PM
      hour24 = rawHour;
      minute = rawMin;

      if (rawHour >= 1 && rawHour <= 12 && !m[1].startsWith('0')) {
        const now = new Date(nowMs);
        const amCand = new Date(nowMs);
        amCand.setHours(rawHour % 12, minute, 0, 0);
        if (amCand.getTime() <= now.getTime() + 1000) {
          amCand.setDate(amCand.getDate() + 1);
        }

        const pmCand = new Date(nowMs);
        pmCand.setHours((rawHour % 12) + 12, minute, 0, 0);
        if (pmCand.getTime() <= now.getTime() + 1000) {
          pmCand.setDate(pmCand.getDate() + 1);
        }

        const chosen =
          amCand.getTime() <= pmCand.getTime() ? amCand : pmCand;
        const durationSeconds = Math.max(
          1,
          Math.min(86400, Math.round((chosen.getTime() - nowMs) / 1000))
        );
        return { targetTime: chosen.getTime(), durationSeconds };
      }
    }
  }

  if (hour24 < 0 || hour24 > 23) return null;
  const target = new Date(nowMs);
  target.setHours(hour24, minute, 0, 0);
  if (target.getTime() <= nowMs + 1000) {
    target.setDate(target.getDate() + 1);
  }
  const durationSeconds = Math.max(
    1,
    Math.min(86400, Math.round((target.getTime() - nowMs) / 1000))
  );
  return { targetTime: target.getTime(), durationSeconds };
}

/**
 * Parses natural language timer & time-based reminder commands:
 * - "Set a timer for 10 minutes"
 * - "Start a 5 min timer for pasta"
 * - "Remind me in 45 seconds to check the oven"
 * - "Remind me to stretch in 15 minutes"
 * - "Remind me at 3:30 PM to take a break"
 * - "Set a reminder for 6pm to call Sarah"
 */
export function parseNaturalTimerCommand(
  rawText: string,
  nowMs: number = Date.now()
): ParsedTimerCommand | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  const lower = normalizeNumberWords(trimmed);
  const isReminderVerb = /\b(remind|reminder|wake\s+me|alarm|alert\s+me|notify\s+me)\b/i.test(
    lower
  );

  // 1. Check for clock-time reminder / alarm ("remind me at 3:30 pm ...", "set an alarm for 7am")
  const clockRegex =
    /\b(?:at|for|by)\s+((?:\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|\d{1,2}:\d{2}|noon|midnight))\b/i;
  const clockMatch = clockRegex.exec(trimmed);
  if (
    clockMatch &&
    (isReminderVerb || /\b(set|create|add|schedule)\b.*\b(timer|alarm|reminder)\b/i.test(lower))
  ) {
    const resolved = resolveTimeOfDayToEpoch(clockMatch[1], nowMs);
    if (resolved) {
      const beforeTime = trimmed.slice(0, clockMatch.index);
      const afterTime = trimmed.slice(clockMatch.index + clockMatch[0].length);

      let label = '';
      const afterTaskMatch =
        /^(?:,?\s*(?:to|about|for|that)\s+)(.+)$/i.exec(afterTime.trim());
      if (afterTaskMatch?.[1]) {
        label = cleanReminderLabel(afterTaskMatch[1]);
      } else {
        const beforeTaskMatch =
          /\b(?:remind\s+me|set\s+(?:a\s+)?(?:reminder|alarm)|notify\s+me|alert\s+me|wake\s+me(?:\s+up)?)\s+(?:to|about|for)\s+(.+)$/i.exec(
            beforeTime.trim()
          );
        if (beforeTaskMatch?.[1]) {
          label = cleanReminderLabel(beforeTaskMatch[1]);
        }
      }

      if (!label) {
        label = `${formatReminderClockTime(resolved.targetTime)} Reminder`;
      }

      return {
        durationSeconds: resolved.durationSeconds,
        label,
        targetTime: resolved.targetTime,
        isReminder: true,
        reminderNote: label,
      };
    }
  }

  // 2. Check for relative duration timer or reminder ("in 10 minutes", "for 5 mins")
  const looksLikeTimerIntent =
    /\b(set|start|create|make|add|begin|run|put|schedule)\b.*\b(timer|countdown|alarm|reminder)\b/i.test(
      lower
    ) ||
    /\b(timer|countdown|reminder)\b.*\b(\d+|hour|hr|min|sec)/i.test(lower) ||
    /\b(remind|alert|notify)\s+me\b.*\b(\d+|hour|hr|min|sec)/i.test(lower);

  if (!looksLikeTimerIntent) return null;

  let totalSeconds = 0;
  const unitRegex =
    /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi;
  let match: RegExpExecArray | null;
  let matchedAnyUnit = false;
  let firstMatchIndex = -1;
  let lastMatchEnd = -1;

  while ((match = unitRegex.exec(lower)) !== null) {
    matchedAnyUnit = true;
    if (firstMatchIndex === -1) firstMatchIndex = match.index;
    lastMatchEnd = match.index + match[0].length;

    const value = Number.parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(value) || value <= 0) continue;

    if (unit.startsWith('h')) {
      totalSeconds += Math.round(value * 3600);
    } else if (unit.startsWith('m')) {
      totalSeconds += Math.round(value * 60);
    } else {
      totalSeconds += Math.round(value);
    }
  }

  if (!matchedAnyUnit || totalSeconds <= 0) {
    return null;
  }

  // Clamp cleanly between 1 second and 24 hours
  const clamped = Math.max(1, Math.min(86400, totalSeconds));
  const targetTime = nowMs + clamped * 1000;

  // Extract optional label (either after the duration or between "remind me to ..." and the duration)
  let label = '';
  const tailText = lastMatchEnd >= 0 ? trimmed.slice(lastMatchEnd).trim() : '';
  const leadText = firstMatchIndex > 0 ? trimmed.slice(0, firstMatchIndex).trim() : '';

  const namedMatch = /\b(?:called|named|labeled)\s+["']?([a-zA-Z0-9 _'-]{2,48})["']?/i.exec(
    trimmed
  );
  const tailTaskMatch = /^(?:,?\s*(?:to|about|for)\s+)(.+)$/i.exec(tailText);
  const leadTaskMatch =
    /\b(?:remind\s+me|set\s+(?:a\s+)?(?:reminder|timer|alarm)|notify\s+me|alert\s+me)\s+(?:to|about|for)\s+(.+?)\s+(?:in|after|for)\s*$/i.exec(
      leadText
    );

  if (namedMatch?.[1]) {
    label = cleanReminderLabel(namedMatch[1]);
  } else if (tailTaskMatch?.[1]) {
    label = cleanReminderLabel(tailTaskMatch[1]);
  } else if (leadTaskMatch?.[1]) {
    label = cleanReminderLabel(leadTaskMatch[1]);
  } else {
    const fallbackFor =
      /\bfor\s+(?!\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b)([a-zA-Z0-9][a-zA-Z0-9 '\-]{1,40})$/i.exec(
        trimmed
      );
    if (fallbackFor?.[1]) {
      label = cleanReminderLabel(fallbackFor[1]);
    }
  }

  if (!label) {
    label = isReminderVerb
      ? formatTimerLabel(clamped).replace(/Timer$/, 'Reminder')
      : formatTimerLabel(clamped);
  }

  return {
    durationSeconds: clamped,
    label,
    targetTime,
    isReminder: isReminderVerb,
    reminderNote: isReminderVerb ? label : undefined,
  };
}

export function formatTimerLabel(seconds: number): string {
  if (seconds >= 3600) {
    const hrs = Math.round((seconds / 3600) * 10) / 10;
    return `${hrs}h Timer`;
  }
  if (seconds >= 60) {
    const mins = Math.round((seconds / 60) * 10) / 10;
    return `${mins}m Timer`;
  }
  return `${seconds}s Timer`;
}

export function formatReminderClockTime(epochMs: number): string {
  try {
    return new Date(epochMs).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function formatCountdownClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
