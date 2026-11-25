import type { ReasoningMode } from '../types/chat';
import { parseNaturalTimerCommand } from './timerParser';

export type StandbyVoiceCommand =
  | { type: 'wake_only' }
  | { type: 'new_chat'; folderQuery?: string }
  | { type: 'switch_chat'; query: string }
  | { type: 'rename_chat'; title: string }
  | { type: 'pin_chat'; pinned: boolean }
  | { type: 'move_to_folder'; folderQuery: string }
  | { type: 'set_mode'; mode: ReasoningMode }
  | { type: 'set_web_search'; enabled: boolean }
  | {
      type: 'set_reminder';
      durationSeconds: number;
      label: string;
      targetTime: number;
      isReminder: boolean;
      reminderNote?: string;
      rawText: string;
    }
  | { type: 'dismiss_reminder_alerts' }
  | { type: 'read_aloud' }
  | { type: 'stop_reading' }
  | { type: 'stop_generating' }
  | { type: 'open_live' }
  | { type: 'standby_sleep' }
  | { type: 'standby_off' }
  | { type: 'prompt'; text: string };

export interface ParsedVoiceTranscript {
  wakeDetected: boolean;
  remainder: string;
  command: StandbyVoiceCommand | null;
}

const WAKE_REGEX =
  /^(?:(?:hey|ok|okay|hi|hello|yo|wake\s+up|a)\s+)?,?\s*(?:hazel|hazzle|hasel|hazal)(?:\s*[,.:;!?-]+\s*|\s+|$)/i;

function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function stripTrailingPunctuation(raw: string): string {
  return raw.replace(/[.!?]+$/, '').trim();
}

export function matchStandbyCommand(text: string): StandbyVoiceCommand | null {
  const clean = stripTrailingPunctuation(normalizeText(text));
  if (!clean) return null;
  const lower = clean.toLowerCase();

  // Turn off / sleep controls
  if (
    /^(?:turn off|disable|exit|quit)\s+(?:standby|voice(?:\s+control)?|hands[- ]free)$/i.test(
      lower
    ) ||
    /^(?:stop listening|voice control off)$/i.test(lower)
  ) {
    return { type: 'standby_off' };
  }

  if (
    /^(?:go to standby|standby mode|go to sleep|sleep)$/i.test(lower)
  ) {
    return { type: 'standby_sleep' };
  }

  // Dismiss active reminder / timer alerts
  if (
    /^(?:dismiss|clear|stop|silence|acknowledge)\s+(?:all\s+)?(?:the\s+)?(?:reminders?|alarms?|alerts?|timers?)$/i.test(
      lower
    )
  ) {
    return { type: 'dismiss_reminder_alerts' };
  }

  // Stop speech / generation
  if (
    /^(?:stop reading|stop speaking|cancel speech|mute|be quiet)$/i.test(lower)
  ) {
    return { type: 'stop_reading' };
  }

  if (
    /^(?:stop generating|stop responding|cancel response|stop)$/i.test(lower)
  ) {
    return { type: 'stop_generating' };
  }

  // Read aloud
  if (
    /^(?:read aloud|read this aloud|read(?: the)?(?: last)?(?: response| message| chat)?(?: aloud)?|speak response)$/i.test(
      lower
    )
  ) {
    return { type: 'read_aloud' };
  }

  // Open Live Voice Mode
  if (
    /^(?:open|start|enter)\s+(?:hazel\s+)?live(?:\s+(?:mode|voice|chat))?$/i.test(
      lower
    ) ||
    /^talk live$/i.test(lower)
  ) {
    return { type: 'open_live' };
  }

  // New chat (optionally inside a folder)
  const newChatFolderMatch =
    /^(?:start|create|open)?\s*(?:a\s+)?new\s+(?:chat|session|conversation)\s+(?:in|under|for)\s+(.+)$/i.exec(
      clean
    );
  if (newChatFolderMatch) {
    return {
      type: 'new_chat',
      folderQuery: stripTrailingPunctuation(newChatFolderMatch[1]),
    };
  }

  if (
    /^(?:start|create|open)?\s*(?:a\s+)?new\s+(?:chat|session|conversation)$/i.test(
      lower
    )
  ) {
    return { type: 'new_chat' };
  }

  // Switch chat
  const switchChatMatch =
    /^(?:open|switch to|go to|load)\s+(?:the\s+)?(?:chat|session|conversation)\s+(.+)$/i.exec(
      clean
    );
  if (switchChatMatch) {
    return {
      type: 'switch_chat',
      query: stripTrailingPunctuation(switchChatMatch[1]),
    };
  }

  // Rename chat
  const renameMatch =
    /^rename\s+(?:this\s+)?(?:chat|session|conversation)\s+(?:to\s+)?(.+)$/i.exec(
      clean
    );
  if (renameMatch) {
    return {
      type: 'rename_chat',
      title: stripTrailingPunctuation(renameMatch[1]),
    };
  }

  // Pin / Unpin
  if (/^pin\s+(?:this\s+)?(?:chat|session|conversation)$/i.test(lower)) {
    return { type: 'pin_chat', pinned: true };
  }
  if (/^unpin\s+(?:this\s+)?(?:chat|session|conversation)$/i.test(lower)) {
    return { type: 'pin_chat', pinned: false };
  }

  // Move to folder
  const moveFolderMatch =
    /^(?:move|file|put|assign)\s+(?:this\s+)?(?:chat|session|conversation)?\s*(?:to|in|under|into)\s+(?:folder\s+)?(.+)$/i.exec(
      clean
    );
  if (moveFolderMatch) {
    return {
      type: 'move_to_folder',
      folderQuery: stripTrailingPunctuation(moveFolderMatch[1]),
    };
  }

  // Mode switching
  if (
    /^(?:switch to|use|enable|set(?:\s+mode\s+to)?)\s+(?:pro\s+)?coder(?:\s+mode)?$/i.test(
      lower
    ) ||
    /^(?:pro\s+)?coder\s+mode$/i.test(lower)
  ) {
    return { type: 'set_mode', mode: 'coder' };
  }

  if (
    /^(?:switch to|use|enable|set(?:\s+mode\s+to)?)\s+(?:teacher|tutor|study)(?:\s+mode)?$/i.test(
      lower
    ) ||
    /^(?:teacher|tutor)\s+mode$/i.test(lower)
  ) {
    return { type: 'set_mode', mode: 'teacher' };
  }

  if (
    /^(?:switch to|use|enable|set(?:\s+mode\s+to)?)\s+deep(?:\s+think(?:ing)?)?(?:\s+mode)?$/i.test(
      lower
    ) ||
    /^deep\s+(?:think|mode)$/i.test(lower)
  ) {
    return { type: 'set_mode', mode: 'deep' };
  }

  if (
    /^(?:switch to|use|enable|set(?:\s+mode\s+to)?)\s+fast(?:\s+mode)?$/i.test(
      lower
    ) ||
    /^fast\s+mode$/i.test(lower)
  ) {
    return { type: 'set_mode', mode: 'fast' };
  }

  // Web search toggle
  if (
    /^(?:turn on|enable|activate)\s+(?:web\s+)?search$/i.test(lower) ||
    /^web\s+search\s+on$/i.test(lower)
  ) {
    return { type: 'set_web_search', enabled: true };
  }

  if (
    /^(?:turn off|disable|deactivate)\s+(?:web\s+)?search$/i.test(lower) ||
    /^web\s+search\s+off$/i.test(lower)
  ) {
    return { type: 'set_web_search', enabled: false };
  }

  // Time-based reminders & countdown timers (works offline and instantaneously)
  const parsedReminder = parseNaturalTimerCommand(clean);
  if (parsedReminder) {
    return {
      type: 'set_reminder',
      durationSeconds: parsedReminder.durationSeconds,
      label: parsedReminder.label,
      targetTime: parsedReminder.targetTime,
      isReminder: parsedReminder.isReminder,
      reminderNote: parsedReminder.reminderNote,
      rawText: clean,
    };
  }

  return null;
}

export function parseStandbyTranscript(
  rawTranscript: string,
  options: { isEngaged: boolean; requireWakeWord: boolean }
): ParsedVoiceTranscript {
  const normalized = normalizeText(rawTranscript);
  if (!normalized) {
    return { wakeDetected: false, remainder: '', command: null };
  }

  const wakeMatch = WAKE_REGEX.exec(normalized);
  if (wakeMatch) {
    const remainder = normalized.slice(wakeMatch[0].length).trim();
    if (!remainder) {
      return {
        wakeDetected: true,
        remainder: '',
        command: { type: 'wake_only' },
      };
    }
    const matchedCmd = matchStandbyCommand(remainder);
    return {
      wakeDetected: true,
      remainder,
      command: matchedCmd ?? { type: 'prompt', text: remainder },
    };
  }

  // Allow critical stop / exit / alarm-dismiss controls without repeating wake word
  const directCmd = matchStandbyCommand(normalized);
  if (
    directCmd &&
    (directCmd.type === 'stop_reading' ||
      directCmd.type === 'stop_generating' ||
      directCmd.type === 'dismiss_reminder_alerts' ||
      directCmd.type === 'standby_off')
  ) {
    return {
      wakeDetected: false,
      remainder: normalized,
      command: directCmd,
    };
  }

  if (options.isEngaged || !options.requireWakeWord) {
    return {
      wakeDetected: false,
      remainder: normalized,
      command: directCmd ?? { type: 'prompt', text: normalized },
    };
  }

  return {
    wakeDetected: false,
    remainder: normalized,
    command: null,
  };
}
