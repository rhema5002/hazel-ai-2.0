import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  BookmarkCheck,
  Camera,
  Check,
  Cloud,
  Copy,
  Database,
  LogIn,
  LogOut,
  Mic,
  Monitor,
  Moon,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Shield,
  Square,
  Sun,
  Trash2,
  UserCheck,
  Volume2,
  X,
} from 'lucide-react';
import type { StandbyStatus } from '../hooks/useStandbyVoiceControl';
import type { AuthUser } from '../services/authClient';
import { LIVE_VOICES, type LiveVoiceName } from '../services/liveSessionClient';
import {
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  type BrowserNotificationStatus,
} from '../services/reminderNotifications';
import type {
  AppSettings,
  CloudSyncStatus,
  MemoryCategory,
  MemoryItem,
  ReasoningMode,
  ThemeMode,
} from '../types/chat';
import type { AuthModalMode } from './AuthModal';
import { PWAInstallButton } from './PWAInstallButton';
import {
  describeScreenCaptureError,
  getScreenCaptureCapability,
  type ScreenCaptureCapability,
} from '../utils/screenCaptureSupport';
import {
  createInAppScreenStream,
  isInAppCaptureSupported,
} from '../utils/inAppScreenCapture';

interface SettingsModalProps {
  isOpen: boolean;
  theme: ThemeMode;
  settings: AppSettings;
  sessionCount: number;
  memories?: MemoryItem[];
  syncStatus?: CloudSyncStatus;
  lastSyncedAt?: number | null;
  supabaseSchemaSql?: string | null;
  standbySupported?: boolean;
  standbyStatus?: StandbyStatus;
  standbyError?: string | null;
  standbyUptimeSeconds?: number;
  standbyCommandsProcessed?: number;
  authUser?: AuthUser | null;
  authConfigured?: boolean;
  isAdmin?: boolean;
  onClose: () => void;
  onChangeTheme: (theme: ThemeMode) => void;
  onUpdateSettings: (next: AppSettings) => void;
  onAddMemory?: (content: string, category: MemoryCategory) => Promise<void> | void;
  onDeleteMemory?: (id: string) => Promise<void> | void;
  onClearAllMemories?: () => Promise<void> | void;
  onSyncNow?: () => Promise<void> | void;
  onClearAllChats: () => void;
  onOpenCameraCapture?: () => void;
  onOpenScreenCapture?: () => void;
  onWakeHeyHazel?: () => void;
  onClearStandbyError?: () => void;
  onTestReminderAlert?: () => void;
  onOpenAdmin?: () => void;
  onOpenAuth?: (mode?: AuthModalMode) => void;
  onSignOut?: () => void;
}

const MEMORY_CATEGORIES: Array<{ value: MemoryCategory; label: string }> = [
  { value: 'general', label: 'Note' },
  { value: 'preference', label: 'Preference' },
  { value: 'fact', label: 'Fact' },
  { value: 'project', label: 'Project' },
  { value: 'goal', label: 'Goal' },
  { value: 'person', label: 'Person' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  theme,
  settings,
  sessionCount,
  memories = [],
  syncStatus = 'guest',
  lastSyncedAt = null,
  supabaseSchemaSql = null,
  standbySupported = true,
  standbyStatus = 'off',
  standbyError = null,
  standbyUptimeSeconds = 0,
  standbyCommandsProcessed = 0,
  authUser = null,
  authConfigured = false,
  isAdmin = false,
  onClose,
  onChangeTheme,
  onUpdateSettings,
  onAddMemory,
  onDeleteMemory,
  onClearAllMemories,
  onSyncNow,
  onClearAllChats,
  onOpenCameraCapture,
  onOpenScreenCapture,
  onWakeHeyHazel,
  onClearStandbyError,
  onTestReminderAlert,
  onOpenAdmin,
  onOpenAuth,
  onSignOut,
}) => {
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmClearMemories, setConfirmClearMemories] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState('');
  const [memoryCategory, setMemoryCategory] = useState<MemoryCategory>('general');
  const [memoryQuery, setMemoryQuery] = useState('');
  const [savingMemory, setSavingMemory] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);
  const [showSchemaSql, setShowSchemaSql] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [isTestingSpeech, setIsTestingSpeech] = useState(false);
  const [micPerm, setMicPerm] = useState<'granted' | 'denied' | 'prompt' | 'unavailable'>('prompt');
  const [camPerm, setCamPerm] = useState<'granted' | 'denied' | 'prompt' | 'unavailable'>('prompt');
  const [screenPerm, setScreenPerm] = useState<
    'ready' | 'granted' | 'denied' | 'policy-blocked' | 'unavailable'
  >('ready');
  const [screenCapability, setScreenCapability] = useState<ScreenCaptureCapability>(() =>
    getScreenCaptureCapability()
  );
  const [notifPerm, setNotifPerm] = useState<BrowserNotificationStatus>(() =>
    getBrowserNotificationPermission()
  );
  const [permFeedback, setPermFeedback] = useState<string | null>(null);

  const speechSupported =
    typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => {
    if (!isOpen) return;
    setPermFeedback(null);
    setNotifPerm(getBrowserNotificationPermission());

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setMicPerm('unavailable');
      setCamPerm('unavailable');
    } else if (navigator.permissions?.query) {
      void navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then((res) => setMicPerm(res.state))
        .catch(() => {});
      void navigator.permissions
        .query({ name: 'camera' as PermissionName })
        .then((res) => setCamPerm(res.state))
        .catch(() => {});
    }

    const cap = getScreenCaptureCapability();
    setScreenCapability(cap);
    if (!cap.supported) {
      setScreenPerm('unavailable');
    } else {
      setScreenPerm('ready');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !speechSupported) return;
    const synth = window.speechSynthesis;

    const refreshVoices = () => {
      const list = synth.getVoices();
      setVoices(list);
    };

    refreshVoices();
    synth.addEventListener?.('voiceschanged', refreshVoices);
    return () => {
      synth.removeEventListener?.('voiceschanged', refreshVoices);
      synth.cancel();
      setIsTestingSpeech(false);
    };
  }, [isOpen, speechSupported]);

  const sortedVoices = useMemo(() => {
    const seenUris = new Set<string>();
    const uniqueVoices = voices.filter((voice) => {
      const uri = voice.voiceURI || `${voice.name}::${voice.lang}`;
      if (seenUris.has(uri)) return false;
      seenUris.add(uri);
      return true;
    });
    return uniqueVoices.sort((a, b) => {
      const aEn = a.lang.toLowerCase().startsWith('en') ? 0 : 1;
      const bEn = b.lang.toLowerCase().startsWith('en') ? 0 : 1;
      if (aEn !== bEn) return aEn - bEn;
      return a.name.localeCompare(b.name);
    });
  }, [voices]);

  const filteredMemories = useMemo(() => {
    const q = memoryQuery.trim().toLowerCase();
    if (!q) return memories;
    return memories.filter(
      (m) =>
        m.content.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q)
    );
  }, [memories, memoryQuery]);

  const handleCloseModal = () => {
    if (speechSupported) window.speechSynthesis.cancel();
    setIsTestingSpeech(false);
    setConfirmClear(false);
    setConfirmClearMemories(false);
    setMemoryQuery('');
    setMemoryError(null);
    setShowSchemaSql(false);
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCloseModal();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  if (!isOpen) return null;

  const handleSaveMemoryDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = memoryDraft.trim();
    if (!trimmed || !onAddMemory || savingMemory) return;
    setSavingMemory(true);
    setMemoryError(null);
    try {
      await onAddMemory(trimmed, memoryCategory);
      setMemoryDraft('');
    } catch (err) {
      setMemoryError(
        err instanceof Error ? err.message : 'Could not save memory. Please try again.'
      );
    } finally {
      setSavingMemory(false);
    }
  };

  const handleCopySql = async () => {
    if (!supabaseSchemaSql) return;
    try {
      await navigator.clipboard.writeText(supabaseSchemaSql);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    onUpdateSettings({ ...settings, [key]: value });
  };

  const handleTestVoice = () => {
    if (!speechSupported) return;
    const synth = window.speechSynthesis;
    if (isTestingSpeech) {
      synth.cancel();
      setIsTestingSpeech(false);
      return;
    }

    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(
      "Hi, I'm Hazel. This is how my speech synthesis sounds with your current voice, rate, and pitch settings."
    );
    utterance.rate = settings.speechRate;
    utterance.pitch = settings.speechPitch;
    if (settings.speechVoiceURI) {
      const matched = voices.find((v) => v.voiceURI === settings.speechVoiceURI);
      if (matched) utterance.voice = matched;
    }
    utterance.onend = () => setIsTestingSpeech(false);
    utterance.onerror = () => setIsTestingSpeech(false);
    setIsTestingSpeech(true);
    synth.speak(utterance);
  };

  const handleResetSpeech = () => {
    if (speechSupported) {
      window.speechSynthesis.cancel();
      setIsTestingSpeech(false);
    }
    onUpdateSettings({
      ...settings,
      speechRate: 1.0,
      speechPitch: 1.0,
      speechVoiceURI: '',
    });
  };

  const hasCustomSpeech =
    Math.abs(settings.speechRate - 1.0) >= 0.01 ||
    Math.abs(settings.speechPitch - 1.0) >= 0.01 ||
    settings.speechVoiceURI !== '';

  const requestDeviceAccess = async (kind: 'mic' | 'camera' | 'screen') => {
    setPermFeedback(null);
    try {
      if (kind === 'mic') {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        stream.getTracks().forEach((t) => t.stop());
        setMicPerm('granted');
        setPermFeedback('Microphone access granted.');
      } else if (kind === 'camera') {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        stream.getTracks().forEach((t) => t.stop());
        setCamPerm('granted');
        setPermFeedback('Camera access granted.');
      } else {
        const cap = getScreenCaptureCapability();
        setScreenCapability(cap);
        if (
          cap.mode === 'native' &&
          typeof navigator !== 'undefined' &&
          typeof navigator.mediaDevices?.getDisplayMedia === 'function'
        ) {
          const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
          stream.getTracks().forEach((t) => t.stop());
          setScreenPerm('granted');
          setPermFeedback('Screen sharing permission verified.');
          return;
        }

        if (cap.inAppSupported || isInAppCaptureSupported()) {
          const stream = createInAppScreenStream({ fps: 8, maxWidth: 640 });
          const hasTrack = stream.getVideoTracks().length > 0;
          stream.getTracks().forEach((t) => t.stop());
          if (!hasTrack) {
            throw new Error('Could not initialize an in-app screen video track.');
          }
          setScreenPerm('granted');
          setPermFeedback('In-app screen capture and recording verified on this browser.');
          return;
        }

        setScreenPerm('unavailable');
        setPermFeedback(
          cap.reason || 'Screen sharing is not available in this browser.'
        );
      }
    } catch (err) {
      if (kind === 'mic') setMicPerm('denied');
      if (kind === 'camera') setCamPerm('denied');
      if (kind === 'screen') {
        const details = describeScreenCaptureError(err);
        if ((details.isPolicyBlocked || details.isUnsupported) && isInAppCaptureSupported()) {
          try {
            const fallbackStream = createInAppScreenStream({ fps: 8, maxWidth: 640 });
            fallbackStream.getTracks().forEach((t) => t.stop());
            setScreenPerm('granted');
            setPermFeedback(
              'In-app screen capture verified (OS screen picker is restricted by frame or browser policy).'
            );
            return;
          } catch {
            // Fall through to error message
          }
        }
        if (details.isUnsupported) {
          setScreenPerm('unavailable');
        } else if (details.isPolicyBlocked) {
          setScreenPerm('policy-blocked');
        } else {
          setScreenPerm('denied');
        }
        setPermFeedback(details.message);
        return;
      }
      const label = kind === 'mic' ? 'Microphone' : 'Camera';
      setPermFeedback(
        err instanceof Error && err.name === 'NotFoundError'
          ? `No ${label.toLowerCase()} device detected.`
          : `${label} permission was dismissed or blocked.`
      );
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Hazel settings"
      onClick={handleCloseModal}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-[#18191C]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4 dark:border-zinc-800">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
              Settings
            </h2>
            <p className="text-xs text-slate-500 dark:text-zinc-400">
              Customize appearance, reasoning defaults, and voice preferences
            </p>
          </div>
          <button
            type="button"
            onClick={handleCloseModal}
            aria-label="Close settings"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="chat-scroll flex-1 space-y-5 overflow-y-auto p-5">
          {/* Account */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/75 p-3.5 dark:border-zinc-800 dark:bg-zinc-900/55">
            <div className="flex min-w-0 items-center gap-3">
              <div
                className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  isAdmin
                    ? 'bg-emerald-600/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400'
                    : 'bg-blue-600/10 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400'
                }`}
              >
                <UserCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900 dark:text-zinc-100">
                  {authUser ? authUser.fullName : 'Account & Sign In'}
                </div>
                <div className="truncate text-xs text-slate-500 dark:text-zinc-400">
                  {authUser
                    ? `${authUser.isAdmin ? 'Administrator' : 'Standard account'} · ${authUser.email}`
                    : authConfigured
                      ? 'Sign in with your Supabase account'
                      : 'Sign in or claim initial Admin access'}
                </div>
              </div>
            </div>

            {authUser ? (
              <div className="flex shrink-0 items-center gap-2">
                {isAdmin && onOpenAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenAdmin();
                    }}
                    className="inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 whitespace-nowrap hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/70"
                  >
                    <Shield className="h-3.5 w-3.5" />
                    <span>Admin Panel</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onSignOut?.();
                  }}
                  className="inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 whitespace-nowrap hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Sign out</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAuth?.('signin');
                }}
                className="inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-full bg-blue-600 px-3.5 text-xs font-semibold text-white whitespace-nowrap hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
              >
                <LogIn className="h-3.5 w-3.5" />
                <span>Sign in</span>
              </button>
            )}
          </div>

          {/* Supabase Cloud Sync */}
          <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-slate-50/75 p-3.5 dark:border-zinc-800 dark:bg-zinc-900/55">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <Database
                  className={`h-4 w-4 shrink-0 ${
                    syncStatus === 'synced'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : syncStatus === 'schema_missing'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-blue-600 dark:text-blue-400'
                  }`}
                />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                    Supabase Cloud Sync
                  </div>
                  <div className="text-xs text-slate-500 dark:text-zinc-400">
                    {!authUser
                      ? 'Sign in to sync chats, folders, settings, reminders & Hazel’s memory to Supabase'
                      : syncStatus === 'synced'
                        ? `All workspace & chat state synced to Supabase${
                            lastSyncedAt
                              ? ` · ${new Date(lastSyncedAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}`
                              : ''
                          }`
                        : syncStatus === 'syncing'
                          ? 'Syncing changes to Supabase…'
                          : syncStatus === 'schema_missing'
                            ? 'Run the SQL setup script once in your Supabase SQL Editor to create Hazel tables'
                            : syncStatus === 'error'
                              ? 'Cloud sync temporarily unavailable (cached locally)'
                              : authUser.provider === 'supabase'
                                ? 'Saved locally on server'
                                : 'Saved to server profile'}
                  </div>
                </div>
              </div>

              {authUser && onSyncNow && (
                <button
                  type="button"
                  onClick={() => void onSyncNow()}
                  disabled={syncStatus === 'syncing'}
                  className="inline-flex min-h-[30px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 whitespace-nowrap hover:bg-slate-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  <RefreshCw
                    className={`h-3 w-3 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`}
                  />
                  <span>{syncStatus === 'syncing' ? 'Syncing' : 'Sync now'}</span>
                </button>
              )}
            </div>

            {supabaseSchemaSql && (syncStatus === 'schema_missing' || showSchemaSql) && (
              <div className="space-y-2 border-t border-slate-200/70 pt-2.5 dark:border-zinc-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                    <Cloud className="h-3.5 w-3.5 shrink-0" />
                    <span>Paste into Supabase Dashboard → SQL Editor → Run</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleCopySql()}
                      className="inline-flex min-h-[28px] shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-2.5 text-[11px] font-semibold text-white whitespace-nowrap hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
                    >
                      {copiedSql ? (
                        <>
                          <Check className="h-3 w-3" />
                          <span>Copied SQL</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>Copy SQL</span>
                        </>
                      )}
                    </button>
                    {syncStatus !== 'schema_missing' && (
                      <button
                        type="button"
                        onClick={() => setShowSchemaSql(false)}
                        className="text-[11px] text-slate-500 hover:underline dark:text-zinc-400"
                      >
                        Hide
                      </button>
                    )}
                  </div>
                </div>
                <pre className="chat-scroll max-h-40 overflow-auto rounded-xl border border-slate-200 bg-white p-2.5 font-mono text-[10.5px] leading-relaxed text-slate-700 dark:border-zinc-800 dark:bg-[#131417] dark:text-zinc-300">
                  {supabaseSchemaSql}
                </pre>
              </div>
            )}
          </div>

          {/* Hazel Long-Term Memory Manager */}
          <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-slate-50/75 p-3.5 dark:border-zinc-800 dark:bg-zinc-900/55">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <BookmarkCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                    Hazel&apos;s Long-Term Memory
                  </span>
                  <span className="font-mono text-xs text-slate-500 tabular-nums dark:text-zinc-400">
                    · {memories.length}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-400">
                  Tell Hazel &ldquo;remember that…&rdquo; in Chat, Workspace, or Live Voice, or add notes below
                </p>
              </div>

              {memories.length > 0 && onClearAllMemories && (
                confirmClearMemories ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setConfirmClearMemories(false)}
                      className="min-h-[28px] rounded-lg border border-slate-200 px-2 text-[11px] font-medium text-slate-600 hover:bg-slate-100 dark:border-zinc-700 dark:text-zinc-300"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void onClearAllMemories();
                        setConfirmClearMemories(false);
                      }}
                      className="min-h-[28px] rounded-lg bg-rose-600 px-2.5 text-[11px] font-semibold text-white hover:bg-rose-700"
                    >
                      Clear all
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClearMemories(true)}
                    className="min-h-[28px] shrink-0 rounded-lg border border-rose-200 bg-white px-2.5 text-[11px] font-medium text-rose-600 whitespace-nowrap hover:bg-rose-50 dark:border-rose-900/60 dark:bg-zinc-800 dark:text-rose-400 dark:hover:bg-rose-950/40"
                  >
                    Clear memory
                  </button>
                )
              )}
            </div>

            {onAddMemory && (
              <form
                onSubmit={(e) => void handleSaveMemoryDraft(e)}
                className="flex flex-wrap items-center gap-2"
              >
                <input
                  type="text"
                  value={memoryDraft}
                  onChange={(e) => setMemoryDraft(e.target.value)}
                  placeholder="Add something for Hazel to remember…"
                  aria-label="Add memory for Hazel"
                  maxLength={500}
                  className="h-9 min-w-[180px] flex-1 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder:text-zinc-500"
                />
                <select
                  value={memoryCategory}
                  onChange={(e) => setMemoryCategory(e.target.value as MemoryCategory)}
                  aria-label="Memory category"
                  className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                >
                  {MEMORY_CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={!memoryDraft.trim() || savingMemory}
                  className="inline-flex h-9 shrink-0 items-center gap-1 rounded-xl bg-blue-600 px-3 text-xs font-semibold text-white whitespace-nowrap hover:bg-blue-700 disabled:opacity-45 dark:bg-blue-500 dark:hover:bg-blue-400"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Remember</span>
                </button>
              </form>
            )}

            {memoryError && (
              <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">
                {memoryError}
              </p>
            )}

            {memories.length > 4 && (
              <input
                type="text"
                value={memoryQuery}
                onChange={(e) => setMemoryQuery(e.target.value)}
                placeholder="Filter saved memories…"
                aria-label="Filter saved memories"
                className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
            )}

            {memories.length === 0 ? (
              <p className="py-2 text-center text-xs text-slate-500 dark:text-zinc-400">
                Nothing remembered yet. Ask Hazel to remember your name, preferences, goals, or projects anytime.
              </p>
            ) : (
              <div className="chat-scroll max-h-52 divide-y divide-slate-200/80 overflow-y-auto rounded-xl border border-slate-200/80 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-[#18191C]">
                {filteredMemories.map((mem) => (
                  <div
                    key={mem.id}
                    className="flex items-start justify-between gap-2.5 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-slate-800 dark:text-zinc-100">
                        {mem.content}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 tabular-nums dark:text-zinc-500">
                        <span className="capitalize">{mem.category}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {new Date(mem.updatedAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </div>
                    </div>
                    {onDeleteMemory && (
                      <button
                        type="button"
                        onClick={() => void onDeleteMemory(mem.id)}
                        aria-label={`Forget "${mem.content}"`}
                        title="Forget"
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:text-zinc-500 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                {filteredMemories.length === 0 && (
                  <div className="px-3 py-4 text-center text-xs text-slate-500 dark:text-zinc-400">
                    No memories match &ldquo;{memoryQuery}&rdquo;.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Theme */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-zinc-100">
                Appearance
              </div>
              <div className="text-xs text-slate-500 dark:text-zinc-400">
                Switch app color theme
              </div>
            </div>
            <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-zinc-800">
              <button
                type="button"
                onClick={() => onChangeTheme('light')}
                className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors ${
                  theme === 'light'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                <Sun className="h-3.5 w-3.5" />
                <span>Light</span>
              </button>
              <button
                type="button"
                onClick={() => onChangeTheme('dark')}
                className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors ${
                  theme === 'dark'
                    ? 'bg-zinc-700 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                <Moon className="h-3.5 w-3.5" />
                <span>Dark</span>
              </button>
            </div>
          </div>

          <hr className="border-slate-200/70 dark:border-zinc-800" />

          {/* Default Reasoning Mode */}
          <div className="space-y-2">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-zinc-100">
                Default Mode
              </div>
              <div className="text-xs text-slate-500 dark:text-zinc-400">
                Used when starting new conversations
              </div>
            </div>
            <div
              className={`grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100 p-1 dark:bg-zinc-800 ${
                isAdmin ? 'sm:grid-cols-4' : 'sm:grid-cols-3'
              }`}
            >
              {(
                [
                  { id: 'fast', label: 'Fast' },
                  { id: 'teacher', label: 'Teacher' },
                  { id: 'deep', label: 'Deep Think' },
                  ...(isAdmin ? [{ id: 'coder', label: 'Pro Coder' }] : []),
                ] as Array<{ id: ReasoningMode; label: string }>
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => update('defaultMode', opt.id)}
                  className={`min-h-[36px] rounded-lg px-2 text-xs font-medium transition-colors ${
                    settings.defaultMode === opt.id
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-zinc-700 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Toggles */}
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => update('defaultWebSearch', !settings.defaultWebSearch)}
              className="flex min-h-[44px] w-full items-center justify-between gap-4 text-left"
            >
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-zinc-100">
                  Enable Web Search by default
                </div>
                <div className="text-xs text-slate-500 dark:text-zinc-400">
                  Ground answers with live web results on new chats
                </div>
              </div>
              <span
                className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                  settings.defaultWebSearch
                    ? 'bg-blue-600'
                    : 'bg-slate-300 dark:bg-zinc-700'
                }`}
              >
                <span
                  className={`h-5 w-5 rounded-full bg-white transition-transform ${
                    settings.defaultWebSearch ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </span>
            </button>

            <button
              type="button"
              onClick={() => update('autoExpandThoughts', !settings.autoExpandThoughts)}
              className="flex min-h-[44px] w-full items-center justify-between gap-4 text-left"
            >
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-zinc-100">
                  Auto-expand thinking steps
                </div>
                <div className="text-xs text-slate-500 dark:text-zinc-400">
                  Keep Hazel&apos;s reasoning accordion open on responses
                </div>
              </div>
              <span
                className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                  settings.autoExpandThoughts
                    ? 'bg-blue-600'
                    : 'bg-slate-300 dark:bg-zinc-700'
                }`}
              >
                <span
                  className={`h-5 w-5 rounded-full bg-white transition-transform ${
                    settings.autoExpandThoughts ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </span>
            </button>

            {/* Built-in "Hey Hazel" Standby Voice Section */}
            <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-slate-50/75 p-3.5 dark:border-zinc-800 dark:bg-zinc-900/55">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Mic className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                      Standby Voice
                    </span>
                    <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                      &ldquo;Hey Hazel&rdquo; Built-in
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
                    {!standbySupported
                      ? 'Requires Web Speech API (Chrome, Edge, or Safari).'
                      : standbyError
                        ? standbyError
                        : settings.standbyEnabled
                          ? standbyStatus === 'engaged'
                            ? 'Listening actively for your command or question.'
                            : standbyStatus === 'paused'
                              ? 'Paused automatically while Hazel speaks.'
                              : 'Always ready hands-free — say "Hey Hazel" anytime.'
                          : 'Off — enable to control Hazel hands-free without opening Live mode.'}
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.standbyEnabled}
                  aria-label="Toggle Standby Voice"
                  onClick={() => {
                    onClearStandbyError?.();
                    update('standbyEnabled', !settings.standbyEnabled);
                  }}
                  className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                    settings.standbyEnabled
                      ? 'bg-emerald-600'
                      : 'bg-slate-300 dark:bg-zinc-700'
                  }`}
                >
                  <span
                    className={`h-5 w-5 rounded-full bg-white transition-transform ${
                      settings.standbyEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {settings.standbyEnabled && standbySupported && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 pt-2.5 text-[11px] text-slate-600 dark:border-zinc-800 dark:text-zinc-400">
                  <span className="font-mono tabular-nums">
                    Session: {Math.floor(standbyUptimeSeconds / 60)}:
                    {String(standbyUptimeSeconds % 60).padStart(2, '0')} ·{' '}
                    {standbyCommandsProcessed}{' '}
                    {standbyCommandsProcessed === 1 ? 'cmd' : 'cmds'}
                  </span>
                  {onWakeHeyHazel && (
                    <button
                      type="button"
                      onClick={() => {
                        onClearStandbyError?.();
                        onWakeHeyHazel();
                        onClose();
                      }}
                      className="rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 dark:border-emerald-900/60 dark:bg-zinc-800 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
                    >
                      Wake &ldquo;Hey Hazel&rdquo; now
                    </button>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={() =>
                  update('standbyRequireWakeWord', !settings.standbyRequireWakeWord)
                }
                className="flex min-h-[40px] w-full items-center justify-between gap-4 border-t border-slate-200/70 pt-2.5 text-left dark:border-zinc-800"
              >
                <div>
                  <div className="text-xs font-medium text-slate-900 dark:text-zinc-100">
                    Require &ldquo;Hey Hazel&rdquo; wake phrase
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-zinc-400">
                    When off, any spoken command or prompt runs immediately
                  </div>
                </div>
                <span
                  className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                    settings.standbyRequireWakeWord
                      ? 'bg-blue-600'
                      : 'bg-slate-300 dark:bg-zinc-700'
                  }`}
                >
                  <span
                    className={`h-5 w-5 rounded-full bg-white transition-transform ${
                      settings.standbyRequireWakeWord ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  update(
                    'standbySpeakConfirmations',
                    !settings.standbySpeakConfirmations
                  )
                }
                className="flex min-h-[40px] w-full items-center justify-between gap-4 text-left"
              >
                <div>
                  <div className="text-xs font-medium text-slate-900 dark:text-zinc-100">
                    Spoken confirmations in Standby
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-zinc-400">
                    Briefly confirm hands-free actions like starting or switching chats
                  </div>
                </div>
                <span
                  className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                    settings.standbySpeakConfirmations
                      ? 'bg-blue-600'
                      : 'bg-slate-300 dark:bg-zinc-700'
                  }`}
                >
                  <span
                    className={`h-5 w-5 rounded-full bg-white transition-transform ${
                      settings.standbySpeakConfirmations
                        ? 'translate-x-5'
                        : 'translate-x-0'
                    }`}
                  />
                </span>
              </button>
            </div>
          </div>

          <hr className="border-slate-200/70 dark:border-zinc-800" />

          {/* Voice & Speech */}
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-zinc-100">
                  Hazel Live Voice
                </div>
                <div className="text-xs text-slate-500 dark:text-zinc-400">
                  Voice persona used in real-time voice sessions
                </div>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 dark:border-zinc-700 dark:bg-zinc-800">
                <Volume2 className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                <select
                  value={settings.liveVoice}
                  onChange={(e) =>
                    update('liveVoice', e.target.value as LiveVoiceName)
                  }
                  aria-label="Default Hazel Live voice"
                  className="bg-transparent text-xs font-medium text-slate-800 focus:outline-none dark:bg-zinc-800 dark:text-zinc-100"
                >
                  {LIVE_VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label} · {v.tone}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Hazel Speech Synthesis Controls */}
            <div className="space-y-3.5 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3.5 dark:border-zinc-800 dark:bg-zinc-900/50">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-zinc-100">
                    Hazel Speech Synthesis
                  </div>
                  <div className="text-xs text-slate-500 dark:text-zinc-400">
                    Customize voice, speech rate, and pitch for Read Aloud
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {hasCustomSpeech && (
                    <button
                      type="button"
                      onClick={handleResetSpeech}
                      aria-label="Reset Hazel speech synthesis to defaults"
                      title="Reset speech defaults"
                      className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>Reset</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleTestVoice}
                    disabled={!speechSupported}
                    className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      isTestingSpeech
                        ? 'bg-rose-600 text-white hover:bg-rose-700'
                        : 'bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400'
                    }`}
                  >
                    {isTestingSpeech ? (
                      <>
                        <Square className="h-3 w-3 fill-current" />
                        <span>Stop</span>
                      </>
                    ) : (
                      <>
                        <Play className="h-3 w-3 fill-current" />
                        <span>Test voice</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {!speechSupported ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Speech synthesis is not supported in this browser.
                </p>
              ) : (
                <>
                  {/* Voice Selection */}
                  <div className="space-y-1.5">
                    <label
                      htmlFor="hazel-speech-voice-select"
                      className="block text-xs font-medium text-slate-700 dark:text-zinc-300"
                    >
                      Synthesis Voice
                    </label>
                    <select
                      id="hazel-speech-voice-select"
                      value={settings.speechVoiceURI}
                      onChange={(e) => update('speechVoiceURI', e.target.value)}
                      className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    >
                      <option value="">System default voice</option>
                      {sortedVoices.map((voice, idx) => (
                        <option
                          key={`${voice.voiceURI}::${voice.lang}::${idx}`}
                          value={voice.voiceURI}
                        >
                          {voice.name} ({voice.lang})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Speech Rate Slider */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor="hazel-speech-rate"
                        className="text-xs font-medium text-slate-700 dark:text-zinc-300"
                      >
                        Rate (Speed)
                      </label>
                      <span className="font-mono text-xs font-semibold text-slate-800 tabular-nums dark:text-zinc-200">
                        {settings.speechRate.toFixed(2)}x
                      </span>
                    </div>
                    <input
                      id="hazel-speech-rate"
                      type="range"
                      min={0.5}
                      max={2.0}
                      step={0.05}
                      value={settings.speechRate}
                      onChange={(e) =>
                        update('speechRate', Number(e.target.value))
                      }
                      className="h-2 w-full cursor-pointer accent-blue-600 dark:accent-blue-400"
                    />
                    <div className="flex justify-between text-[11px] text-slate-400 dark:text-zinc-500">
                      <span>0.5x Slower</span>
                      <span>1.0x Normal</span>
                      <span>2.0x Faster</span>
                    </div>
                  </div>

                  {/* Voice Pitch Slider */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor="hazel-speech-pitch"
                        className="text-xs font-medium text-slate-700 dark:text-zinc-300"
                      >
                        Voice Pitch
                      </label>
                      <span className="font-mono text-xs font-semibold text-slate-800 tabular-nums dark:text-zinc-200">
                        {settings.speechPitch.toFixed(2)}
                      </span>
                    </div>
                    <input
                      id="hazel-speech-pitch"
                      type="range"
                      min={0.5}
                      max={2.0}
                      step={0.05}
                      value={settings.speechPitch}
                      onChange={(e) =>
                        update('speechPitch', Number(e.target.value))
                      }
                      className="h-2 w-full cursor-pointer accent-blue-600 dark:accent-blue-400"
                    />
                    <div className="flex justify-between text-[11px] text-slate-400 dark:text-zinc-500">
                      <span>0.50 Deep</span>
                      <span>1.00 Natural</span>
                      <span>2.00 High</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <hr className="border-slate-200/70 dark:border-zinc-800" />

          {/* Time-Based Reminders & Expiration Alerts */}
          <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-slate-50/75 p-3.5 dark:border-zinc-800 dark:bg-zinc-900/55">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                    Reminders &amp; Expiration Alerts
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-400">
                  Trigger browser notifications, chimes, and on-screen alerts when timers or reminders expire
                </p>
              </div>
              {onTestReminderAlert && (
                <button
                  type="button"
                  onClick={() => {
                    onTestReminderAlert();
                  }}
                  className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-amber-200 bg-white px-2.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-50 dark:border-amber-900/60 dark:bg-zinc-800 dark:text-amber-300 dark:hover:bg-amber-950/40"
                >
                  <Bell className="h-3 w-3" />
                  <span>Test alert</span>
                </button>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-200/70 pt-2.5 dark:border-zinc-800">
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-900 dark:text-zinc-100">
                  Browser Notifications
                </div>
                <div
                  className={`text-[11px] font-medium ${
                    notifPerm === 'granted'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : notifPerm === 'denied' || notifPerm === 'unsupported'
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-slate-500 dark:text-zinc-400'
                  }`}
                >
                  {notifPerm === 'granted'
                    ? 'Allowed in browser'
                    : notifPerm === 'denied'
                      ? 'Blocked in browser settings (on-screen alerts still work)'
                      : notifPerm === 'unsupported'
                        ? 'Not supported in this browser (on-screen alerts active)'
                        : 'Click Allow to show desktop notifications'}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {notifPerm === 'default' && (
                  <button
                    type="button"
                    onClick={() => {
                      void requestBrowserNotificationPermission().then((res) => {
                        setNotifPerm(res);
                        if (res === 'granted') {
                          update('browserNotificationsEnabled', true);
                        }
                      });
                    }}
                    className="min-h-[30px] rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-900/60 dark:bg-blue-950/50 dark:text-blue-300"
                  >
                    Allow
                  </button>
                )}
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.browserNotificationsEnabled}
                  aria-label="Toggle browser notifications for reminders"
                  onClick={() => {
                    const nextVal = !settings.browserNotificationsEnabled;
                    update('browserNotificationsEnabled', nextVal);
                    if (nextVal && notifPerm === 'default') {
                      void requestBrowserNotificationPermission().then(setNotifPerm);
                    }
                  }}
                  className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                    settings.browserNotificationsEnabled
                      ? 'bg-blue-600'
                      : 'bg-slate-300 dark:bg-zinc-700'
                  }`}
                >
                  <span
                    className={`h-5 w-5 rounded-full bg-white transition-transform ${
                      settings.browserNotificationsEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => update('speakReminderAlerts', !settings.speakReminderAlerts)}
              className="flex min-h-[38px] w-full items-center justify-between gap-4 border-t border-slate-200/70 pt-2.5 text-left dark:border-zinc-800"
            >
              <div>
                <div className="text-xs font-medium text-slate-900 dark:text-zinc-100">
                  Speak reminder alerts aloud
                </div>
                <div className="text-[11px] text-slate-500 dark:text-zinc-400">
                  Announce the reminder label using Hazel&apos;s voice when time expires
                </div>
              </div>
              <span
                className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                  settings.speakReminderAlerts
                    ? 'bg-blue-600'
                    : 'bg-slate-300 dark:bg-zinc-700'
                }`}
              >
                <span
                  className={`h-5 w-5 rounded-full bg-white transition-transform ${
                    settings.speakReminderAlerts ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </span>
            </button>
          </div>

          <hr className="border-slate-200/70 dark:border-zinc-800" />

          {/* Device Access & Media Permissions */}
          <div className="space-y-2.5">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-zinc-100">
                Device Access &amp; Permissions
              </div>
              <div className="text-xs text-slate-500 dark:text-zinc-400">
                Grant or verify Microphone, Camera, and Screen Sharing access
              </div>
            </div>

            <div className="divide-y divide-slate-200/80 rounded-2xl border border-slate-200/80 bg-slate-50/70 dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/50">
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Mic className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
                      Microphone
                    </div>
                    <div
                      className={`text-[11px] font-medium ${
                        micPerm === 'granted'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : micPerm === 'denied' || micPerm === 'unavailable'
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-slate-500 dark:text-zinc-400'
                      }`}
                    >
                      {micPerm === 'granted'
                        ? 'Allowed'
                        : micPerm === 'denied'
                          ? 'Blocked in browser'
                          : micPerm === 'unavailable'
                            ? 'Unavailable'
                            : 'Ask when used'}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={micPerm === 'unavailable'}
                  onClick={() => void requestDeviceAccess('mic')}
                  className="min-h-[30px] shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  {micPerm === 'granted' ? 'Test' : 'Allow'}
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Camera className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
                      Camera
                    </div>
                    <div
                      className={`text-[11px] font-medium ${
                        camPerm === 'granted'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : camPerm === 'denied' || camPerm === 'unavailable'
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-slate-500 dark:text-zinc-400'
                      }`}
                    >
                      {camPerm === 'granted'
                        ? 'Allowed'
                        : camPerm === 'denied'
                          ? 'Blocked in browser'
                          : camPerm === 'unavailable'
                            ? 'Unavailable'
                            : 'Ask when used'}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {onOpenCameraCapture && (
                    <button
                      type="button"
                      onClick={onOpenCameraCapture}
                      className="min-h-[30px] shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                    >
                      Open
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={camPerm === 'unavailable'}
                    onClick={() => void requestDeviceAccess('camera')}
                    className="min-h-[30px] shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                  >
                    {camPerm === 'granted' ? 'Test' : 'Allow'}
                  </button>
                </div>
              </div>

              <div className="px-3.5 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Monitor className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
                        Screen Sharing
                      </div>
                      <div
                        className={`text-[11px] font-medium ${
                          screenPerm === 'granted'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : screenPerm === 'denied' ||
                                screenPerm === 'policy-blocked' ||
                                screenPerm === 'unavailable'
                              ? 'text-rose-600 dark:text-rose-400'
                              : screenCapability.mode === 'in-app'
                                ? 'text-indigo-600 dark:text-indigo-400'
                                : 'text-slate-500 dark:text-zinc-400'
                        }`}
                      >
                        {screenPerm === 'granted'
                          ? screenCapability.mode === 'in-app'
                            ? 'Verified (In-app mode)'
                            : 'Verified'
                          : screenPerm === 'policy-blocked'
                            ? 'Blocked by frame policy'
                            : screenPerm === 'denied'
                              ? 'Dismissed or blocked'
                              : screenCapability.shortLabel}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {onOpenScreenCapture && (
                      <button
                        type="button"
                        onClick={onOpenScreenCapture}
                        className="min-h-[30px] shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                      >
                        Share
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={!screenCapability.canAttempt}
                      title={screenCapability.reason ?? 'Prompt browser to test screen sharing'}
                      onClick={() => void requestDeviceAccess('screen')}
                      className="min-h-[30px] shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                    >
                      Test share
                    </button>
                  </div>
                </div>
                {screenCapability.reason && screenPerm !== 'granted' && (
                  <p className="mt-1.5 pl-6.5 text-[11px] leading-relaxed text-slate-500 dark:text-zinc-400">
                    {screenCapability.reason}
                  </p>
                )}
              </div>
            </div>

            {permFeedback && (
              <p className="text-xs font-medium text-slate-600 dark:text-zinc-300">
                {permFeedback}
              </p>
            )}
          </div>

          <hr className="border-slate-200/70 dark:border-zinc-800" />

          {/* Installable Web Application (PWA) */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-zinc-100">
                Web Application (PWA)
              </div>
              <div className="text-xs text-slate-500 dark:text-zinc-400">
                Install Hazel on desktop or mobile for standalone app launch &amp; offline support
              </div>
            </div>
            <PWAInstallButton variant="settings" />
          </div>

          <hr className="border-slate-200/70 dark:border-zinc-800" />

          {/* Clear Chat History */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-zinc-100">
                Chat History
              </div>
              <div className="text-xs text-slate-500 dark:text-zinc-400">
                {sessionCount} saved {sessionCount === 1 ? 'conversation' : 'conversations'} in browser storage
              </div>
            </div>

            {confirmClear ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="min-h-[36px] rounded-full border border-slate-200 px-3 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClearAllChats();
                    setConfirmClear(false);
                    onClose();
                  }}
                  className="min-h-[36px] rounded-full bg-rose-600 px-3.5 text-xs font-semibold text-white hover:bg-rose-700"
                >
                  Confirm delete
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3.5 text-xs font-medium text-rose-700 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/70"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Clear all chats</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
