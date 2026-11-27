import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  Bell,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Code2,
  GraduationCap,
  HelpCircle,
  LayoutPanelLeft,
  Lock,
  LogIn,
  LogOut,
  Menu,
  MessageSquare,
  Mic,
  PanelLeft,
  Pause,
  Shield,
  Upload,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import { AdminPanel } from './components/AdminPanel';
import { AuthModal, type AuthModalMode } from './components/AuthModal';
import { CameraCaptureModal } from './components/CameraCaptureModal';
import { ChatSidebar } from './components/ChatSidebar';
import { LandingWelcomePage } from './components/LandingWelcomePage';
import { inferAvatarGestureFromText } from './components/LiveAvatar2D';
import {
  LiveVoiceOverlay,
  type LiveTranscriptTurn,
} from './components/LiveVoiceOverlay';
import { MediaGalleryModal } from './components/MediaGalleryModal';
import { MessageItem } from './components/MessageItem';
import { OfflineIndicator, PWAInstallBanner } from './components/PWAInstallButton';
import { PromptComposer } from './components/PromptComposer';
import { ReminderAlertBanner } from './components/ReminderAlertBanner';
import { ScreenRecorderController } from './components/ScreenRecorderController';
import { SettingsModal } from './components/SettingsModal';
import { SparkEmblem } from './components/SparkEmblem';
import type { HazelTimerControlDetail } from './components/TimerWidget';
import { WelcomeScreen } from './components/WelcomeScreen';
import { WorkspaceLockedView } from './components/WorkspaceLockedView';
import { WorkspacePanel } from './components/WorkspacePanel';
import {
  DEFAULT_CATEGORIES,
  createNewSession,
  deriveSessionTitle,
  generateId,
  inferSessionSpace,
  loadActiveSessionId,
  loadActiveWorkspaceSessionId,
  loadCategories,
  loadMemories,
  loadScheduledReminders,
  loadSessions,
  loadSettings,
  loadThemePreference,
  normalizeAppSettings,
  saveActiveSessionId,
  saveActiveWorkspaceSessionId,
  saveCategories,
  saveMemories,
  saveScheduledReminders,
  saveSessions,
  saveSettings,
  saveThemePreference,
  type StoredScheduledReminder,
} from './services/chatStorage';
import {
  ChatStreamHttpError,
  readFileAsAttachment,
  streamChatResponse,
  type MemoryStreamEvent,
} from './services/chatStreamClient';
import {
  exchangeAuthCallback,
  fetchAuthSession,
  isTransientAuthError,
  signOutSession,
  type AuthUser,
} from './services/authClient';
import {
  clearCloudMemories,
  createCloudMemory,
  deleteCloudMemory,
  fetchCloudState,
  saveCloudState,
} from './services/cloudSyncClient';
import type { LiveMemoryEvent } from './services/liveSessionClient';
import {
  dispatchBrowserReminderNotification,
  getBrowserNotificationPermission,
  playReminderChimeLoop,
  requestBrowserNotificationPermission,
  type BrowserNotificationStatus,
} from './services/reminderNotifications';
import type {
  ActiveReminderAlert,
  AppSettings,
  AppView,
  AttachmentItem,
  AvatarGesture,
  CategoryColor,
  ChatCategory,
  ChatMessage,
  ChatSession,
  ChatSpace,
  ChatWidget,
  CloudSyncStatus,
  MemoryCategory,
  MemoryItem,
  ReasoningMode,
  ThemeMode,
  TimerWidgetData,
} from './types/chat';
import { useStandbyVoiceControl } from './hooks/useStandbyVoiceControl';
import {
  formatCountdownClock,
  formatReminderClockTime,
  parseNaturalTimerCommand,
} from './utils/timerParser';
import type { StandbyVoiceCommand } from './utils/voiceCommandParser';
import { extractWorkspaceArtifacts } from './utils/workspaceArtifacts';

function playWakeChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now);
    osc.frequency.setValueAtTime(880, now + 0.08);
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.24);
    osc.onended = () => {
      void ctx.close().catch(() => {});
    };
  } catch {
    // Ignore audio context errors
  }
}

function formatStandbyUptime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function stripMarkdownForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' Code block omitted. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface SpeechQueueEntry {
  id: string;
  role: 'user' | 'assistant';
  spoken: string;
}

interface SpeechQueueState {
  sessionId: string;
  queue: SpeechQueueEntry[];
  currentIndex: number;
  charOffset: number;
  pausedForIncoming: boolean;
}

function ensureBothSpaces(rawSessions: ChatSession[]): ChatSession[] {
  const normalized: ChatSession[] = rawSessions.map((s) => {
    const space = inferSessionSpace(s);
    return {
      ...s,
      space,
      categoryId: space === 'workspace' ? s.categoryId ?? null : null,
    };
  });
  const hasChat = normalized.some((s) => inferSessionSpace(s) === 'chat');
  const hasWorkspace = normalized.some((s) => inferSessionSpace(s) === 'workspace');
  const result: ChatSession[] = [...normalized];
  if (!hasChat) {
    result.push(createNewSession(null, 'chat'));
  }
  if (!hasWorkspace) {
    result.push(createNewSession(null, 'workspace'));
  }
  return result;
}

export function App() {
  const [sessions, setSessions] = useState<ChatSession[]>(() =>
    ensureBothSpaces(loadSessions())
  );

  const [categories, setCategories] = useState<ChatCategory[]>(() =>
    loadCategories()
  );

  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [adminBootstrapAvailable, setAdminBootstrapAvailable] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode>('signin');
  const [authContextNotice, setAuthContextNotice] = useState<string | null>(null);
  const [showWelcomePage, setShowWelcomePage] = useState(true);
  const [appView, setAppView] = useState<AppView>('chat');

  const isAdmin = Boolean(authUser?.isAdmin);
  const currentSpace: ChatSpace =
    appView === 'workspace' && isAdmin ? 'workspace' : 'chat';

  const chatSessions = useMemo(
    () => sessions.filter((s) => inferSessionSpace(s) === 'chat'),
    [sessions]
  );

  const workspaceSessions = useMemo(
    () => sessions.filter((s) => inferSessionSpace(s) === 'workspace'),
    [sessions]
  );

  const [activeChatSessionId, setActiveChatSessionId] = useState<string>(() => {
    const savedId = loadActiveSessionId();
    const loadedChats = ensureBothSpaces(loadSessions()).filter(
      (s) => inferSessionSpace(s) === 'chat'
    );
    if (savedId && loadedChats.some((s) => s.id === savedId)) {
      return savedId;
    }
    return loadedChats[0]?.id ?? '';
  });

  const [activeWorkspaceSessionId, setActiveWorkspaceSessionId] = useState<string>(() => {
    const savedId = loadActiveWorkspaceSessionId();
    const loadedWorkspaces = ensureBothSpaces(loadSessions()).filter(
      (s) => inferSessionSpace(s) === 'workspace'
    );
    if (savedId && loadedWorkspaces.some((s) => s.id === savedId)) {
      return savedId;
    }
    return loadedWorkspaces[0]?.id ?? '';
  });

  // Ensure both Chat Space and Workspace always maintain at least one valid session
  useEffect(() => {
    if (chatSessions.length === 0 || workspaceSessions.length === 0) {
      setSessions((prev) => ensureBothSpaces(prev));
    }
  }, [chatSessions.length, workspaceSessions.length]);

  useEffect(() => {
    if (
      chatSessions.length > 0 &&
      !chatSessions.some((s) => s.id === activeChatSessionId)
    ) {
      setActiveChatSessionId(chatSessions[0].id);
    }
  }, [chatSessions, activeChatSessionId]);

  useEffect(() => {
    if (
      workspaceSessions.length > 0 &&
      !workspaceSessions.some((s) => s.id === activeWorkspaceSessionId)
    ) {
      setActiveWorkspaceSessionId(workspaceSessions[0].id);
    }
  }, [workspaceSessions, activeWorkspaceSessionId]);

  const activeChatSession = useMemo(
    () =>
      chatSessions.find((s) => s.id === activeChatSessionId) ??
      chatSessions[0] ??
      sessions[0],
    [chatSessions, activeChatSessionId, sessions]
  );

  const activeWorkspaceSession = useMemo(
    () =>
      workspaceSessions.find((s) => s.id === activeWorkspaceSessionId) ??
      workspaceSessions[0] ??
      sessions[0],
    [workspaceSessions, activeWorkspaceSessionId, sessions]
  );

  const activeSession =
    currentSpace === 'workspace' ? activeWorkspaceSession : activeChatSession;

  const scopedSessions = useMemo(
    () =>
      appView === 'workspace'
        ? isAdmin
          ? workspaceSessions
          : []
        : chatSessions,
    [appView, isAdmin, workspaceSessions, chatSessions]
  );

  const [theme, setTheme] = useState<ThemeMode>(() => loadThemePreference());
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(true);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Separate drafts, attachments & modes per section so Chat Space and Workspace are completely isolated
  const [chatComposerValue, setChatComposerValue] = useState('');
  const [workspaceComposerValue, setWorkspaceComposerValue] = useState('');
  const [chatAttachments, setChatAttachments] = useState<AttachmentItem[]>([]);
  const [workspaceAttachments, setWorkspaceAttachments] = useState<AttachmentItem[]>([]);
  const [chatAttachmentError, setChatAttachmentError] = useState<string | null>(null);
  const [workspaceAttachmentError, setWorkspaceAttachmentError] = useState<string | null>(null);
  const [chatMode, setChatMode] = useState<ReasoningMode>(
    settings.defaultMode === 'coder' ? 'fast' : settings.defaultMode
  );
  const [workspaceMode, setWorkspaceMode] = useState<ReasoningMode>(
    settings.defaultMode === 'teacher' || settings.defaultMode === 'deep'
      ? settings.defaultMode
      : 'coder'
  );
  const [chatWebSearch, setChatWebSearch] = useState(settings.defaultWebSearch);
  const [workspaceWebSearch, setWorkspaceWebSearch] = useState(settings.defaultWebSearch);

  const composerValue =
    currentSpace === 'workspace' ? workspaceComposerValue : chatComposerValue;
  const setComposerValue = useCallback(
    (next: React.SetStateAction<string>) => {
      if (currentSpace === 'workspace') {
        setWorkspaceComposerValue(next);
      } else {
        setChatComposerValue(next);
      }
    },
    [currentSpace]
  );

  const attachments =
    currentSpace === 'workspace' ? workspaceAttachments : chatAttachments;
  const setAttachments = useCallback(
    (next: React.SetStateAction<AttachmentItem[]>) => {
      if (currentSpace === 'workspace') {
        setWorkspaceAttachments(next);
      } else {
        setChatAttachments(next);
      }
    },
    [currentSpace]
  );

  const attachmentError =
    currentSpace === 'workspace' ? workspaceAttachmentError : chatAttachmentError;
  const setAttachmentError = useCallback(
    (next: React.SetStateAction<string | null>) => {
      if (currentSpace === 'workspace') {
        setWorkspaceAttachmentError(next);
      } else {
        setChatAttachmentError(next);
      }
    },
    [currentSpace]
  );

  const mode = currentSpace === 'workspace' ? workspaceMode : chatMode;
  const setMode = useCallback(
    (next: React.SetStateAction<ReasoningMode>) => {
      if (currentSpace === 'workspace') {
        setWorkspaceMode(next);
      } else {
        setChatMode(next);
      }
    },
    [currentSpace]
  );

  const webSearch =
    currentSpace === 'workspace' ? workspaceWebSearch : chatWebSearch;
  const setWebSearch = useCallback(
    (next: React.SetStateAction<boolean>) => {
      if (currentSpace === 'workspace') {
        setWorkspaceWebSearch(next);
      } else {
        setChatWebSearch(next);
      }
    },
    [currentSpace]
  );

  const [isStreaming, setIsStreaming] = useState(false);
  const [isLiveOpen, setIsLiveOpen] = useState(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [isScreenModalOpen, setIsScreenModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [isQueueReading, setIsQueueReading] = useState(false);
  const [isQueuePaused, setIsQueuePaused] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [standbyFeedback, setStandbyFeedback] = useState<string | null>(null);
  const [showStandbyHelp, setShowStandbyHelp] = useState(false);
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);

  const [scheduledReminders, setScheduledReminders] = useState<StoredScheduledReminder[]>(
    () => loadScheduledReminders()
  );
  const [memories, setMemories] = useState<MemoryItem[]>(() => loadMemories());
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>('guest');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [supabaseSchemaSql, setSupabaseSchemaSql] = useState<string | null>(null);
  const [activeAlerts, setActiveAlerts] = useState<ActiveReminderAlert[]>([]);
  const [notifPermission, setNotifPermission] = useState<BrowserNotificationStatus>(() =>
    getBrowserNotificationPermission()
  );
  const [isRemindersPopoverOpen, setIsRemindersPopoverOpen] = useState(false);
  const [reminderClockNow, setReminderClockNow] = useState(() => Date.now());

  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const chatMessagesContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollEnabledRef = useRef(true);
  const dragDepthRef = useRef(0);
  const speechQueueStateRef = useRef<SpeechQueueState | null>(null);
  const speechCancelIntentRef = useRef<'none' | 'pause' | 'stop'>('none');
  const prevIsStreamingRef = useRef(false);
  const standbyFeedbackTimerRef = useRef<number | null>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const remindersMenuRef = useRef<HTMLDivElement>(null);
  const alertChimeStopRef = useRef<(() => void) | null>(null);
  const memoriesRef = useRef<MemoryItem[]>(memories);
  memoriesRef.current = memories;
  const hydratedUserIdRef = useRef<string | null>(null);
  const cloudHydratingRef = useRef<boolean>(false);
  const lastSyncedSignatureRef = useRef<string>('');
  const authSyncEpochRef = useRef(0);
  const liveTargetSessionRef = useRef<{ sessionId: string; space: ChatSpace } | null>(null);
  const sessionsRef = useRef<ChatSession[]>(sessions);
  sessionsRef.current = sessions;

  const workspaceArtifacts = useMemo(
    () => extractWorkspaceArtifacts(activeSession.messages),
    [activeSession.messages]
  );

  const activeCategory = useMemo(
    () =>
      activeSession.categoryId
        ? categories.find((c) => c.id === activeSession.categoryId) ?? null
        : null,
    [activeSession.categoryId, categories]
  );

  useEffect(() => {
    if (!isModeMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setIsModeMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsModeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isModeMenuOpen]);

  const sessionMediaCount = useMemo(() => {
    let count = 0;
    for (const msg of activeSession.messages) {
      if (!msg.widgets) continue;
      for (const w of msg.widgets) {
        if (w.kind === 'image' || w.kind === 'video') count += 1;
      }
    }
    return count;
  }, [activeSession.messages]);

  const hazelGesture = useMemo<AvatarGesture>(() => {
    const msgs = activeSession.messages;
    if (!msgs.length) return 'idle';
    const last = msgs[msgs.length - 1];
    if (last.role === 'user' && isStreaming) return 'thinking';
    if (last.role === 'assistant') {
      if (last.isStreaming && (last.isThinking || !last.text.trim())) {
        return 'thinking';
      }
      return inferAvatarGestureFromText(last.text);
    }
    return 'idle';
  }, [activeSession.messages, isStreaming]);

  // Sync theme to document root, native color-scheme, browser theme-color, & persist
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    root.style.colorScheme = theme;

    const themeColorMetas = document.querySelectorAll('meta[name="theme-color"]');
    themeColorMetas.forEach((meta) => {
      const media = meta.getAttribute('media');
      if (!media || meta.id === 'hazel-dynamic-theme-color') {
        meta.setAttribute('content', theme === 'dark' ? '#131314' : '#FFFFFF');
      }
    });
    const statusMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (statusMeta) {
      statusMeta.setAttribute('content', theme === 'dark' ? 'black-translucent' : 'default');
    }

    saveThemePreference(theme);
  }, [theme]);

  // Persist user preferences
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // Persist sessions & active session ID
  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    saveCategories(categories);
  }, [categories]);

  useEffect(() => {
    if (activeChatSessionId) {
      saveActiveSessionId(activeChatSessionId);
    }
  }, [activeChatSessionId]);

  useEffect(() => {
    if (activeWorkspaceSessionId) {
      saveActiveWorkspaceSessionId(activeWorkspaceSessionId);
    }
  }, [activeWorkspaceSessionId]);

  useEffect(() => {
    saveMemories(memories);
  }, [memories]);

  const lastAuthSyncAtRef = useRef<number>(0);

  const syncAuthSession = useCallback(async () => {
    const epoch = ++authSyncEpochRef.current;
    lastAuthSyncAtRef.current = Date.now();
    try {
      const res = await fetchAuthSession();
      if (epoch !== authSyncEpochRef.current) return;
      setAuthConfigured(res.configured);
      setAdminBootstrapAvailable(res.adminBootstrapAvailable);
      setAuthUser(res.user);
    } catch (err) {
      if (epoch !== authSyncEpochRef.current) return;
      if (isTransientAuthError(err)) {
        // Keep current session intact during network/wake-up/server-start hiccups
        return;
      }
      setAuthUser(null);
    } finally {
      if (epoch === authSyncEpochRef.current) {
        setAuthLoading(false);
      }
    }
  }, []);

  // Restore server-backed authentication session cleanly on mount and process Supabase redirect callbacks
  useEffect(() => {
    let active = true;

    const initAuth = async () => {
      if (typeof window !== 'undefined') {
        const rawHash = window.location.hash.startsWith('#')
          ? window.location.hash.slice(1)
          : '';
        const hashParams = new URLSearchParams(rawHash);
        const searchParams = new URLSearchParams(window.location.search);

        const cbAccessToken = hashParams.get('access_token') || '';
        const cbRefreshToken = hashParams.get('refresh_token') || '';
        const cbType = (hashParams.get('type') || searchParams.get('type') || '').toLowerCase();
        const cbCode = searchParams.get('code') || '';
        const cbErrorDesc =
          hashParams.get('error_description') ||
          searchParams.get('error_description') ||
          hashParams.get('error') ||
          searchParams.get('error') ||
          '';

        const hasAuthCallback = Boolean(
          cbAccessToken || cbRefreshToken || cbCode || cbErrorDesc
        );

        if (hasAuthCallback) {
          const nextUrl = new URL(window.location.href);
          nextUrl.searchParams.delete('code');
          nextUrl.searchParams.delete('type');
          nextUrl.searchParams.delete('error');
          nextUrl.searchParams.delete('error_description');
          nextUrl.hash = '';
          window.history.replaceState({}, document.title, nextUrl.pathname + nextUrl.search);

          if (cbErrorDesc) {
            await syncAuthSession();
            if (!active) return;
            setAuthModalMode('signin');
            setAuthContextNotice(cbErrorDesc);
            setIsAuthModalOpen(true);
            return;
          }

          if (cbCode || (cbAccessToken && cbRefreshToken)) {
            try {
              const user = await exchangeAuthCallback({
                ...(cbCode ? { code: cbCode } : {}),
                ...(cbAccessToken ? { accessToken: cbAccessToken } : {}),
                ...(cbRefreshToken ? { refreshToken: cbRefreshToken } : {}),
              });
              if (!active) return;
              setAuthUser(user);
              await syncAuthSession();
              if (!active) return;
              if (cbType === 'recovery') {
                setAuthModalMode('update_password');
                setAuthContextNotice(
                  'Recovery link verified. Set your new password below.'
                );
                setIsAuthModalOpen(true);
              }
              return;
            } catch (err) {
              await syncAuthSession();
              if (!active) return;
              setAuthModalMode('signin');
              setAuthContextNotice(
                err instanceof Error
                  ? err.message
                  : 'That verification link expired. Please sign in or request a new link.'
              );
              setIsAuthModalOpen(true);
              return;
            }
          }
        }
      }

      await syncAuthSession();
    };

    void initAuth();
    return () => {
      active = false;
    };
  }, [syncAuthSession]);

  // Keep session refreshed when returning to the app/tab, reconnecting, or every 20 minutes
  useEffect(() => {
    const refreshIfStale = (minIntervalMs = 60_000) => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastAuthSyncAtRef.current < minIntervalMs) return;
      void syncAuthSession();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshIfStale(60_000);
      }
    };
    const onPageShow = () => {
      refreshIfStale(30_000);
    };
    const onOnline = () => {
      refreshIfStale(15_000);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', onOnline);
    const keepAliveTimer = window.setInterval(() => {
      refreshIfStale(15 * 60 * 1000);
    }, 20 * 60 * 1000);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', onOnline);
      window.clearInterval(keepAliveTimer);
    };
  }, [syncAuthSession]);

  // Enforce Admin-only guard on Admin Panel and Pro Coder mode on client state
  useEffect(() => {
    if (!isAdmin && appView === 'admin') {
      setAppView('chat');
    }
    if (chatMode === 'coder') {
      setChatMode('fast');
    }
  }, [isAdmin, appView, chatMode]);

  // Hydrate full web app state from Supabase when authenticated, or migrate local guest state on first login
  useEffect(() => {
    if (authLoading) return;
    if (!authUser) {
      hydratedUserIdRef.current = null;
      cloudHydratingRef.current = false;
      lastSyncedSignatureRef.current = '';
      setSyncStatus('guest');
      setSupabaseSchemaSql(null);
      return;
    }

    if (hydratedUserIdRef.current === authUser.id) return;

    let cancelled = false;
    cloudHydratingRef.current = true;
    setSyncStatus('syncing');

    const hydrate = async () => {
      try {
        const res = await fetchCloudState();
        if (cancelled) return;

        setSupabaseSchemaSql(res.schemaSql ?? null);

        if (!res.hasCloudData) {
          const payload = {
            theme,
            settings,
            activeSessionId: activeChatSessionId,
            activeWorkspaceSessionId,
            categories,
            sessions,
            scheduledReminders,
            memories: memoriesRef.current,
          };
          const saveRes = await saveCloudState(payload);
          if (cancelled) return;
          lastSyncedSignatureRef.current = JSON.stringify({
            theme: payload.theme,
            settings: payload.settings,
            activeSessionId: payload.activeSessionId,
            activeWorkspaceSessionId: payload.activeWorkspaceSessionId,
            categories: payload.categories,
            sessions: payload.sessions,
            scheduledReminders: payload.scheduledReminders,
          });
          setSupabaseSchemaSql(saveRes.schemaSql ?? res.schemaSql ?? null);
          setSyncStatus(
            saveRes.schemaMissing
              ? 'schema_missing'
              : saveRes.backend === 'supabase'
                ? 'synced'
                : 'local'
          );
          setLastSyncedAt(saveRes.syncedAt);
        } else {
          const snap = res.snapshot;
          const nextTheme: ThemeMode =
            snap.theme === 'dark' || snap.theme === 'light' ? snap.theme : theme;
          const nextSettings = normalizeAppSettings(snap.settings);
          const nextCategories =
            snap.categories.length > 0 ? snap.categories : DEFAULT_CATEGORIES;
          const nextSessions = ensureBothSpaces(snap.sessions);
          const nextChatList = nextSessions.filter(
            (s) => inferSessionSpace(s) === 'chat'
          );
          const nextWorkspaceList = nextSessions.filter(
            (s) => inferSessionSpace(s) === 'workspace'
          );
          const nextActiveChatId =
            snap.activeSessionId &&
            nextChatList.some((s) => s.id === snap.activeSessionId)
              ? snap.activeSessionId
              : nextChatList[0].id;
          const nextActiveWorkspaceId =
            snap.activeWorkspaceSessionId &&
            nextWorkspaceList.some((s) => s.id === snap.activeWorkspaceSessionId)
              ? snap.activeWorkspaceSessionId
              : nextWorkspaceList[0].id;
          const nextReminders = snap.scheduledReminders;

          lastSyncedSignatureRef.current = JSON.stringify({
            theme: nextTheme,
            settings: nextSettings,
            activeSessionId: nextActiveChatId,
            activeWorkspaceSessionId: nextActiveWorkspaceId,
            categories: nextCategories,
            sessions: nextSessions,
            scheduledReminders: nextReminders,
          });

          setTheme(nextTheme);
          setSettings(nextSettings);
          setCategories(nextCategories);
          setSessions(nextSessions);
          setActiveChatSessionId(nextActiveChatId);
          setActiveWorkspaceSessionId(nextActiveWorkspaceId);
          setScheduledReminders(nextReminders);
          setMemories(snap.memories);
          setSyncStatus(
            res.schemaMissing
              ? 'schema_missing'
              : res.backend === 'supabase'
                ? 'synced'
                : 'local'
          );
          setLastSyncedAt(Date.now());
        }

        hydratedUserIdRef.current = authUser.id;
      } catch {
        if (!cancelled) {
          setSyncStatus('error');
        }
      } finally {
        if (!cancelled) {
          cloudHydratingRef.current = false;
        }
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
      cloudHydratingRef.current = false;
    };
    // Hydrate once per authenticated user session switch; reads current local defaults if cloud is empty
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, authUser?.id]);

  // Debounced auto-save of all web app state to Supabase while authenticated
  useEffect(() => {
    if (
      authLoading ||
      !authUser ||
      hydratedUserIdRef.current !== authUser.id ||
      cloudHydratingRef.current ||
      isStreaming
    ) {
      return;
    }

    const payload = {
      theme,
      settings,
      activeSessionId: activeChatSessionId,
      activeWorkspaceSessionId,
      categories,
      sessions,
      scheduledReminders,
    };
    const sig = JSON.stringify(payload);
    if (sig === lastSyncedSignatureRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          setSyncStatus((prev) => (prev === 'schema_missing' ? prev : 'syncing'));
          const res = await saveCloudState(payload);
          lastSyncedSignatureRef.current = sig;
          setSupabaseSchemaSql((prev) => res.schemaSql ?? prev);
          setSyncStatus(
            res.schemaMissing
              ? 'schema_missing'
              : res.backend === 'supabase'
                ? 'synced'
                : 'local'
          );
          setLastSyncedAt(res.syncedAt);
        } catch {
          setSyncStatus('error');
        }
      })();
    }, 900);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    authLoading,
    authUser,
    theme,
    settings,
    activeChatSessionId,
    activeWorkspaceSessionId,
    categories,
    sessions,
    scheduledReminders,
    isStreaming,
  ]);

  const handleOpenAuthModal = useCallback(
    (initialMode: AuthModalMode = 'signin', notice: string | null = null) => {
      setAuthModalMode(initialMode);
      setAuthContextNotice(notice);
      setIsAuthModalOpen(true);
    },
    []
  );

  const handleSignOut = useCallback(async () => {
    authSyncEpochRef.current += 1;
    abortControllerRef.current?.abort();
    setIsStreaming(false);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    try {
      await signOutSession();
    } catch {
      // Clear local session state even if network call fails
    } finally {
      hydratedUserIdRef.current = null;
      cloudHydratingRef.current = false;
      lastSyncedSignatureRef.current = '';
      const freshChat = createNewSession(null, 'chat');
      const freshWorkspace = createNewSession(null, 'workspace');
      setAuthUser(null);
      setSessions([freshChat, freshWorkspace]);
      setActiveChatSessionId(freshChat.id);
      setActiveWorkspaceSessionId(freshWorkspace.id);
      setChatComposerValue('');
      setWorkspaceComposerValue('');
      setChatAttachments([]);
      setWorkspaceAttachments([]);
      setCategories(DEFAULT_CATEGORIES);
      setScheduledReminders([]);
      setActiveAlerts([]);
      setMemories([]);
      setSyncStatus('guest');
      setLastSyncedAt(null);
      setSupabaseSchemaSql(null);
      setAppView((prev) => (prev === 'admin' ? 'chat' : prev));
      setChatMode('fast');
      void syncAuthSession();
    }
  }, [syncAuthSession]);

  // Clean up speech synthesis, reminder chimes & active requests on unmount
  useEffect(() => {
    const win = window as unknown as {
      __HAZEL_GLOBAL_REMINDER_MANAGER__?: boolean;
    };
    win.__HAZEL_GLOBAL_REMINDER_MANAGER__ = true;

    return () => {
      win.__HAZEL_GLOBAL_REMINDER_MANAGER__ = false;
      abortControllerRef.current?.abort();
      if (standbyFeedbackTimerRef.current !== null) {
        window.clearTimeout(standbyFeedbackTimerRef.current);
      }
      alertChimeStopRef.current?.();
      alertChimeStopRef.current = null;
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Persist scheduled reminders
  useEffect(() => {
    saveScheduledReminders(scheduledReminders);
  }, [scheduledReminders]);

  // Keep notification permission synced if user switches tabs or changes browser setting
  useEffect(() => {
    const syncPerm = () => {
      setNotifPermission(getBrowserNotificationPermission());
    };
    window.addEventListener('focus', syncPerm);
    document.addEventListener('visibilitychange', syncPerm);
    return () => {
      window.removeEventListener('focus', syncPerm);
      document.removeEventListener('visibilitychange', syncPerm);
    };
  }, []);

  // Play gentle alert chime loop while unacknowledged alerts are visible
  useEffect(() => {
    if (activeAlerts.length > 0) {
      if (!alertChimeStopRef.current) {
        alertChimeStopRef.current = playReminderChimeLoop();
      }
    } else if (alertChimeStopRef.current) {
      alertChimeStopRef.current();
      alertChimeStopRef.current = null;
    }
  }, [activeAlerts.length]);

  // Close upcoming reminders popover on outside click / Escape and live-tick countdowns
  useEffect(() => {
    if (!isRemindersPopoverOpen) return;
    setReminderClockNow(Date.now());
    const tick = window.setInterval(() => setReminderClockNow(Date.now()), 1000);
    const onPointerDown = (e: MouseEvent) => {
      if (
        remindersMenuRef.current &&
        !remindersMenuRef.current.contains(e.target as Node)
      ) {
        setIsRemindersPopoverOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsRemindersPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isRemindersPopoverOpen]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // Auto-scroll during streaming if user hasn't scrolled up
  useEffect(() => {
    if (autoScrollEnabledRef.current) {
      scrollToBottom(isStreaming ? 'auto' : 'smooth');
    }
  }, [activeSession.messages, isStreaming, scrollToBottom]);

  // Keep viewport anchored to bottom while the typing-effect RAF reveals text
  useEffect(() => {
    const contentEl = chatMessagesContainerRef.current;
    const viewportEl = scrollContainerRef.current;
    if (!contentEl || !viewportEl || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (autoScrollEnabledRef.current) {
        viewportEl.scrollTop = viewportEl.scrollHeight;
      }
    });
    observer.observe(contentEl);
    return () => observer.disconnect();
  }, [activeSession.id, activeSession.messages.length, appView, showWelcomePage]);

  const handleViewportScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < 120;
    autoScrollEnabledRef.current = nearBottom;
    setShowScrollBottom(!nearBottom && activeSession.messages.length > 0);
  };

  const stopSpeech = useCallback(() => {
    speechCancelIntentRef.current = 'stop';
    speechQueueStateRef.current = null;
    setIsQueueReading(false);
    setIsQueuePaused(false);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setSpeakingMessageId(null);
  }, []);

  const applySpeechSettings = useCallback(
    (utterance: SpeechSynthesisUtterance) => {
      utterance.rate = settings.speechRate;
      utterance.pitch = settings.speechPitch;
      if (settings.speechVoiceURI && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const voices = window.speechSynthesis.getVoices();
        const matched = voices.find((v) => v.voiceURI === settings.speechVoiceURI);
        if (matched) utterance.voice = matched;
      }
    },
    [settings.speechPitch, settings.speechRate, settings.speechVoiceURI]
  );

  const speakQueueCurrent = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const state = speechQueueStateRef.current;
    if (!state || state.pausedForIncoming) return;

    if (state.currentIndex >= state.queue.length) {
      speechQueueStateRef.current = null;
      setIsQueueReading(false);
      setIsQueuePaused(false);
      setSpeakingMessageId(null);
      return;
    }

    const current = state.queue[state.currentIndex];
    const prefix = current.role === 'user' ? 'You said: ' : 'Hazel: ';
    const fullText = `${prefix}${current.spoken}`;

    let startIdx =
      state.charOffset > 0 && state.charOffset < fullText.length
        ? state.charOffset
        : 0;
    while (startIdx > 0 && startIdx < fullText.length && !/\s/.test(fullText[startIdx - 1])) {
      startIdx -= 1;
    }
    const textToSpeak = fullText.slice(startIdx).trimStart();
    if (!textToSpeak) {
      state.currentIndex += 1;
      state.charOffset = 0;
      speakQueueCurrent();
      return;
    }
    const baseOffset = fullText.length - textToSpeak.length;

    speechCancelIntentRef.current = 'none';
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    applySpeechSettings(utterance);

    utterance.onboundary = (event) => {
      if (
        speechQueueStateRef.current === state &&
        !state.pausedForIncoming &&
        typeof event.charIndex === 'number'
      ) {
        state.charOffset = baseOffset + event.charIndex;
      }
    };

    utterance.onend = () => {
      if (
        speechCancelIntentRef.current !== 'none' ||
        speechQueueStateRef.current !== state ||
        state.pausedForIncoming
      ) {
        return;
      }
      state.currentIndex += 1;
      state.charOffset = 0;
      speakQueueCurrent();
    };

    utterance.onerror = () => {
      if (
        speechCancelIntentRef.current !== 'none' ||
        speechQueueStateRef.current !== state ||
        state.pausedForIncoming
      ) {
        return;
      }
      speechQueueStateRef.current = null;
      setIsQueueReading(false);
      setIsQueuePaused(false);
      setSpeakingMessageId(null);
    };

    setSpeakingMessageId(current.id);
    window.speechSynthesis.speak(utterance);
  }, [applySpeechSettings]);

  const pauseSpeechQueueForIncoming = useCallback(
    (targetSessionId: string) => {
      const state = speechQueueStateRef.current;
      if (state && state.sessionId === targetSessionId) {
        if (!state.pausedForIncoming) {
          state.pausedForIncoming = true;
          speechCancelIntentRef.current = 'pause';
          if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
          }
          setIsQueuePaused(true);
          setSpeakingMessageId(null);
        }
        return;
      }
      stopSpeech();
    },
    [stopSpeech]
  );

  // Automatically pause Read Aloud queue while incoming stream is active, and resume once finished
  useEffect(() => {
    const wasStreaming = prevIsStreamingRef.current;
    prevIsStreamingRef.current = isStreaming;

    const state = speechQueueStateRef.current;
    if (!state || state.sessionId !== activeSession.id) return;

    if (isStreaming) {
      if (!state.pausedForIncoming) {
        pauseSpeechQueueForIncoming(activeSession.id);
      }
      return;
    }

    if (wasStreaming && !isStreaming && state.pausedForIncoming) {
      const speakable: SpeechQueueEntry[] = activeSession.messages
        .map((m) => ({
          id: m.id,
          role: m.role,
          spoken: stripMarkdownForSpeech(m.text),
        }))
        .filter((item) => item.spoken.length > 0);

      if (speakable.length === 0) {
        stopSpeech();
        return;
      }

      const currentMsgId = state.queue[state.currentIndex]?.id;
      const matchedIdx = currentMsgId
        ? speakable.findIndex((item) => item.id === currentMsgId)
        : -1;

      if (matchedIdx !== -1) {
        state.queue = speakable;
        state.currentIndex = matchedIdx;
      } else {
        const alreadyReadIds = new Set(
          state.queue.slice(0, state.currentIndex).map((q) => q.id)
        );
        const nextUnreadIdx = speakable.findIndex(
          (item) => !alreadyReadIds.has(item.id)
        );
        if (nextUnreadIdx === -1) {
          stopSpeech();
          return;
        }
        state.queue = speakable;
        state.currentIndex = nextUnreadIdx;
        state.charOffset = 0;
      }

      state.pausedForIncoming = false;
      setIsQueuePaused(false);
      speakQueueCurrent();
    }
  }, [
    activeSession.id,
    activeSession.messages,
    isStreaming,
    pauseSpeechQueueForIncoming,
    speakQueueCurrent,
    stopSpeech,
  ]);

  const handleToggleSpeak = useCallback(
    (msg: ChatMessage) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      if (speakingMessageId === msg.id && !speechQueueStateRef.current) {
        stopSpeech();
        return;
      }
      stopSpeech();
      const plain = stripMarkdownForSpeech(msg.text);
      if (!plain) return;
      speechCancelIntentRef.current = 'none';
      const utterance = new SpeechSynthesisUtterance(plain);
      applySpeechSettings(utterance);
      utterance.onend = () => setSpeakingMessageId(null);
      utterance.onerror = () => setSpeakingMessageId(null);
      setSpeakingMessageId(msg.id);
      window.speechSynthesis.speak(utterance);
    },
    [applySpeechSettings, speakingMessageId, stopSpeech]
  );

  const handleToggleReadAloudQueue = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (isQueueReading) {
      stopSpeech();
      return;
    }

    const speakable: SpeechQueueEntry[] = activeSession.messages
      .map((m) => ({
        id: m.id,
        role: m.role,
        spoken: stripMarkdownForSpeech(m.text),
      }))
      .filter((item) => item.spoken.length > 0);

    if (speakable.length === 0) return;

    stopSpeech();
    speechQueueStateRef.current = {
      sessionId: activeSession.id,
      queue: speakable,
      currentIndex: 0,
      charOffset: 0,
      pausedForIncoming: isStreaming,
    };
    setIsQueueReading(true);
    setIsQueuePaused(isStreaming);
    if (!isStreaming) {
      speakQueueCurrent();
    }
  }, [
    activeSession.id,
    activeSession.messages,
    isQueueReading,
    isStreaming,
    speakQueueCurrent,
    stopSpeech,
  ]);

  const handleAddFiles = useCallback(async (fileList: FileList | File[]) => {
    setAttachmentError(null);
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;

    const added: AttachmentItem[] = [];
    for (const file of incoming) {
      try {
        const parsed = await readFileAsAttachment(file);
        added.push(parsed);
      } catch (err) {
        setAttachmentError(
          err instanceof Error ? err.message : 'Could not attach one of the files.'
        );
      }
    }

    if (added.length > 0) {
      setAttachments((prev) => {
        const combined = [...prev, ...added];
        if (combined.length > 5) {
          setAttachmentError('Up to 5 attachments are allowed per message.');
          return combined.slice(0, 5);
        }
        return combined;
      });
    }
  }, []);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const isLiveOpenRef = useRef(isLiveOpen);
  isLiveOpenRef.current = isLiveOpen;
  const applySpeechSettingsRef = useRef(applySpeechSettings);
  applySpeechSettingsRef.current = applySpeechSettings;

  const dismissAlert = useCallback((id: string) => {
    setActiveAlerts((prev) => prev.filter((a) => a.id !== id));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('hazel:alert-dismissed', { detail: { id } })
      );
    }
  }, []);

  const dismissAllAlerts = useCallback(() => {
    setActiveAlerts([]);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('hazel:alert-dismissed', { detail: {} })
      );
    }
  }, []);

  const handleEnableBrowserNotifications = useCallback(() => {
    void requestBrowserNotificationPermission().then((status) => {
      setNotifPermission(status);
    });
  }, []);

  const registerScheduledReminder = useCallback(
    (timer: TimerWidgetData, sessionId?: string) => {
      const targetTime =
        typeof timer.targetTime === 'number'
          ? timer.targetTime
          : timer.createdAt + timer.durationSeconds * 1000;

      const normalized: StoredScheduledReminder = {
        ...timer,
        targetTime,
        sessionId,
      };

      setScheduledReminders((prev) => {
        const idx = prev.findIndex((r) => r.id === normalized.id);
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], ...normalized };
          return updated;
        }
        return [normalized, ...prev];
      });

      if (
        settingsRef.current.browserNotificationsEnabled &&
        getBrowserNotificationPermission() === 'default'
      ) {
        void requestBrowserNotificationPermission().then((status) => {
          setNotifPermission(status);
        });
      }
    },
    []
  );

  const triggerReminderAlert = useCallback(
    (reminder: StoredScheduledReminder) => {
      const alert: ActiveReminderAlert = {
        id: reminder.id,
        sessionId: reminder.sessionId,
        label: reminder.label,
        note: reminder.reminderNote,
        isReminder: Boolean(reminder.isReminder),
        triggeredAt: Date.now(),
        targetTime:
          reminder.targetTime ??
          reminder.createdAt + reminder.durationSeconds * 1000,
        durationSeconds: reminder.durationSeconds,
      };

      setActiveAlerts((prev) =>
        prev.some((a) => a.id === alert.id) ? prev : [alert, ...prev]
      );

      if (settingsRef.current.browserNotificationsEnabled) {
        dispatchBrowserReminderNotification(alert, () => {
          if (alert.sessionId) {
            setShowWelcomePage(false);
            const matched = sessionsRef.current.find((s) => s.id === alert.sessionId);
            if (matched && inferSessionSpace(matched) === 'workspace') {
              setActiveWorkspaceSessionId(matched.id);
              setAppView('workspace');
            } else {
              setActiveChatSessionId(alert.sessionId);
              setAppView('chat');
            }
          }
          dismissAlert(alert.id);
        });
      }

      if (
        settingsRef.current.speakReminderAlerts &&
        !isLiveOpenRef.current &&
        typeof window !== 'undefined' &&
        'speechSynthesis' in window &&
        !speechQueueStateRef.current
      ) {
        const spokenPrefix = alert.isReminder ? 'Reminder' : 'Timer complete';
        const utterance = new SpeechSynthesisUtterance(
          `${spokenPrefix}: ${alert.label}`
        );
        applySpeechSettingsRef.current(utterance);
        utterance.onend = () => setSpeakingMessageId(null);
        utterance.onerror = () => setSpeakingMessageId(null);
        setSpeakingMessageId(`alert-${alert.id}`);
        window.speechSynthesis.speak(utterance);
      }
    },
    [dismissAlert]
  );

  const handleSnoozeAlert = useCallback(
    (alert: ActiveReminderAlert, minutes: number) => {
      const nextDurationSeconds = Math.max(10, Math.round(minutes * 60));
      const now = Date.now();
      const nextTargetTime = now + nextDurationSeconds * 1000;

      setActiveAlerts((prev) => prev.filter((a) => a.id !== alert.id));

      registerScheduledReminder(
        {
          kind: 'timer',
          id: alert.id,
          label: alert.label,
          durationSeconds: nextDurationSeconds,
          createdAt: now,
          targetTime: nextTargetTime,
          isReminder: true,
          reminderNote: alert.note,
        },
        alert.sessionId
      );

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('hazel:alert-snoozed', {
            detail: {
              id: alert.id,
              nextTargetTime,
              nextDurationSeconds,
            },
          })
        );
      }
    },
    [registerScheduledReminder]
  );

  const handleCancelScheduledReminder = useCallback((id: string) => {
    setScheduledReminders((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const handleTestReminderAlert = useCallback(() => {
    const now = Date.now();
    const runDemo = () => {
      triggerReminderAlert({
        kind: 'timer',
        id: generateId('test_rem'),
        sessionId: activeSession.id,
        label: 'Test Reminder Alert',
        reminderNote:
          'On-screen alert & browser notification preview from Hazel Settings.',
        durationSeconds: 5,
        createdAt: now - 5000,
        targetTime: now,
        isReminder: true,
      });
    };

    if (
      settingsRef.current.browserNotificationsEnabled &&
      getBrowserNotificationPermission() === 'default'
    ) {
      void requestBrowserNotificationPermission().then((status) => {
        setNotifPermission(status);
        runDemo();
      });
      return;
    }

    runDemo();
  }, [activeSession.id, triggerReminderAlert]);

  // Global reminder & timer expiration check loop (persists across all views & chats)
  useEffect(() => {
    if (scheduledReminders.length === 0) return;

    const checkExpired = () => {
      const now = Date.now();
      const expired = scheduledReminders.filter((r) => {
        const target = r.targetTime ?? r.createdAt + r.durationSeconds * 1000;
        return now >= target;
      });
      if (expired.length === 0) return;

      const expiredIds = new Set(expired.map((r) => r.id));
      setScheduledReminders((prev) => prev.filter((r) => !expiredIds.has(r.id)));
      expired.forEach((item) => triggerReminderAlert(item));
    };

    checkExpired();
    const interval = window.setInterval(checkExpired, 500);
    return () => window.clearInterval(interval);
  }, [scheduledReminders, triggerReminderAlert]);

  // Keep global scheduler synced when user pauses, resumes, resets, or stops a TimerWidget
  useEffect(() => {
    const onTimerControl = (evt: Event) => {
      const custom = evt as CustomEvent<HazelTimerControlDetail>;
      const detail = custom.detail;
      if (!detail?.timer) return;

      const { action, timer, nextTargetTime, nextDurationSeconds } = detail;

      if (action === 'pause' || action === 'reset') {
        setScheduledReminders((prev) => prev.filter((r) => r.id !== timer.id));
        return;
      }

      if (action === 'stop_alarm') {
        dismissAlert(timer.id);
        return;
      }

      if ((action === 'resume' || action === 'add_minute') && nextTargetTime) {
        registerScheduledReminder(
          {
            ...timer,
            durationSeconds: nextDurationSeconds ?? timer.durationSeconds,
            targetTime: nextTargetTime,
          },
          activeSession.id
        );
        return;
      }

      if (action === 'expired') {
        setScheduledReminders((prev) => {
          const matched = prev.find((r) => r.id === timer.id);
          if (matched) {
            queueMicrotask(() => triggerReminderAlert(matched));
            return prev.filter((r) => r.id !== timer.id);
          }
          return prev;
        });
      }
    };

    window.addEventListener('hazel:timer-control', onTimerControl);
    return () => window.removeEventListener('hazel:timer-control', onTimerControl);
  }, [
    activeSession.id,
    dismissAlert,
    registerScheduledReminder,
    triggerReminderAlert,
  ]);

  const applyMemoryEvent = useCallback(
    (evt: MemoryStreamEvent | LiveMemoryEvent) => {
      if (evt.action === 'saved' && evt.memory) {
        const incoming = evt.memory;
        setMemories((prev) => [incoming, ...prev.filter((m) => m.id !== incoming.id)].slice(0, 120));
      } else if (evt.action === 'forgotten' && Array.isArray(evt.removedIds) && evt.removedIds.length > 0) {
        const removedSet = new Set(evt.removedIds);
        setMemories((prev) => prev.filter((m) => !removedSet.has(m.id)));
      }

      if ('backend' in evt && evt.backend && evt.backend !== 'guest') {
        setSyncStatus(
          evt.schemaMissing
            ? 'schema_missing'
            : evt.backend === 'supabase'
              ? 'synced'
              : 'local'
        );
        setLastSyncedAt(Date.now());
      }
    },
    []
  );

  const handleAddMemory = useCallback(
    async (content: string, category: MemoryCategory) => {
      const trimmed = content.trim().slice(0, 500);
      if (!trimmed) return;
      if (authUser) {
        const res = await createCloudMemory({
          content: trimmed,
          category,
          source: 'user',
        });
        setMemories((prev) => [
          res.memory,
          ...prev.filter((m) => m.id !== res.memory.id),
        ].slice(0, 120));
        setSupabaseSchemaSql((prev) => res.schemaSql ?? prev);
        setSyncStatus(
          res.schemaMissing
            ? 'schema_missing'
            : res.backend === 'supabase'
              ? 'synced'
              : 'local'
        );
        setLastSyncedAt(Date.now());
        return;
      }

      const now = Date.now();
      const guestMem: MemoryItem = {
        id: generateId('mem'),
        content: trimmed,
        category,
        source: 'user',
        createdAt: now,
        updatedAt: now,
      };
      setMemories((prev) => [guestMem, ...prev].slice(0, 120));
    },
    [authUser]
  );

  const handleDeleteMemory = useCallback(
    async (id: string) => {
      setMemories((prev) => prev.filter((m) => m.id !== id));
      if (!authUser) return;
      try {
        const res = await deleteCloudMemory(id);
        setSyncStatus(
          res.schemaMissing
            ? 'schema_missing'
            : res.backend === 'supabase'
              ? 'synced'
              : 'local'
        );
        setLastSyncedAt(Date.now());
      } catch {
        setSyncStatus('error');
      }
    },
    [authUser]
  );

  const handleClearAllMemories = useCallback(async () => {
    setMemories([]);
    if (!authUser) return;
    try {
      const res = await clearCloudMemories();
      setSyncStatus(
        res.schemaMissing
          ? 'schema_missing'
          : res.backend === 'supabase'
            ? 'synced'
            : 'local'
      );
      setLastSyncedAt(Date.now());
    } catch {
      setSyncStatus('error');
    }
  }, [authUser]);

  const handleSyncNow = useCallback(async () => {
    if (!authUser) return;
    setSyncStatus('syncing');
    try {
      const payload = {
        theme,
        settings,
        activeSessionId: activeChatSessionId,
        activeWorkspaceSessionId,
        categories,
        sessions,
        scheduledReminders,
        memories: memoriesRef.current,
      };
      const res = await saveCloudState(payload);
      lastSyncedSignatureRef.current = JSON.stringify({
        theme: payload.theme,
        settings: payload.settings,
        activeSessionId: payload.activeSessionId,
        activeWorkspaceSessionId: payload.activeWorkspaceSessionId,
        categories: payload.categories,
        sessions: payload.sessions,
        scheduledReminders: payload.scheduledReminders,
      });
      setSupabaseSchemaSql((prev) => res.schemaSql ?? prev);
      setSyncStatus(
        res.schemaMissing
          ? 'schema_missing'
          : res.backend === 'supabase'
            ? 'synced'
            : 'local'
      );
      setLastSyncedAt(res.syncedAt);
    } catch {
      setSyncStatus('error');
    }
  }, [
    authUser,
    theme,
    settings,
    activeChatSessionId,
    activeWorkspaceSessionId,
    categories,
    sessions,
    scheduledReminders,
  ]);

  const runStreamForMessages = useCallback(
    async (
      sessionId: string,
      historyBeforeAssistant: ChatMessage[],
      assistantMessageId: string,
      runMode: ReasoningMode,
      runWebSearch: boolean,
      skipTimerTool = false,
      runView: AppView = 'chat'
    ) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsStreaming(true);
      autoScrollEnabledRef.current = true;

      const updateAssistant = (
        updater: (msg: ChatMessage) => ChatMessage
      ) => {
        setSessions((prev) =>
          prev.map((s) =>
            s.id !== sessionId
              ? s
              : {
                  ...s,
                  updatedAt: Date.now(),
                  messages: s.messages.map((m) =>
                    m.id === assistantMessageId ? updater(m) : m
                  ),
                }
          )
        );
      };

      try {
        await streamChatResponse({
          messages: historyBeforeAssistant,
          mode: runMode,
          webSearch: runWebSearch,
          view: runView,
          skipTimerTool,
          memories: !authUser ? memoriesRef.current : undefined,
          signal: controller.signal,
          onThoughtDelta: (delta) => {
            updateAssistant((m) => ({
              ...m,
              isThinking: true,
              thoughts: (m.thoughts ?? '') + delta,
            }));
          },
          onTextDelta: (delta) => {
            updateAssistant((m) => ({
              ...m,
              isThinking: false,
              text: m.text + delta,
            }));
          },
          onWidget: (widget: ChatWidget) => {
            if (widget.kind === 'timer') {
              registerScheduledReminder(widget, sessionId);
            }
            updateAssistant((m) => {
              const existing = m.widgets ?? [];
              if (existing.some((w) => w.id === widget.id)) return m;
              return {
                ...m,
                isThinking: false,
                widgets: [...existing, widget],
              };
            });
          },
          onMemoryEvent: applyMemoryEvent,
          onSources: (sources) => {
            updateAssistant((m) => ({
              ...m,
              sources,
            }));
          },
        });

        updateAssistant((m) => ({
          ...m,
          isStreaming: false,
          isThinking: false,
        }));
      } catch (err) {
        if (controller.signal.aborted) {
          updateAssistant((m) => ({
            ...m,
            isStreaming: false,
            isThinking: false,
          }));
          return;
        }
        const message =
          err instanceof Error
            ? err.message
            : 'Unable to complete response. Please try again.';
        if (err instanceof ChatStreamHttpError && err.code === 'AUTH_REQUIRED') {
          handleOpenAuthModal('signin', message);
        }
        updateAssistant((m) => ({
          ...m,
          isStreaming: false,
          isThinking: false,
          error: message,
        }));
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        setIsStreaming(false);
      }
    },
    [applyMemoryEvent, authUser, handleOpenAuthModal, registerScheduledReminder]
  );

  const sendPrompt = useCallback(
    async (
      rawText: string,
      stagedAttachments: AttachmentItem[],
      options?: {
        mode?: ReasoningMode;
        webSearch?: boolean;
        targetSession?: ChatSession;
        view?: AppView;
      }
    ) => {
      const trimmed = rawText.trim();
      if (!trimmed && stagedAttachments.length === 0) return;
      if (isStreaming && !options?.targetSession) return;

      const rawView: AppView = options?.view ?? appView;
      const targetView: AppView =
        rawView === 'workspace' && isAdmin ? 'workspace' : 'chat';
      const targetSpace: ChatSpace =
        targetView === 'workspace' ? 'workspace' : 'chat';

      const sessionToUse =
        options?.targetSession ??
        (targetSpace === 'workspace' ? activeWorkspaceSession : activeChatSession);
      pauseSpeechQueueForIncoming(sessionToUse.id);

      const currentSpaceMode = targetSpace === 'workspace' ? workspaceMode : chatMode;
      const currentSpaceSearch =
        targetSpace === 'workspace' ? workspaceWebSearch : chatWebSearch;
      const rawTargetMode: ReasoningMode = options?.mode ?? currentSpaceMode;
      const targetMode: ReasoningMode =
        (targetView !== 'workspace' || !isAdmin) && rawTargetMode === 'coder'
          ? 'fast'
          : rawTargetMode;
      const targetSearch =
        typeof options?.webSearch === 'boolean'
          ? options.webSearch
          : currentSpaceSearch;

      if (options?.mode || targetMode !== rawTargetMode) {
        if (targetSpace === 'workspace') {
          setWorkspaceMode(targetMode);
        } else {
          setChatMode(targetMode);
        }
      }
      if (typeof options?.webSearch === 'boolean') {
        if (targetSpace === 'workspace') {
          setWorkspaceWebSearch(options.webSearch);
        } else {
          setChatWebSearch(options.webSearch);
        }
      }

      const parsedTimer = trimmed ? parseNaturalTimerCommand(trimmed) : null;
      const nowMs = Date.now();
      const timerWidget: TimerWidgetData | null = parsedTimer
        ? {
            kind: 'timer',
            id: generateId('tmr'),
            label: parsedTimer.label,
            durationSeconds: parsedTimer.durationSeconds,
            createdAt: nowMs,
            targetTime: parsedTimer.targetTime,
            isReminder: parsedTimer.isReminder,
            reminderNote: parsedTimer.reminderNote,
          }
        : null;
      if (timerWidget) {
        registerScheduledReminder(timerWidget, sessionToUse.id);
      }
      const initialWidgets: ChatWidget[] = timerWidget ? [timerWidget] : [];

      const userMsg: ChatMessage = {
        id: generateId('usr'),
        role: 'user',
        text: trimmed,
        attachments: stagedAttachments.length > 0 ? stagedAttachments : undefined,
        createdAt: Date.now(),
      };

      const assistantMsg: ChatMessage = {
        id: generateId('ast'),
        role: 'assistant',
        text: '',
        thoughts: '',
        widgets: initialWidgets.length > 0 ? initialWidgets : undefined,
        createdAt: Date.now(),
        mode: targetMode,
        webSearch: targetSearch,
        isStreaming: true,
        isThinking: false,
      };

      const targetSessionId = sessionToUse.id;
      const nextHistory = [...sessionToUse.messages, userMsg];
      const shouldAutoTitle =
        sessionToUse.messages.length === 0 &&
        (sessionToUse.title === 'New chat' || sessionToUse.title === 'New workspace');

      setSessions((prev) =>
        prev.map((s) =>
          s.id !== targetSessionId
            ? s
            : {
                ...s,
                title: shouldAutoTitle
                  ? deriveSessionTitle(
                      trimmed ||
                        stagedAttachments[0]?.name ||
                        (targetSpace === 'workspace' ? 'New workspace' : 'New chat')
                    )
                  : s.title,
                updatedAt: Date.now(),
                messages: [...nextHistory, assistantMsg],
              }
        )
      );

      if (targetSpace === 'workspace') {
        setWorkspaceComposerValue('');
        setWorkspaceAttachments([]);
        setWorkspaceAttachmentError(null);
      } else {
        setChatComposerValue('');
        setChatAttachments([]);
        setChatAttachmentError(null);
      }

      await runStreamForMessages(
        targetSessionId,
        nextHistory,
        assistantMsg.id,
        targetMode,
        targetSearch,
        Boolean(parsedTimer),
        targetView
      );
    },
    [
      activeChatSession,
      activeWorkspaceSession,
      appView,
      chatMode,
      chatWebSearch,
      isAdmin,
      isStreaming,
      pauseSpeechQueueForIncoming,
      registerScheduledReminder,
      runStreamForMessages,
      workspaceMode,
      workspaceWebSearch,
    ]
  );

  const handleStopStreaming = () => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  };

  const handleNewChat = useCallback(
    (
      categoryId: string | null = null,
      opts?: { preserveModeAndSearch?: boolean; space?: ChatSpace }
    ): ChatSession => {
      if (isStreaming) {
        abortControllerRef.current?.abort();
        setIsStreaming(false);
      }
      stopSpeech();
      const targetSpace: ChatSpace =
        opts?.space ?? (appView === 'workspace' && isAdmin ? 'workspace' : 'chat');
      const currentInSpace =
        targetSpace === 'workspace' ? activeWorkspaceSession : activeChatSession;
      const nextDefaultMode: ReasoningMode =
        targetSpace === 'workspace'
          ? settings.defaultMode === 'teacher' || settings.defaultMode === 'deep'
            ? settings.defaultMode
            : 'coder'
          : settings.defaultMode === 'coder'
            ? 'fast'
            : settings.defaultMode;
      const resolvedCategoryId = targetSpace === 'workspace' ? categoryId : null;

      // If current session in this zone is already blank and matches the requested category, focus it
      if (
        currentInSpace.messages.length === 0 &&
        (currentInSpace.categoryId ?? null) === (resolvedCategoryId ?? null)
      ) {
        if (!opts?.preserveModeAndSearch) {
          if (targetSpace === 'workspace') {
            setWorkspaceMode(nextDefaultMode);
            setWorkspaceWebSearch(settings.defaultWebSearch);
          } else {
            setChatMode(nextDefaultMode);
            setChatWebSearch(settings.defaultWebSearch);
          }
        }
        return currentInSpace;
      }

      const fresh = createNewSession(resolvedCategoryId, targetSpace);
      setSessions((prev) => [fresh, ...prev]);
      if (targetSpace === 'workspace') {
        setActiveWorkspaceSessionId(fresh.id);
        setWorkspaceComposerValue('');
        setWorkspaceAttachments([]);
        setWorkspaceAttachmentError(null);
        if (!opts?.preserveModeAndSearch) {
          setWorkspaceMode(nextDefaultMode);
          setWorkspaceWebSearch(settings.defaultWebSearch);
        }
      } else {
        setActiveChatSessionId(fresh.id);
        setChatComposerValue('');
        setChatAttachments([]);
        setChatAttachmentError(null);
        if (!opts?.preserveModeAndSearch) {
          setChatMode(nextDefaultMode);
          setChatWebSearch(settings.defaultWebSearch);
        }
      }
      return fresh;
    },
    [
      activeChatSession,
      activeWorkspaceSession,
      appView,
      isAdmin,
      isStreaming,
      settings.defaultMode,
      settings.defaultWebSearch,
      stopSpeech,
    ]
  );

  const handleClearAllChats = useCallback(() => {
    if (isStreaming) {
      abortControllerRef.current?.abort();
      setIsStreaming(false);
    }
    stopSpeech();
    const freshChat = createNewSession(null, 'chat');
    const freshWorkspace = createNewSession(null, 'workspace');
    setSessions([freshChat, freshWorkspace]);
    setActiveChatSessionId(freshChat.id);
    setActiveWorkspaceSessionId(freshWorkspace.id);
    setChatComposerValue('');
    setWorkspaceComposerValue('');
    setChatAttachments([]);
    setWorkspaceAttachments([]);
    setChatAttachmentError(null);
    setWorkspaceAttachmentError(null);
    setChatMode(settings.defaultMode === 'coder' ? 'fast' : settings.defaultMode);
    setWorkspaceMode(
      settings.defaultMode === 'teacher' || settings.defaultMode === 'deep'
        ? settings.defaultMode
        : 'coder'
    );
    setChatWebSearch(settings.defaultWebSearch);
    setWorkspaceWebSearch(settings.defaultWebSearch);
  }, [isStreaming, stopSpeech, settings.defaultMode, settings.defaultWebSearch]);

  const handleSelectSession = useCallback(
    (id: string) => {
      const target = sessionsRef.current.find((s) => s.id === id);
      const targetSpace: ChatSpace = target
        ? inferSessionSpace(target)
        : currentSpace;

      if (targetSpace === 'workspace' && !isAdmin) {
        setAppView('workspace');
        return;
      }

      const currentActiveForTarget =
        targetSpace === 'workspace'
          ? activeWorkspaceSessionId
          : activeChatSessionId;

      if (id !== currentActiveForTarget) {
        if (isStreaming) {
          abortControllerRef.current?.abort();
          setIsStreaming(false);
        }
        stopSpeech();
      }

      if (targetSpace === 'workspace') {
        setActiveWorkspaceSessionId(id);
        setAppView('workspace');
      } else {
        setActiveChatSessionId(id);
        if (appView === 'workspace' || appView === 'admin') {
          setAppView('chat');
        }
      }
      autoScrollEnabledRef.current = true;
    },
    [
      activeChatSessionId,
      activeWorkspaceSessionId,
      appView,
      currentSpace,
      isAdmin,
      isStreaming,
      stopSpeech,
    ]
  );

  const handleDeleteSession = (id: string) => {
    if (id === activeSession.id && isStreaming) {
      handleStopStreaming();
    }
    stopSpeech();
    setSessions((prev) => {
      const target = prev.find((s) => s.id === id);
      const targetSpace: ChatSpace = target
        ? inferSessionSpace(target)
        : currentSpace;
      const remaining = prev.filter((s) => s.id !== id);
      const remainingInSpace = remaining.filter(
        (s) => inferSessionSpace(s) === targetSpace
      );

      if (remainingInSpace.length === 0) {
        const fresh = createNewSession(null, targetSpace);
        if (targetSpace === 'workspace') {
          setActiveWorkspaceSessionId(fresh.id);
        } else {
          setActiveChatSessionId(fresh.id);
        }
        return [fresh, ...remaining];
      }

      if (
        targetSpace === 'workspace' &&
        id === activeWorkspaceSessionId
      ) {
        setActiveWorkspaceSessionId(remainingInSpace[0].id);
      } else if (targetSpace === 'chat' && id === activeChatSessionId) {
        setActiveChatSessionId(remainingInSpace[0].id);
      }
      return remaining;
    });
  };

  const handleRenameSession = (id: string, title: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, title, updatedAt: Date.now() } : s))
    );
  };

  const handleTogglePinSession = (id: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, pinned: !s.pinned } : s))
    );
  };

  const handleAssignCategory = (sessionId: string, categoryId: string | null) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, categoryId } : s))
    );
  };

  const handleCreateCategory = (
    name: string,
    color: CategoryColor
  ): ChatCategory => {
    const newCat: ChatCategory = {
      id: generateId('cat'),
      name: name.trim().slice(0, 32),
      color,
    };
    setCategories((prev) => [...prev, newCat]);
    return newCat;
  };

  const handleUpdateCategory = (
    id: string,
    updates: { name?: string; color?: CategoryColor }
  ) => {
    setCategories((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              ...(typeof updates.name === 'string' && updates.name.trim()
                ? { name: updates.name.trim().slice(0, 32) }
                : {}),
              ...(updates.color ? { color: updates.color } : {}),
            }
          : c
      )
    );
  };

  const handleDeleteCategory = (id: string) => {
    setCategories((prev) => prev.filter((c) => c.id !== id));
    setSessions((prev) =>
      prev.map((s) => (s.categoryId === id ? { ...s, categoryId: null } : s))
    );
  };

  const announceStandbyAction = useCallback(
    (label: string, spoken?: string) => {
      setStandbyFeedback(label);
      if (standbyFeedbackTimerRef.current !== null) {
        window.clearTimeout(standbyFeedbackTimerRef.current);
      }
      standbyFeedbackTimerRef.current = window.setTimeout(() => {
        setStandbyFeedback(null);
      }, 4500);

      if (
        spoken &&
        settings.standbySpeakConfirmations &&
        typeof window !== 'undefined' &&
        'speechSynthesis' in window
      ) {
        speechCancelIntentRef.current = 'stop';
        speechQueueStateRef.current = null;
        setIsQueueReading(false);
        setIsQueuePaused(false);
        window.speechSynthesis.cancel();
        const utt = new SpeechSynthesisUtterance(spoken);
        applySpeechSettings(utt);
        utt.onend = () => setSpeakingMessageId(null);
        utt.onerror = () => setSpeakingMessageId(null);
        setSpeakingMessageId('standby-confirm');
        window.speechSynthesis.speak(utt);
      }
    },
    [applySpeechSettings, settings.standbySpeakConfirmations]
  );

  const handleStandbyCommand = useCallback(
    (command: StandbyVoiceCommand) => {
      if (command.type === 'wake_only') {
        playWakeChime();
        announceStandbyAction('Hey Hazel heard — listening…', 'Yes? I am listening.');
        return;
      }

      if (command.type === 'standby_sleep') {
        announceStandbyAction('Back in standby');
        return;
      }

      if (command.type === 'standby_off') {
        announceStandbyAction('Standby voice turned off');
        return;
      }

      if (command.type === 'dismiss_reminder_alerts') {
        dismissAllAlerts();
        announceStandbyAction('Dismissed reminder alerts', 'Alerts dismissed');
        return;
      }

      if (command.type === 'set_reminder') {
        const now = Date.now();
        const timerWidget: TimerWidgetData = {
          kind: 'timer',
          id: generateId('tmr'),
          label: command.label,
          durationSeconds: command.durationSeconds,
          createdAt: now,
          targetTime: command.targetTime,
          isReminder: command.isReminder,
          reminderNote: command.reminderNote,
        };
        const clockStr = formatReminderClockTime(command.targetTime);
        const confirmText = command.isReminder
          ? `Got it! I set a reminder for **${command.label}**${clockStr ? ` at **${clockStr}**` : ''}.`
          : `Started a timer for **${command.label}**${clockStr ? ` (ends at **${clockStr}**)` : ''}.`;

        const userMsg: ChatMessage = {
          id: generateId('usr'),
          role: 'user',
          text: command.rawText,
          createdAt: now,
        };
        const assistantMsg: ChatMessage = {
          id: generateId('ast'),
          role: 'assistant',
          text: confirmText,
          widgets: [timerWidget],
          createdAt: now + 1,
        };
        const targetId = activeSession.id;
        const shouldAutoTitle =
          activeSession.messages.length === 0 &&
          (activeSession.title === 'New chat' || activeSession.title === 'New workspace');

        setSessions((prev) =>
          prev.map((s) =>
            s.id !== targetId
              ? s
              : {
                  ...s,
                  title: shouldAutoTitle
                    ? deriveSessionTitle(command.label)
                    : s.title,
                  updatedAt: now,
                  messages: [...s.messages, userMsg, assistantMsg],
                }
          )
        );

        registerScheduledReminder(timerWidget, targetId);
        announceStandbyAction(
          command.isReminder
            ? `Reminder set: ${command.label}${clockStr ? ` (${clockStr})` : ''}`
            : `Timer started: ${command.label}`,
          command.isReminder
            ? `Reminder set for ${command.label}${clockStr ? ` at ${clockStr}` : ''}.`
            : `Started timer for ${command.label}.`
        );
        return;
      }

      if (command.type === 'stop_reading') {
        stopSpeech();
        announceStandbyAction('Stopped reading');
        return;
      }

      if (command.type === 'stop_generating') {
        if (isStreaming) {
          abortControllerRef.current?.abort();
          setIsStreaming(false);
          announceStandbyAction('Stopped response');
        }
        return;
      }

      if (command.type === 'read_aloud') {
        const lastAssistant = [...activeSession.messages]
          .reverse()
          .find((m) => m.role === 'assistant' && m.text.trim().length > 0);
        if (lastAssistant) {
          handleToggleSpeak(lastAssistant);
          announceStandbyAction('Reading latest response');
        } else {
          announceStandbyAction('Nothing to read yet');
        }
        return;
      }

      if (command.type === 'open_live') {
        if (isStreaming) {
          abortControllerRef.current?.abort();
          setIsStreaming(false);
        }
        stopSpeech();
        liveTargetSessionRef.current = {
          sessionId: activeSession.id,
          space: currentSpace,
        };
        setIsLiveOpen(true);
        return;
      }

      if (command.type === 'new_chat') {
        let targetCat: ChatCategory | undefined;
        if (command.folderQuery && currentSpace === 'workspace') {
          const q = command.folderQuery.toLowerCase();
          targetCat = categories.find(
            (c) =>
              c.name.toLowerCase() === q ||
              c.name.toLowerCase().includes(q)
          );
        }
        handleNewChat(targetCat?.id ?? null);
        announceStandbyAction(
          targetCat
            ? `New workspace in ${targetCat.name}`
            : currentSpace === 'workspace'
              ? 'Started new workspace'
              : 'Started new chat',
          targetCat
            ? `Started a new workspace in ${targetCat.name}`
            : currentSpace === 'workspace'
              ? 'New workspace'
              : 'New chat'
        );
        return;
      }

      if (command.type === 'switch_chat') {
        const q = command.query.toLowerCase();
        const match = [...scopedSessions]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .find((s) => s.title.toLowerCase().includes(q));
        if (match) {
          handleSelectSession(match.id);
          announceStandbyAction(`Opened "${match.title}"`, `Opened ${match.title}`);
        } else {
          announceStandbyAction(`No chat matching "${command.query}"`);
        }
        return;
      }

      if (command.type === 'rename_chat') {
        const cleanTitle = command.title.trim().slice(0, 60);
        if (cleanTitle) {
          handleRenameSession(activeSession.id, cleanTitle);
          announceStandbyAction(`Renamed to "${cleanTitle}"`, 'Chat renamed');
        }
        return;
      }

      if (command.type === 'pin_chat') {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSession.id ? { ...s, pinned: command.pinned } : s
          )
        );
        announceStandbyAction(
          command.pinned ? 'Pinned chat' : 'Unpinned chat',
          command.pinned ? 'Pinned' : 'Unpinned'
        );
        return;
      }

      if (command.type === 'move_to_folder') {
        const q = command.folderQuery.toLowerCase();
        if (q === 'unfiled' || q === 'none' || q === 'uncategorized') {
          handleAssignCategory(activeSession.id, null);
          announceStandbyAction('Removed from folder', 'Moved to unfiled');
          return;
        }
        const matchedCat = categories.find(
          (c) =>
            c.name.toLowerCase() === q ||
            c.name.toLowerCase().includes(q)
        );
        if (matchedCat) {
          handleAssignCategory(activeSession.id, matchedCat.id);
          announceStandbyAction(
            `Moved to ${matchedCat.name}`,
            `Moved to ${matchedCat.name}`
          );
        } else {
          announceStandbyAction(`Folder "${command.folderQuery}" not found`);
        }
        return;
      }

      if (command.type === 'set_mode') {
        const nextMode: ReasoningMode =
          (!isAdmin || appView !== 'workspace') && command.mode === 'coder'
            ? 'fast'
            : command.mode;
        setMode(nextMode);
        const label =
          nextMode === 'coder'
            ? 'Pro Coder'
            : nextMode === 'deep'
              ? 'Deep Think'
              : nextMode === 'teacher'
                ? 'Teacher'
                : 'Fast';
        announceStandbyAction(`Mode: ${label}`, `${label} mode`);
        return;
      }

      if (command.type === 'set_web_search') {
        setWebSearch(command.enabled);
        announceStandbyAction(
          command.enabled ? 'Web search on' : 'Web search off',
          command.enabled ? 'Web search enabled' : 'Web search disabled'
        );
        return;
      }

      if (command.type === 'prompt') {
        announceStandbyAction(`Sent: "${command.text.slice(0, 42)}${command.text.length > 42 ? '…' : ''}"`);
        void sendPrompt(command.text, attachments);
      }
    },
    [
      activeSession,
      announceStandbyAction,
      appView,
      attachments,
      categories,
      currentSpace,
      dismissAllAlerts,
      handleAssignCategory,
      handleNewChat,
      handleRenameSession,
      handleSelectSession,
      handleToggleSpeak,
      isAdmin,
      isStreaming,
      registerScheduledReminder,
      scopedSessions,
      sendPrompt,
      setMode,
      setWebSearch,
      stopSpeech,
    ]
  );

  const standbyVoice = useStandbyVoiceControl({
    enabled: settings.standbyEnabled,
    onChangeEnabled: (nextEnabled) =>
      setSettings((prev) =>
        prev.standbyEnabled === nextEnabled
          ? prev
          : { ...prev, standbyEnabled: nextEnabled }
      ),
    requireWakeWord: settings.standbyRequireWakeWord,
    isBlocked: isLiveOpen || speakingMessageId !== null || (isQueueReading && !isQueuePaused),
    onCommand: handleStandbyCommand,
  });

  const handleEditUserMessage = async (messageId: string, nextText: string) => {
    if (isStreaming) return;
    const targetSessionId = activeSession.id;
    pauseSpeechQueueForIncoming(targetSessionId);
    const idx = activeSession.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;

    const updatedUser: ChatMessage = {
      ...activeSession.messages[idx],
      text: nextText,
      createdAt: Date.now(),
    };
    const truncatedHistory = [...activeSession.messages.slice(0, idx), updatedUser];
    const effectiveView: AppView =
      appView === 'workspace' && isAdmin ? 'workspace' : 'chat';
    const effectiveMode =
      (effectiveView !== 'workspace' || !isAdmin) && mode === 'coder' ? 'fast' : mode;
    const assistantMsg: ChatMessage = {
      id: generateId('ast'),
      role: 'assistant',
      text: '',
      thoughts: '',
      createdAt: Date.now(),
      mode: effectiveMode,
      webSearch,
      isStreaming: true,
      isThinking: false,
    };

    setSessions((prev) =>
      prev.map((s) =>
        s.id !== targetSessionId
          ? s
          : {
              ...s,
              updatedAt: Date.now(),
              messages: [...truncatedHistory, assistantMsg],
            }
      )
    );

    await runStreamForMessages(
      targetSessionId,
      truncatedHistory,
      assistantMsg.id,
      effectiveMode,
      webSearch,
      false,
      effectiveView
    );
  };

  const handleRegenerate = async (assistantMessageId: string) => {
    if (isStreaming) return;
    const targetSessionId = activeSession.id;
    pauseSpeechQueueForIncoming(targetSessionId);
    const idx = activeSession.messages.findIndex((m) => m.id === assistantMessageId);
    if (idx <= 0) return;

    const priorMessages = activeSession.messages.slice(0, idx);
    const effectiveView: AppView =
      appView === 'workspace' && isAdmin ? 'workspace' : 'chat';
    const effectiveMode =
      (effectiveView !== 'workspace' || !isAdmin) && mode === 'coder' ? 'fast' : mode;
    const replacementAssistant: ChatMessage = {
      id: generateId('ast'),
      role: 'assistant',
      text: '',
      thoughts: '',
      createdAt: Date.now(),
      mode: effectiveMode,
      webSearch,
      isStreaming: true,
      isThinking: false,
    };

    setSessions((prev) =>
      prev.map((s) =>
        s.id !== targetSessionId
          ? s
          : {
              ...s,
              updatedAt: Date.now(),
              messages: [...priorMessages, replacementAssistant],
            }
      )
    );

    await runStreamForMessages(
      targetSessionId,
      priorMessages,
      replacementAssistant.id,
      effectiveMode,
      webSearch,
      false,
      effectiveView
    );
  };

  const handleFeedback = (messageId: string, vote: 'up' | 'down') => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id !== activeSession.id
          ? s
          : {
              ...s,
              messages: s.messages.map((m) =>
                m.id === messageId
                  ? { ...m, feedback: m.feedback === vote ? null : vote }
                  : m
              ),
            }
      )
    );
  };

  const handleOpenLiveMode = () => {
    if (isStreaming) handleStopStreaming();
    stopSpeech();
    liveTargetSessionRef.current = {
      sessionId: activeSession.id,
      space: currentSpace,
    };
    setIsLiveOpen(true);
  };

  const handleCloseLiveMode = (
    transcriptTurns: LiveTranscriptTurn[],
    liveTimers: TimerWidgetData[]
  ) => {
    setIsLiveOpen(false);
    const capturedTarget = liveTargetSessionRef.current;
    liveTargetSessionRef.current = null;
    if (transcriptTurns.length === 0 && liveTimers.length === 0) return;

    const targetSessionId = capturedTarget?.sessionId ?? activeSession.id;
    const now = Date.now();
    const newMsgs: ChatMessage[] = transcriptTurns.map((turn, i) => ({
      id: generateId(turn.role === 'user' ? 'usr' : 'ast'),
      role: turn.role,
      text: turn.text,
      createdAt: now + i,
    }));

    if (liveTimers.length > 0) {
      let lastAssistantIdx = -1;
      for (let i = newMsgs.length - 1; i >= 0; i--) {
        if (newMsgs[i].role === 'assistant') {
          lastAssistantIdx = i;
          break;
        }
      }
      if (lastAssistantIdx !== -1) {
        newMsgs[lastAssistantIdx] = {
          ...newMsgs[lastAssistantIdx],
          widgets: liveTimers,
        };
      } else {
        newMsgs.push({
          id: generateId('ast'),
          role: 'assistant',
          text: 'Active timers started during Hazel Live:',
          widgets: liveTimers,
          createdAt: now + newMsgs.length,
        });
      }
    }

    const firstUserTurn = transcriptTurns.find((t) => t.role === 'user');

    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== targetSessionId) return s;
        const shouldAutoTitle =
          s.messages.length === 0 &&
          (s.title === 'New chat' || s.title === 'New workspace');
        return {
          ...s,
          title:
            shouldAutoTitle && firstUserTurn
              ? deriveSessionTitle(firstUserTurn.text)
              : s.title,
          updatedAt: now,
          messages: [...s.messages, ...newMsgs],
        };
      })
    );
  };

  // Drag & drop files anywhere on the workspace
  const handleDragEnter = (e: React.DragEvent) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      dragDepthRef.current += 1;
      setIsDraggingFiles(true);
    }
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
    }
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDraggingFiles(false);
      }
    }
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    if (e.dataTransfer?.files?.length) {
      if (showWelcomePage || appView === 'admin' || (appView === 'workspace' && !isAdmin)) {
        setShowWelcomePage(false);
        setAppView('chat');
      }
      handleAddFiles(e.dataTransfer.files);
    }
  };

  const hasMessages = activeSession.messages.length > 0;

  const handleTriggerHeyHazelWakeCall = () => {
    setShowWelcomePage(false);
    setAppView('chat');
    const started = standbyVoice.enableStandbyWakeCall();
    if (started) {
      playWakeChime();
      announceStandbyAction(
        'Hey Hazel ready — speak your question or command…',
        'Hey! I am listening.'
      );
    }
  };

  const standbyVoiceBar =
    standbyVoice.status !== 'off' ? (
      <div className="mx-auto w-full max-w-3xl px-3 pt-1 sm:px-6">
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-1.5 text-xs ${
            standbyVoice.status === 'error'
              ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200'
              : standbyVoice.status === 'engaged' || standbyVoice.isSpeechDetected
                ? 'border-emerald-300/80 bg-emerald-50/90 text-emerald-900 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-200'
                : 'border-slate-200/90 bg-[#F4F6FA] text-slate-700 dark:border-zinc-800 dark:bg-[#1E1F20] dark:text-zinc-300'
          }`}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <Mic className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />

            {standbyVoice.status !== 'paused' && standbyVoice.status !== 'error' && (
              <div
                aria-hidden="true"
                className="flex h-4.5 shrink-0 items-center gap-[2.5px]"
              >
                {standbyVoice.audioBands.map((band, idx) => (
                  <span
                    key={idx}
                    style={{ transform: `scaleY(${band})` }}
                    className={`h-4 w-[3px] origin-center rounded-full will-change-transform transition-colors duration-150 ${
                      standbyVoice.isSpeechDetected
                        ? 'bg-emerald-500 dark:bg-emerald-400'
                        : standbyVoice.status === 'engaged'
                          ? 'bg-blue-500/80 dark:bg-blue-400/80'
                          : 'bg-slate-400/80 dark:bg-zinc-500/80'
                    }`}
                  />
                ))}
              </div>
            )}

            <span className="truncate font-medium">
              {standbyVoice.error
                ? standbyVoice.error
                : standbyVoice.interimTranscript
                  ? `"${standbyVoice.interimTranscript}"`
                  : standbyFeedback
                    ? standbyFeedback
                    : standbyVoice.status === 'paused'
                      ? 'Standby paused while speaking'
                      : standbyVoice.isSpeechDetected
                        ? standbyVoice.status === 'engaged'
                          ? 'Speech detected · Listening…'
                          : 'Speech detected'
                        : standbyVoice.status === 'engaged'
                          ? 'Hey Hazel listening — speak a prompt or command…'
                          : settings.standbyRequireWakeWord
                            ? 'Standby · Say "Hey Hazel…" to wake or control chats'
                            : 'Hands-free active · Speak a command or prompt'}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* Hands-free Session Summary Widget */}
            <div
              aria-label={`Hands-free session summary: uptime ${formatStandbyUptime(standbyVoice.uptimeSeconds)}, ${standbyVoice.commandsProcessed} commands processed`}
              className="hidden items-center gap-2.5 border-r border-slate-300/70 pr-2.5 font-mono text-[11px] opacity-85 tabular-nums sm:inline-flex dark:border-zinc-700"
            >
              <span className="inline-flex items-center gap-1" title="Total hands-free uptime">
                <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span>{formatStandbyUptime(standbyVoice.uptimeSeconds)}</span>
              </span>
              <span aria-hidden="true" className="opacity-45">
                ·
              </span>
              <span
                className="inline-flex items-center gap-1"
                title="Commands & voice prompts processed this session"
              >
                <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span>
                  {standbyVoice.commandsProcessed}{' '}
                  {standbyVoice.commandsProcessed === 1 ? 'cmd' : 'cmds'}
                </span>
              </span>
            </div>

            {standbyVoice.status === 'standby' &&
              settings.standbyRequireWakeWord && (
                <button
                  type="button"
                  onClick={() => {
                    playWakeChime();
                    standbyVoice.enterEngaged();
                    announceStandbyAction('Hey Hazel heard — listening…');
                  }}
                  className="rounded-lg px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100/70 dark:text-blue-300 dark:hover:bg-blue-950/50"
                >
                  Hey Hazel
                </button>
              )}
            <button
              type="button"
              onClick={() => setShowStandbyHelp((prev) => !prev)}
              aria-expanded={showStandbyHelp}
              aria-label="Voice commands reference"
              title="Voice commands"
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-black/5 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setShowStandbyHelp(false);
                standbyVoice.disableStandby();
              }}
              aria-label="Turn off standby voice"
              title="Turn off"
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-black/5 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Compact mobile summary row */}
        <div className="mt-1 flex items-center justify-end gap-2.5 px-1 font-mono text-[10.5px] text-slate-500 tabular-nums sm:hidden dark:text-zinc-400">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden="true" />
            <span>{formatStandbyUptime(standbyVoice.uptimeSeconds)}</span>
          </span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
            <span>
              {standbyVoice.commandsProcessed}{' '}
              {standbyVoice.commandsProcessed === 1 ? 'cmd' : 'cmds'}
            </span>
          </span>
        </div>

        {showStandbyHelp && (
          <div className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[11.5px] text-slate-600 shadow-xs sm:grid-cols-2 dark:border-zinc-700/80 dark:bg-[#222428] dark:text-zinc-300">
            <div>&ldquo;Hey Hazel&rdquo; (wake-up call) · &ldquo;Hey Hazel, new chat&rdquo;</div>
            <div>&ldquo;Hey Hazel, remind me in 10 minutes to check the oven&rdquo;</div>
            <div>&ldquo;Hey Hazel, remind me at 3:30 PM to stretch&rdquo; · &ldquo;dismiss reminders&rdquo;</div>
            <div>&ldquo;Hey Hazel, open chat &lt;name&gt;&rdquo; · &ldquo;rename chat to &lt;title&gt;&rdquo;</div>
            <div>&ldquo;Hey Hazel, read aloud&rdquo; · &ldquo;stop reading&rdquo;</div>
            <div>&ldquo;Hey Hazel, open live mode&rdquo; · &ldquo;stop listening&rdquo;</div>
          </div>
        )}
      </div>
    ) : null;

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative flex h-[100dvh] w-full overflow-hidden bg-white text-slate-900 dark:bg-[#131314] dark:text-zinc-100"
    >
      {/* Global On-Screen Reminder & Timer Expiration Alerts */}
      <ReminderAlertBanner
        alerts={activeAlerts}
        activeSessionId={activeSession.id}
        notificationPermission={notifPermission}
        browserNotificationsEnabled={settings.browserNotificationsEnabled}
        onDismiss={dismissAlert}
        onDismissAll={dismissAllAlerts}
        onSnooze={handleSnoozeAlert}
        onJumpToSession={(sessionId) => {
          setShowWelcomePage(false);
          handleSelectSession(sessionId);
        }}
        onEnableBrowserNotifications={handleEnableBrowserNotifications}
      />

      {/* File Dropzone Overlay */}
      {isDraggingFiles && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-blue-600/10 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-blue-500 bg-white/95 px-8 py-6 shadow-xl dark:bg-[#1E1F20]/95">
            <Upload className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            <p className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Drop images, PDFs, or files to share
            </p>
          </div>
        </div>
      )}

      {showWelcomePage ? (
        <LandingWelcomePage
          theme={theme}
          avatarGesture={hazelGesture}
          hasExistingChats={
            activeChatSession.messages.length > 0 || chatSessions.length > 1
          }
          latestChatTitle={activeChatSession.title}
          authUser={authUser}
          authLoading={authLoading}
          adminBootstrapAvailable={adminBootstrapAvailable}
          onChangeTheme={setTheme}
          onEnterChat={(opts) => {
            const targetSession = opts?.startNew
              ? handleNewChat(null, {
                  preserveModeAndSearch: Boolean(opts?.mode),
                  space: 'chat',
                })
              : undefined;
            if (opts?.mode && opts.mode !== 'coder') {
              setChatMode(opts.mode);
            } else {
              setChatMode((prev) => (prev === 'coder' ? 'fast' : prev));
            }
            setAppView('chat');
            setShowWelcomePage(false);
            if (opts?.starterPrompt) {
              void sendPrompt(opts.starterPrompt, [], {
                mode: opts.mode === 'coder' ? 'fast' : opts.mode,
                targetSession,
                view: 'chat',
              });
            }
          }}
          onEnterWorkspace={() => {
            setAppView('workspace');
            setShowWelcomePage(false);
          }}
          onEnterAdmin={() => {
            if (isAdmin) {
              setAppView('admin');
              setShowWelcomePage(false);
            }
          }}
          onTriggerHeyHazel={handleTriggerHeyHazelWakeCall}
          onOpenLive={handleOpenLiveMode}
          onOpenAuth={(m, notice) => handleOpenAuthModal(m ?? 'signin', notice ?? null)}
          onSignOut={() => void handleSignOut()}
        />
      ) : (
        <>
          {/* History Sidebar */}
          <ChatSidebar
            sessions={scopedSessions}
            categories={categories}
            activeSessionId={activeSession.id}
            space={appView === 'workspace' ? 'workspace' : 'chat'}
            isWorkspaceLockedView={appView === 'workspace' && !isAdmin}
            showFoldersAndFilters={appView === 'workspace' && isAdmin}
            isDesktopOpen={isDesktopSidebarOpen}
            isMobileOpen={isMobileSidebarOpen}
            onSelectSession={handleSelectSession}
            onNewChat={(catId) => handleNewChat(catId)}
            onDeleteSession={handleDeleteSession}
            onRenameSession={handleRenameSession}
            onTogglePinSession={handleTogglePinSession}
            onAssignCategory={handleAssignCategory}
            onCreateCategory={handleCreateCategory}
            onUpdateCategory={handleUpdateCategory}
            onDeleteCategory={handleDeleteCategory}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onCloseDesktop={() => setIsDesktopSidebarOpen(false)}
            onCloseMobile={() => setIsMobileSidebarOpen(false)}
            authUser={authUser}
            isAdmin={isAdmin}
            onOpenAdmin={() => setAppView('admin')}
            onOpenAuth={(m) => handleOpenAuthModal(m ?? 'signin')}
            onSignOut={() => void handleSignOut()}
          />

      {/* Main Conversational Stage */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Top Header */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-1.5 border-b border-slate-200/70 px-2 sm:gap-2 sm:px-4 dark:border-zinc-800/80">
          <div className="flex min-w-0 items-center gap-1 sm:gap-1.5">
            {/* Mobile drawer button */}
            <button
              type="button"
              onClick={() => setIsMobileSidebarOpen(true)}
              aria-label="Open chat history"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600 sm:h-10 sm:w-10 md:hidden dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* Desktop reopen sidebar button */}
            {!isDesktopSidebarOpen && (
              <button
                type="button"
                onClick={() => setIsDesktopSidebarOpen(true)}
                aria-label="Open sidebar"
                className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600 md:inline-flex dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <PanelLeft className="h-5 w-5" />
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowWelcomePage(true)}
              title="Back to Welcome Page"
              className="flex shrink-0 items-center gap-2 rounded-xl px-1 py-1 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600 sm:px-1.5 dark:hover:bg-zinc-800"
            >
              <SparkEmblem size={26} />
              <span className="font-display hidden text-lg font-medium tracking-tight text-slate-900 sm:inline dark:text-white">
                Hazel
              </span>
            </button>
          </div>

          <div className="flex min-w-0 shrink-0 items-center gap-1 sm:gap-2">
            {/* Chat / Workspace / Admin Switcher */}
            <div
              role="group"
              aria-label="Switch active view"
              className="inline-flex shrink-0 rounded-full bg-[#F0F4F9] p-0.5 whitespace-nowrap sm:p-1 dark:bg-[#1E1F20]"
            >
              <button
                type="button"
                onClick={() => {
                  setAppView('chat');
                  setChatMode((prev) => (prev === 'coder' ? 'fast' : prev));
                }}
                aria-pressed={appView === 'chat'}
                aria-label="Chat Space"
                title="Chat Space"
                className={`inline-flex min-h-[30px] items-center gap-1 rounded-full px-2 text-[11.5px] font-medium whitespace-nowrap transition-colors sm:gap-1.5 sm:px-3 sm:text-xs ${
                  appView === 'chat'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-[#2D2F31] dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                <span>Chat</span>
              </button>
              <button
                type="button"
                onClick={() => setAppView('workspace')}
                aria-pressed={appView === 'workspace'}
                aria-label={isAdmin ? 'Workspace zone' : 'Workspace locked'}
                title={isAdmin ? 'Workspace' : 'Workspace (Locked — Admin only)'}
                className={`inline-flex min-h-[30px] items-center gap-1 rounded-full px-2 text-[11.5px] font-medium whitespace-nowrap transition-colors sm:gap-1.5 sm:px-3 sm:text-xs ${
                  appView === 'workspace'
                    ? 'bg-white text-rose-700 shadow-xs dark:bg-[#2D2F31] dark:text-rose-300'
                    : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                {isAdmin ? (
                  <LayoutPanelLeft className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <Lock className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                )}
                <span>Workspace</span>
                {isAdmin &&
                  appView === 'workspace' &&
                  workspaceArtifacts.length > 0 && (
                    <span className="font-mono text-[10.5px] opacity-70 tabular-nums">
                      {workspaceArtifacts.length}
                    </span>
                  )}
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setAppView('admin')}
                  aria-pressed={appView === 'admin'}
                  aria-label="Admin Panel"
                  title="Admin Panel"
                  className={`inline-flex min-h-[30px] items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap transition-colors sm:gap-1.5 sm:px-3 ${
                    appView === 'admin'
                      ? 'bg-white text-emerald-700 shadow-xs dark:bg-[#2D2F31] dark:text-emerald-300'
                      : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  <Shield className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden sm:inline">Admin</span>
                </button>
              )}
            </div>

            {/* Model Reasoning, Teacher & Coding Mode Dropdown */}
            {appView !== 'admin' && (appView !== 'workspace' || isAdmin) && (
            <div className="relative shrink-0" ref={modeMenuRef}>
              <button
                type="button"
                onClick={() => setIsModeMenuOpen((prev) => !prev)}
                aria-expanded={isModeMenuOpen}
                aria-haspopup="menu"
                aria-label="Select reasoning, teacher, or coding mode"
                className={`inline-flex min-h-[34px] shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 sm:min-h-[38px] sm:gap-1.5 sm:px-3 ${
                  mode === 'coder'
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400'
                    : mode === 'teacher'
                      ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200/90 hover:bg-amber-100/70 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-800/60'
                      : mode === 'deep'
                        ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200/80 hover:bg-blue-100/70 dark:bg-blue-950/50 dark:text-blue-200 dark:ring-blue-800/60'
                        : 'bg-[#F0F4F9] text-slate-700 hover:bg-slate-200/80 dark:bg-[#1E1F20] dark:text-zinc-200 dark:hover:bg-zinc-800'
                }`}
              >
                {mode === 'coder' ? (
                  <Code2 className="h-3.5 w-3.5 shrink-0" />
                ) : mode === 'teacher' ? (
                  <GraduationCap className="h-3.5 w-3.5 shrink-0" />
                ) : mode === 'deep' ? (
                  <Brain className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <Zap className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="hidden sm:inline">
                  {mode === 'coder'
                    ? 'Pro Coder'
                    : mode === 'teacher'
                      ? 'Teacher'
                      : mode === 'deep'
                        ? 'Deep Think'
                        : 'Fast'}
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 shrink-0 opacity-75 transition-transform ${
                    isModeMenuOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {isModeMenuOpen && (
                <div
                  role="menu"
                  aria-label="Reasoning, teacher, and coding mode"
                  className="absolute right-0 z-40 mt-2 w-68 rounded-2xl border border-slate-200/90 bg-white p-1.5 shadow-xl dark:border-zinc-700/80 dark:bg-[#222428]"
                >
                  {(
                    [
                      {
                        id: 'fast',
                        label: 'Fast',
                        desc:
                          appView === 'workspace'
                            ? 'Rapid builds, coding & quick answers'
                            : 'Natural everyday friendly chat',
                        icon: Zap,
                      },
                      {
                        id: 'teacher',
                        label: 'Teacher',
                        desc: 'Step-by-step explanations & everyday analogies',
                        icon: GraduationCap,
                      },
                      {
                        id: 'deep',
                        label: 'Deep Think',
                        desc:
                          appView === 'workspace'
                            ? 'Multi-step reasoning & architecture analysis'
                            : 'Thoughtful reflection & talking things through',
                        icon: Brain,
                      },
                      ...(appView === 'workspace'
                        ? ([
                            {
                              id: 'coder',
                              label: 'Pro Coder',
                              desc: 'Maximum engineering & AI systems depth',
                              icon: Code2,
                            },
                          ] as const)
                        : []),
                    ] as const
                  ).map((item) => {
                    const Icon = item.icon;
                    const selected = mode === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        onClick={() => {
                          setMode(item.id);
                          setIsModeMenuOpen(false);
                        }}
                        className={`flex w-full items-start justify-between gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                          selected
                            ? 'bg-slate-100 text-slate-950 dark:bg-zinc-800 dark:text-white'
                            : 'text-slate-700 hover:bg-slate-50 dark:text-zinc-200 dark:hover:bg-zinc-800/60'
                        }`}
                      >
                        <div className="flex min-w-0 items-start gap-2.5">
                          <Icon
                            className={`mt-0.5 h-4 w-4 shrink-0 ${
                              item.id === 'coder'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : item.id === 'teacher'
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : item.id === 'deep'
                                    ? 'text-blue-600 dark:text-blue-400'
                                    : 'text-sky-500 dark:text-sky-400'
                            }`}
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold">{item.label}</div>
                            <div className="text-[11px] leading-snug text-slate-500 dark:text-zinc-400">
                              {item.desc}
                            </div>
                          </div>
                        </div>
                        {selected && (
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            )}

            {scheduledReminders.length > 0 && (
              <div className="relative shrink-0" ref={remindersMenuRef}>
                <button
                  type="button"
                  onClick={() => setIsRemindersPopoverOpen((prev) => !prev)}
                  aria-expanded={isRemindersPopoverOpen}
                  aria-label={`${scheduledReminders.length} active reminder${scheduledReminders.length === 1 ? '' : 's'}`}
                  title="Upcoming reminders & timers"
                  className="inline-flex min-h-[34px] items-center gap-1 rounded-full bg-amber-50 px-2 text-xs font-medium text-amber-800 ring-1 ring-amber-200/90 transition-colors hover:bg-amber-100/80 sm:min-h-[38px] sm:gap-1.5 sm:px-2.5 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-800/60 dark:hover:bg-amber-900/50"
                >
                  <Bell className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-mono text-[11px] font-semibold tabular-nums">
                    {scheduledReminders.length}
                  </span>
                </button>

                {isRemindersPopoverOpen && (
                  <div className="absolute right-0 z-40 mt-2 w-72 rounded-2xl border border-slate-200/90 bg-white p-2 shadow-xl dark:border-zinc-700/80 dark:bg-[#222428]">
                    <div className="flex items-center justify-between px-2 py-1">
                      <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase dark:text-zinc-400">
                        Scheduled Alerts ({scheduledReminders.length})
                      </span>
                      {settings.browserNotificationsEnabled &&
                        notifPermission === 'default' && (
                          <button
                            type="button"
                            onClick={handleEnableBrowserNotifications}
                            className="text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
                          >
                            Allow notifications
                          </button>
                        )}
                    </div>
                    <div className="mt-1 max-h-60 space-y-1 overflow-y-auto">
                      {scheduledReminders.map((rem) => {
                        const target =
                          rem.targetTime ??
                          rem.createdAt + rem.durationSeconds * 1000;
                        const secsLeft = Math.max(
                          0,
                          Math.ceil((target - reminderClockNow) / 1000)
                        );
                        const clockStr = formatReminderClockTime(target);
                        return (
                          <div
                            key={rem.id}
                            className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-2.5 py-2 text-xs dark:bg-zinc-800/70"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium text-slate-800 dark:text-zinc-100">
                                {rem.label}
                              </div>
                              <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10.5px] text-slate-500 tabular-nums dark:text-zinc-400">
                                <span>{formatCountdownClock(secsLeft)}</span>
                                {clockStr && (
                                  <>
                                    <span>·</span>
                                    <span>{clockStr}</span>
                                  </>
                                )}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleCancelScheduledReminder(rem.id)}
                              aria-label={`Cancel ${rem.label}`}
                              title="Cancel alert"
                              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={handleToggleReadAloudQueue}
              disabled={!hasMessages}
              aria-pressed={isQueueReading}
              aria-label={
                isQueueReading && isQueuePaused
                  ? 'Read Aloud paused while new message arrives — click to stop'
                  : isQueueReading
                    ? 'Stop reading chat aloud'
                    : 'Read aloud all messages in this chat'
              }
              title={
                isQueueReading && isQueuePaused
                  ? 'Paused while streaming — click to stop'
                  : isQueueReading
                    ? 'Stop Reading'
                    : 'Read Aloud'
              }
              className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-blue-600 sm:min-h-[38px] sm:px-3 ${
                isQueueReading && isQueuePaused
                  ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-300/80 hover:bg-amber-200/80 dark:bg-amber-950/60 dark:text-amber-200 dark:ring-amber-700/70'
                  : isQueueReading
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-[#F0F4F9] text-slate-700 hover:bg-slate-200/80 dark:bg-[#1E1F20] dark:text-zinc-200 dark:hover:bg-zinc-800'
              }`}
            >
              {isQueueReading && isQueuePaused ? (
                <>
                  <Pause className="h-3.5 w-3.5" />
                  <span className="hidden lg:inline">Paused</span>
                </>
              ) : isQueueReading ? (
                <>
                  <VolumeX className="h-3.5 w-3.5" />
                  <span className="hidden lg:inline">Stop Reading</span>
                </>
              ) : (
                <>
                  <Volume2 className="h-3.5 w-3.5" />
                  <span className="hidden lg:inline">Read Aloud</span>
                </>
              )}
            </button>

            {!authLoading &&
              (authUser ? (
                <div className="hidden h-[38px] items-center gap-1 rounded-full bg-[#F0F4F9] pr-1 pl-2.5 text-xs sm:inline-flex dark:bg-[#1E1F20]">
                  <span className="max-w-[125px] truncate font-medium text-slate-800 dark:text-zinc-100">
                    {isAdmin ? `Admin · ${authUser.fullName}` : authUser.fullName}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleSignOut()}
                    aria-label="Sign out"
                    title="Sign out"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-white hover:text-rose-600 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-rose-400"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => handleOpenAuthModal('signin')}
                  className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full bg-blue-600 px-2.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 transition-colors hover:bg-blue-700 sm:min-h-[38px] sm:px-3 dark:bg-blue-500 dark:hover:bg-blue-400"
                >
                  <LogIn className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden sm:inline">Sign in</span>
                </button>
              ))}
          </div>
        </header>

        <PWAInstallBanner />

        {/* Full-Mode Stage: Chat, Workspace (Admin Only), or Admin Panel */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {appView === 'admin' && isAdmin && authUser ? (
            <AdminPanel
              authUser={authUser}
              onOpenWorkspace={() => setAppView('workspace')}
              onOpenChat={() => setAppView('chat')}
            />
          ) : appView === 'workspace' ? (
            isAdmin ? (
              <WorkspacePanel
                artifacts={workspaceArtifacts}
                messages={activeSession.messages}
                activeCategory={activeCategory}
                composerValue={composerValue}
                attachments={attachments}
                mode={mode}
                webSearch={webSearch}
                isStreaming={isStreaming}
                attachmentError={attachmentError}
                speakingMessageId={speakingMessageId}
                defaultShowThoughts={settings.autoExpandThoughts}
                galleryCount={sessionMediaCount}
                avatarGesture={hazelGesture}
                standbyBar={standbyVoiceBar}
                onRunStarterPrompt={(prompt, opts) => void sendPrompt(prompt, [], opts)}
                onChangeComposerValue={setComposerValue}
                onAddFiles={handleAddFiles}
                onRemoveAttachment={(id) =>
                  setAttachments((prev) => prev.filter((a) => a.id !== id))
                }
                onChangeMode={setMode}
                onToggleWebSearch={() => setWebSearch((prev) => !prev)}
                onSubmit={() => sendPrompt(composerValue, attachments)}
                onStopStreaming={handleStopStreaming}
                onOpenLiveMode={handleOpenLiveMode}
                onOpenGallery={() => setIsGalleryOpen(true)}
                onEditUserMessage={handleEditUserMessage}
                onRegenerate={handleRegenerate}
                onToggleSpeak={handleToggleSpeak}
                onFeedback={handleFeedback}
                onOpenMemories={() => setIsSettingsOpen(true)}
              />
            ) : (
              <WorkspaceLockedView
                authUser={authUser}
                adminBootstrapAvailable={adminBootstrapAvailable}
                onOpenAuth={(m, notice) => handleOpenAuthModal(m ?? 'signin', notice ?? null)}
                onSignOut={() => void handleSignOut()}
                onReturnToChat={() => setAppView('chat')}
              />
            )
          ) : (
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              {/* Scrollable Chat Transcript or Welcome Screen */}
              <main
                ref={scrollContainerRef}
                onScroll={handleViewportScroll}
                className="chat-scroll relative flex-1 overflow-y-auto"
              >
                {!hasMessages ? (
                  <WelcomeScreen
                    gesture={hazelGesture}
                    onSelectPrompt={(prompt, opts) => sendPrompt(prompt, [], opts)}
                  />
                ) : (
                  <div
                    ref={chatMessagesContainerRef}
                    className="mx-auto w-full max-w-3xl space-y-6 px-3 pt-4 pb-8 sm:px-6"
                  >
                    {activeSession.messages.map((msg) => (
                      <MessageItem
                        key={msg.id}
                        message={msg}
                        isSpeaking={speakingMessageId === msg.id}
                        defaultShowThoughts={settings.autoExpandThoughts}
                        onEditUserMessage={handleEditUserMessage}
                        onRegenerate={handleRegenerate}
                        onToggleSpeak={handleToggleSpeak}
                        onFeedback={handleFeedback}
                        onOpenMemories={() => setIsSettingsOpen(true)}
                      />
                    ))}
                  </div>
                )}
              </main>

              {/* Scroll-to-bottom button */}
              {showScrollBottom && (
                <div className="pointer-events-none absolute inset-x-0 bottom-[148px] z-20 flex justify-center sm:bottom-[156px]">
                  <button
                    type="button"
                    onClick={() => {
                      autoScrollEnabledRef.current = true;
                      setShowScrollBottom(false);
                      scrollToBottom('smooth');
                    }}
                    aria-label="Scroll to latest message"
                    className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-md backdrop-blur-xs transition-transform hover:scale-105 dark:border-zinc-700 dark:bg-[#282A2C]/95 dark:text-zinc-200"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* Standby Voice Control Bar */}
              {standbyVoiceBar}

              {/* Composer Dock */}
              <PromptComposer
                value={composerValue}
                attachments={attachments}
                mode={mode}
                webSearch={webSearch}
                view="chat"
                isStreaming={isStreaming}
                attachmentError={attachmentError}
                onChangeValue={setComposerValue}
                onAddFiles={handleAddFiles}
                onRemoveAttachment={(id) =>
                  setAttachments((prev) => prev.filter((a) => a.id !== id))
                }
                onChangeMode={setMode}
                onToggleWebSearch={() => setWebSearch((prev) => !prev)}
                onSubmit={() => sendPrompt(composerValue, attachments)}
                onStopStreaming={handleStopStreaming}
                onOpenLiveMode={handleOpenLiveMode}
                onOpenGallery={() => setIsGalleryOpen(true)}
                galleryCount={sessionMediaCount}
              />
            </div>
          )}
        </div>
      </div>
        </>
      )}

      {/* Live Voice Conversation Modal */}
      <LiveVoiceOverlay
        isOpen={isLiveOpen}
        defaultVoice={settings.liveVoice}
        view={appView === 'workspace' && isAdmin ? 'workspace' : 'chat'}
        guestMemories={!authUser ? memories : undefined}
        onScheduleTimer={(timer) =>
          registerScheduledReminder(
            timer,
            liveTargetSessionRef.current?.sessionId ?? activeSession.id
          )
        }
        onMemoryEvent={applyMemoryEvent}
        onClose={handleCloseLiveMode}
      />

      {/* Media Gallery Modal */}
      <MediaGalleryModal
        isOpen={isGalleryOpen}
        space={currentSpace}
        activeSession={activeSession}
        allSessions={scopedSessions}
        onClose={() => setIsGalleryOpen(false)}
        onPromptSample={(prompt) => {
          setIsGalleryOpen(false);
          void sendPrompt(prompt, [], { mode: 'fast', webSearch: false });
        }}
      />

      {/* Camera Access & Photo Capture Modal */}
      <CameraCaptureModal
        isOpen={isCameraModalOpen}
        onClose={() => setIsCameraModalOpen(false)}
        onAttachCaptureToChat={(file) => {
          void handleAddFiles([file]);
        }}
      />

      {/* Screen Sharing & Recording Controller */}
      <ScreenRecorderController
        isModalOpen={isScreenModalOpen}
        onOpenModal={() => setIsScreenModalOpen(true)}
        onCloseModal={() => setIsScreenModalOpen(false)}
        onAttachSnapshotToChat={(file) => {
          void handleAddFiles([file]);
        }}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        theme={theme}
        settings={settings}
        sessionCount={sessions.length}
        memories={memories}
        syncStatus={syncStatus}
        lastSyncedAt={lastSyncedAt}
        supabaseSchemaSql={supabaseSchemaSql}
        standbySupported={standbyVoice.isSupported}
        standbyStatus={standbyVoice.status}
        standbyError={standbyVoice.error}
        standbyUptimeSeconds={standbyVoice.uptimeSeconds}
        standbyCommandsProcessed={standbyVoice.commandsProcessed}
        authUser={authUser}
        authConfigured={authConfigured}
        isAdmin={isAdmin}
        onClose={() => setIsSettingsOpen(false)}
        onChangeTheme={setTheme}
        onUpdateSettings={setSettings}
        onAddMemory={handleAddMemory}
        onDeleteMemory={handleDeleteMemory}
        onClearAllMemories={handleClearAllMemories}
        onSyncNow={handleSyncNow}
        onClearAllChats={handleClearAllChats}
        onOpenCameraCapture={() => {
          setIsSettingsOpen(false);
          setIsCameraModalOpen(true);
        }}
        onOpenScreenCapture={() => {
          setIsSettingsOpen(false);
          setIsScreenModalOpen(true);
        }}
        onWakeHeyHazel={handleTriggerHeyHazelWakeCall}
        onClearStandbyError={standbyVoice.clearStandbyError}
        onTestReminderAlert={handleTestReminderAlert}
        onOpenAdmin={() => {
          if (isAdmin) {
            setShowWelcomePage(false);
            setAppView('admin');
          }
        }}
        onOpenAuth={(m) => handleOpenAuthModal(m ?? 'signin')}
        onSignOut={() => void handleSignOut()}
      />

      {/* Sign In / Create Account / Claim Admin Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        initialMode={authModalMode}
        authConfigured={authConfigured}
        adminBootstrapAvailable={adminBootstrapAvailable}
        contextNotice={authContextNotice}
        onClose={() => {
          setIsAuthModalOpen(false);
          setAuthContextNotice(null);
        }}
        onSuccess={(user) => {
          authSyncEpochRef.current += 1;
          setAuthUser(user);
          setAuthLoading(false);
          if (user.isAdmin) {
            setAdminBootstrapAvailable(false);
          }
          setAuthContextNotice(null);
          setIsAuthModalOpen(false);
        }}
      />

      {/* Offline PWA Status Banner */}
      <OfflineIndicator />
    </div>
  );
}

export default App;
