export type ReasoningMode = 'fast' | 'teacher' | 'deep' | 'coder';

export type AppView = 'chat' | 'workspace' | 'admin';

export type ChatSpace = 'chat' | 'workspace';

export type AttachmentKind = 'image' | 'pdf' | 'text';

export interface AttachmentItem {
  id: string;
  name: string;
  mimeType: string;
  kind: AttachmentKind;
  sizeBytes: number;
  base64Data?: string;
  textContent?: string;
  previewUrl?: string;
}

export interface GroundingSource {
  title: string;
  url: string;
}

export interface TimerWidgetData {
  kind: 'timer';
  id: string;
  label: string;
  durationSeconds: number;
  createdAt: number;
  targetTime?: number;
  isReminder?: boolean;
  reminderNote?: string;
}

export type AvatarGesture =
  | 'idle'
  | 'happy'
  | 'thinking'
  | 'confused'
  | 'agree'
  | 'disagree';

export interface ActiveReminderAlert {
  id: string;
  sessionId?: string;
  label: string;
  note?: string;
  isReminder: boolean;
  triggeredAt: number;
  targetTime: number;
  durationSeconds: number;
}

export interface ScheduledReminder {
  id: string;
  label: string;
  durationSeconds: number;
  dueAt: number;
  isReminder?: boolean;
}

export interface SongWidgetData {
  kind: 'song';
  id: string;
  title: string;
  genre: string;
  mood: string;
  key: string;
  bpm: number;
  chords: string[];
  melodyNotes: number[];
  bassNotes: number[];
  drumStyle: 'lofi' | 'pop' | 'synthwave' | 'ambient' | 'rock';
  lyrics: string;
  prompt: string;
}

export interface ImageWidgetData {
  kind: 'image';
  id: string;
  title: string;
  prompt: string;
  style: string;
  svgMarkup: string;
}

export interface VideoSceneData {
  caption: string;
  intensity: number;
  focus: string;
}

export interface VideoWidgetData {
  kind: 'video';
  id: string;
  title: string;
  prompt: string;
  durationSeconds: number;
  palette: string[];
  archetype:
    | 'cosmic-nebula'
    | 'cyber-rain'
    | 'ocean-waves'
    | 'mountain-sunrise'
    | 'botanical-breeze'
    | 'geometric-pulse';
  scenes: VideoSceneData[];
}

export type MemoryCategory =
  | 'preference'
  | 'fact'
  | 'project'
  | 'goal'
  | 'person'
  | 'general';

export interface MemoryItem {
  id: string;
  content: string;
  category: MemoryCategory;
  source: 'assistant' | 'user' | 'live';
  createdAt: number;
  updatedAt: number;
}

export interface MemoryWidgetData {
  kind: 'memory';
  id: string;
  action: 'saved' | 'forgotten';
  memoryId?: string;
  content: string;
  category: MemoryCategory;
  createdAt: number;
}

export type ChatWidget =
  | TimerWidgetData
  | SongWidgetData
  | ImageWidgetData
  | VideoWidgetData
  | MemoryWidgetData;

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  thoughts?: string;
  sources?: GroundingSource[];
  attachments?: AttachmentItem[];
  widgets?: ChatWidget[];
  createdAt: number;
  mode?: ReasoningMode;
  webSearch?: boolean;
  isStreaming?: boolean;
  isThinking?: boolean;
  error?: string;
  feedback?: 'up' | 'down' | null;
}

export type CategoryColor =
  | 'blue'
  | 'emerald'
  | 'violet'
  | 'amber'
  | 'rose'
  | 'cyan'
  | 'slate';

export interface ChatCategory {
  id: string;
  name: string;
  color: CategoryColor;
}

export interface ChatSession {
  id: string;
  space?: ChatSpace;
  title: string;
  pinned: boolean;
  categoryId?: string | null;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export type ThemeMode = 'light' | 'dark';

export type LiveVoiceOption = 'Zephyr' | 'Kore' | 'Puck' | 'Charon' | 'Fenrir';

export interface AppSettings {
  defaultMode: ReasoningMode;
  defaultWebSearch: boolean;
  liveVoice: LiveVoiceOption;
  speechRate: number;
  speechPitch: number;
  speechVoiceURI: string;
  autoExpandThoughts: boolean;
  standbyEnabled: boolean;
  standbyRequireWakeWord: boolean;
  standbySpeakConfirmations: boolean;
  browserNotificationsEnabled: boolean;
  speakReminderAlerts: boolean;
}

export type CloudSyncStatus =
  | 'guest'
  | 'syncing'
  | 'synced'
  | 'local'
  | 'schema_missing'
  | 'error';


