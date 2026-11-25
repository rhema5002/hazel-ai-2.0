import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Filter,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  LogIn,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Shield,
  Trash2,
  X,
} from 'lucide-react';
import type { AuthUser } from '../services/authClient';
import type { CategoryColor, ChatCategory, ChatSession } from '../types/chat';
import type { AuthModalMode } from './AuthModal';
import { PWAInstallButton } from './PWAInstallButton';
import { SparkEmblem } from './SparkEmblem';

type SidebarViewMode = 'recent' | 'folders';
type CategoryFilter = 'all' | 'uncategorized' | string;

interface ChatSidebarProps {
  sessions: ChatSession[];
  categories: ChatCategory[];
  activeSessionId: string;
  showFoldersAndFilters: boolean;
  isDesktopOpen: boolean;
  isMobileOpen: boolean;
  onSelectSession: (id: string) => void;
  onNewChat: (categoryId?: string | null) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onTogglePinSession: (id: string) => void;
  onAssignCategory: (sessionId: string, categoryId: string | null) => void;
  onCreateCategory: (name: string, color: CategoryColor) => ChatCategory;
  onUpdateCategory: (
    id: string,
    updates: { name?: string; color?: CategoryColor }
  ) => void;
  onDeleteCategory: (id: string) => void;
  onOpenSettings: () => void;
  onCloseDesktop: () => void;
  onCloseMobile: () => void;
  authUser?: AuthUser | null;
  isAdmin?: boolean;
  onOpenAdmin?: () => void;
  onOpenAuth: (mode?: AuthModalMode) => void;
  onSignOut: () => void;
}

interface SessionGroup {
  label: string;
  items: ChatSession[];
}

const COLOR_ORDER: CategoryColor[] = [
  'blue',
  'violet',
  'emerald',
  'amber',
  'rose',
  'cyan',
  'slate',
];

const CATEGORY_COLOR_STYLES: Record<
  CategoryColor,
  {
    label: string;
    swatch: string;
    iconText: string;
  }
> = {
  blue: {
    label: 'Blue',
    swatch: 'bg-blue-500',
    iconText: 'text-blue-600 dark:text-blue-400',
  },
  violet: {
    label: 'Violet',
    swatch: 'bg-violet-500',
    iconText: 'text-violet-600 dark:text-violet-400',
  },
  emerald: {
    label: 'Emerald',
    swatch: 'bg-emerald-500',
    iconText: 'text-emerald-600 dark:text-emerald-400',
  },
  amber: {
    label: 'Amber',
    swatch: 'bg-amber-500',
    iconText: 'text-amber-600 dark:text-amber-400',
  },
  rose: {
    label: 'Rose',
    swatch: 'bg-rose-500',
    iconText: 'text-rose-600 dark:text-rose-400',
  },
  cyan: {
    label: 'Cyan',
    swatch: 'bg-cyan-500',
    iconText: 'text-cyan-600 dark:text-cyan-400',
  },
  slate: {
    label: 'Slate',
    swatch: 'bg-slate-500',
    iconText: 'text-slate-600 dark:text-zinc-400',
  },
};

function groupSessionsByTime(sessions: ChatSession[]): SessionGroup[] {
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();
  const sevenDaysMs = now - 7 * 24 * 60 * 60 * 1000;

  const pinned: ChatSession[] = [];
  const today: ChatSession[] = [];
  const week: ChatSession[] = [];
  const older: ChatSession[] = [];

  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  for (const session of sorted) {
    if (session.pinned) {
      pinned.push(session);
    } else if (session.updatedAt >= todayMs) {
      today.push(session);
    } else if (session.updatedAt >= sevenDaysMs) {
      week.push(session);
    } else {
      older.push(session);
    }
  }

  const groups: SessionGroup[] = [];
  if (pinned.length > 0) groups.push({ label: 'Pinned', items: pinned });
  if (today.length > 0) groups.push({ label: 'Today', items: today });
  if (week.length > 0) groups.push({ label: 'Previous 7 days', items: week });
  if (older.length > 0) groups.push({ label: 'Older', items: older });
  return groups;
}

function sessionMatchesQuery(
  session: ChatSession,
  queryLower: string,
  categoryMap: Map<string, ChatCategory>
): boolean {
  if (session.title.toLowerCase().includes(queryLower)) return true;
  const cat = session.categoryId ? categoryMap.get(session.categoryId) : null;
  if (cat && cat.name.toLowerCase().includes(queryLower)) return true;
  return session.messages.some(
    (m) =>
      m.text.toLowerCase().includes(queryLower) ||
      Boolean(
        m.attachments?.some(
          (a) =>
            a.name.toLowerCase().includes(queryLower) ||
            a.textContent?.toLowerCase().includes(queryLower)
        )
      )
  );
}

function extractSearchSnippet(session: ChatSession, query: string): string | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  for (let i = session.messages.length - 1; i >= 0; i--) {
    const msg = session.messages[i];
    const clean = msg.text.replace(/\s+/g, ' ').trim();
    const idx = clean.toLowerCase().indexOf(q);
    if (idx !== -1) {
      const start = Math.max(0, idx - 22);
      const end = Math.min(clean.length, idx + q.length + 34);
      const prefix = start > 0 ? '…' : '';
      const suffix = end < clean.length ? '…' : '';
      return `${prefix}${clean.slice(start, end)}${suffix}`;
    }
    const matchedAtt = msg.attachments?.find(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.textContent?.toLowerCase().includes(q)
    );
    if (matchedAtt) {
      return `File: ${matchedAtt.name}`;
    }
  }
  return null;
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
  sessions,
  categories,
  activeSessionId,
  showFoldersAndFilters,
  isDesktopOpen,
  isMobileOpen,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  onRenameSession,
  onTogglePinSession,
  onAssignCategory,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
  onOpenSettings,
  onCloseDesktop,
  onCloseMobile,
  authUser = null,
  isAdmin = false,
  onOpenAdmin,
  onOpenAuth,
  onSignOut,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<SidebarViewMode>('recent');
  const [activeFilter, setActiveFilter] = useState<CategoryFilter>('all');
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [openMenuSessionId, setOpenMenuSessionId] = useState<string | null>(null);
  const [showMoveSubmenu, setShowMoveSubmenu] = useState(false);

  const [openMenuFolderId, setOpenMenuFolderId] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  const [folderEditor, setFolderEditor] = useState<{
    mode: 'create' | 'edit';
    categoryId?: string;
    assignToSessionId?: string | null;
    name: string;
    color: CategoryColor;
  } | null>(null);

  const sidebarRootRef = useRef<HTMLDivElement>(null);
  const renameCancelledRef = useRef(false);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('[data-sidebar-menu]')) {
        setShowFilterMenu(false);
        setOpenMenuSessionId(null);
        setShowMoveSubmenu(false);
        setOpenMenuFolderId(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowFilterMenu(false);
        setOpenMenuSessionId(null);
        setShowMoveSubmenu(false);
        setOpenMenuFolderId(null);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const categoryMap = useMemo(() => {
    const map = new Map<string, ChatCategory>();
    for (const cat of categories) {
      map.set(cat.id, cat);
    }
    return map;
  }, [categories]);

  const resolvedFilter: CategoryFilter = useMemo(() => {
    if (activeFilter === 'all' || activeFilter === 'uncategorized') {
      return activeFilter;
    }
    return categoryMap.has(activeFilter) ? activeFilter : 'all';
  }, [activeFilter, categoryMap]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let uncategorized = 0;
    for (const s of sessions) {
      if (s.categoryId && categoryMap.has(s.categoryId)) {
        counts.set(s.categoryId, (counts.get(s.categoryId) ?? 0) + 1);
      } else {
        uncategorized += 1;
      }
    }
    return { counts, uncategorized };
  }, [sessions, categoryMap]);

  const trimmedSearch = searchQuery.trim();

  const searchMatchedSessions = useMemo(() => {
    const q = trimmedSearch.toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => sessionMatchesQuery(s, q, categoryMap));
  }, [sessions, trimmedSearch, categoryMap]);

  const filteredSessions = useMemo(() => {
    if (!showFoldersAndFilters || resolvedFilter === 'all') {
      return searchMatchedSessions;
    }
    if (resolvedFilter === 'uncategorized') {
      return searchMatchedSessions.filter(
        (s) => !s.categoryId || !categoryMap.has(s.categoryId)
      );
    }
    return searchMatchedSessions.filter((s) => s.categoryId === resolvedFilter);
  }, [showFoldersAndFilters, searchMatchedSessions, resolvedFilter, categoryMap]);

  const timeGroups = useMemo(
    () => groupSessionsByTime(filteredSessions),
    [filteredSessions]
  );

  const folderGroups = useMemo(() => {
    const sorted = [...filteredSessions].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });

    const grouped = new Map<string, ChatSession[]>();
    const uncategorized: ChatSession[] = [];

    for (const s of sorted) {
      if (s.categoryId && categoryMap.has(s.categoryId)) {
        const list = grouped.get(s.categoryId) ?? [];
        list.push(s);
        grouped.set(s.categoryId, list);
      } else {
        uncategorized.push(s);
      }
    }

    const visibleCategories =
      resolvedFilter === 'all'
        ? categories
        : resolvedFilter === 'uncategorized'
          ? []
          : categories.filter((c) => c.id === resolvedFilter);

    return {
      folders: visibleCategories.map((cat) => ({
        category: cat,
        items: grouped.get(cat.id) ?? [],
      })),
      uncategorized,
      showUncategorized:
        resolvedFilter === 'all' || resolvedFilter === 'uncategorized',
    };
  }, [filteredSessions, categories, categoryMap, resolvedFilter]);

  const activeCategoryForNewChat =
    showFoldersAndFilters &&
    resolvedFilter !== 'all' &&
    resolvedFilter !== 'uncategorized'
      ? resolvedFilter
      : null;

  const activeFilterCategory =
    showFoldersAndFilters &&
    resolvedFilter !== 'all' &&
    resolvedFilter !== 'uncategorized'
      ? categoryMap.get(resolvedFilter) ?? null
      : null;

  const startEditingSession = (session: ChatSession) => {
    renameCancelledRef.current = false;
    setOpenMenuSessionId(null);
    setShowMoveSubmenu(false);
    setEditingSessionId(session.id);
    setDraftTitle(session.title);
  };

  const commitRenameSession = (id: string) => {
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false;
      setEditingSessionId(null);
      return;
    }
    const clean = draftTitle.trim();
    if (clean) {
      onRenameSession(id, clean);
    }
    setEditingSessionId(null);
  };

  const openCreateFolder = (assignToSessionId: string | null = null) => {
    setShowFilterMenu(false);
    setOpenMenuSessionId(null);
    setShowMoveSubmenu(false);
    setOpenMenuFolderId(null);
    setFolderEditor({
      mode: 'create',
      assignToSessionId,
      name: '',
      color: COLOR_ORDER[categories.length % COLOR_ORDER.length],
    });
  };

  const openEditFolder = (cat: ChatCategory) => {
    setOpenMenuFolderId(null);
    setFolderEditor({
      mode: 'edit',
      categoryId: cat.id,
      name: cat.name,
      color: cat.color,
    });
  };

  const submitFolderEditor = () => {
    if (!folderEditor) return;
    const cleanName = folderEditor.name.trim();
    if (!cleanName) return;

    if (folderEditor.mode === 'create') {
      const created = onCreateCategory(cleanName, folderEditor.color);
      if (folderEditor.assignToSessionId) {
        onAssignCategory(folderEditor.assignToSessionId, created.id);
      }
    } else if (folderEditor.categoryId) {
      onUpdateCategory(folderEditor.categoryId, {
        name: cleanName,
        color: folderEditor.color,
      });
    }
    setFolderEditor(null);
  };

  const toggleFolderCollapse = (folderKey: string) => {
    setCollapsedFolders((prev) => ({ ...prev, [folderKey]: !prev[folderKey] }));
  };

  const handleDropOnFolder = (
    e: React.DragEvent,
    targetCategoryId: string | null
  ) => {
    e.preventDefault();
    setDragOverTarget(null);
    const draggedSessionId = e.dataTransfer.getData('text/plain');
    if (draggedSessionId) {
      onAssignCategory(draggedSessionId, targetCategoryId);
    }
  };

  const renderSessionRow = (
    session: ChatSession,
    isMobileDrawer: boolean,
    showInlineMeta: boolean
  ) => {
    const isActive = session.id === activeSessionId;
    const isEditing = editingSessionId === session.id;
    const isMenuOpen = openMenuSessionId === session.id;
    const sessionCategory =
      session.categoryId && categoryMap.has(session.categoryId)
        ? categoryMap.get(session.categoryId)!
        : null;
    const catStyle = sessionCategory
      ? CATEGORY_COLOR_STYLES[sessionCategory.color]
      : null;
    const contentSnippet = trimmedSearch
      ? extractSearchSnippet(session, trimmedSearch)
      : null;

    return (
      <li
        key={session.id}
        draggable={!isEditing && showFoldersAndFilters}
        onDragStart={(e) => {
          if (!showFoldersAndFilters) return;
          e.dataTransfer.setData('text/plain', session.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        className="group relative"
      >
        {isEditing ? (
          <div className="flex min-h-[38px] items-center gap-1 rounded-xl bg-white px-2 ring-1 ring-blue-500 dark:bg-[#25272B]">
            <input
              type="text"
              value={draftTitle}
              autoFocus
              onChange={(e) => setDraftTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRenameSession(session.id);
                if (e.key === 'Escape') {
                  renameCancelledRef.current = true;
                  setEditingSessionId(null);
                }
              }}
              onBlur={() => commitRenameSession(session.id)}
              aria-label="Rename conversation"
              className="min-w-0 flex-1 bg-transparent px-1.5 py-1 text-[13px] text-slate-900 focus:outline-none dark:text-white"
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commitRenameSession(session.id)}
              aria-label="Save title"
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-zinc-700"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div
            className={`flex min-h-[38px] items-center rounded-xl transition-all ${
              isActive
                ? 'bg-white text-slate-950 shadow-xs ring-1 ring-slate-200/90 dark:bg-[#25272B] dark:text-white dark:ring-zinc-700/75'
                : 'text-slate-700 hover:bg-slate-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800/65'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                onSelectSession(session.id);
                if (isMobileDrawer) onCloseMobile();
              }}
              className="flex min-h-[38px] min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-blue-600"
            >
              {showFoldersAndFilters && sessionCategory && catStyle ? (
                <span
                  className={`h-2.5 w-1 shrink-0 rounded-full ${catStyle.swatch}`}
                  aria-hidden="true"
                />
              ) : (
                <MessageSquare
                  className={`h-3.5 w-3.5 shrink-0 ${
                    isActive
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-slate-400 dark:text-zinc-500'
                  }`}
                  aria-hidden="true"
                />
              )}
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate text-[13px] leading-snug ${
                    isActive ? 'font-semibold' : 'font-medium'
                  }`}
                >
                  {session.title}
                </div>
                {contentSnippet ? (
                  <div className="truncate text-[11px] leading-tight text-blue-600/90 dark:text-blue-400/90">
                    {contentSnippet}
                  </div>
                ) : showFoldersAndFilters && showInlineMeta && (sessionCategory || session.pinned) ? (
                  <div className="truncate text-[11px] leading-tight text-slate-500 dark:text-zinc-400">
                    {[
                      sessionCategory?.name,
                      session.pinned ? 'Pinned' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                ) : !showFoldersAndFilters && session.pinned ? (
                  <div className="truncate text-[11px] leading-tight text-slate-500 dark:text-zinc-400">
                    Pinned
                  </div>
                ) : null}
              </div>
            </button>

            <div className="flex shrink-0 items-center pr-1" data-sidebar-menu>
              {session.pinned && !isMenuOpen && (
                <Pin
                  className="mr-0.5 h-3 w-3 text-slate-400 group-hover:hidden dark:text-zinc-500"
                  aria-hidden="true"
                />
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuFolderId(null);
                  setShowFilterMenu(false);
                  if (isMenuOpen) {
                    setOpenMenuSessionId(null);
                    setShowMoveSubmenu(false);
                  } else {
                    setOpenMenuSessionId(session.id);
                    setShowMoveSubmenu(false);
                  }
                }}
                aria-expanded={isMenuOpen}
                aria-haspopup="menu"
                aria-label={`Actions for ${session.title}`}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-lg transition-opacity focus-visible:outline-2 focus-visible:outline-blue-600 ${
                  isActive || isMenuOpen
                    ? 'opacity-100'
                    : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100'
                } text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-zinc-700/70 dark:hover:text-white`}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Contextual Row Menu */}
        {isMenuOpen && (
          <div
            data-sidebar-menu
            role="menu"
            aria-label="Chat options"
            className="mt-1 mb-1.5 ml-2.5 rounded-xl border border-slate-200/90 bg-white p-1 shadow-lg dark:border-zinc-700/80 dark:bg-[#24262A]"
          >
            {showFoldersAndFilters && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setShowMoveSubmenu((prev) => !prev)}
                  className="flex min-h-[30px] w-full items-center justify-between gap-2 rounded-lg px-2.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-700/60"
                >
                  <span className="flex items-center gap-2">
                    <FolderInput className="h-3.5 w-3.5 text-slate-500 dark:text-zinc-400" />
                    <span>Move to folder</span>
                  </span>
                  <ChevronRight
                    className={`h-3.5 w-3.5 text-slate-400 transition-transform ${
                      showMoveSubmenu ? 'rotate-90' : ''
                    }`}
                  />
                </button>

                {showMoveSubmenu && (
                  <div className="my-1 ml-2.5 space-y-0.5 pl-2">
                    {categories.map((cat) => {
                      const style = CATEGORY_COLOR_STYLES[cat.color];
                      const isSelected = session.categoryId === cat.id;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            onAssignCategory(session.id, isSelected ? null : cat.id);
                            setOpenMenuSessionId(null);
                            setShowMoveSubmenu(false);
                          }}
                          className="flex min-h-[28px] w-full items-center justify-between gap-2 rounded-lg px-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-700/60"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              className={`h-2 w-2 shrink-0 rounded-[2px] ${style.swatch}`}
                              aria-hidden="true"
                            />
                            <span className="truncate">{cat.name}</span>
                          </span>
                          {isSelected && (
                            <Check className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                          )}
                        </button>
                      );
                    })}
                    {session.categoryId && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onAssignCategory(session.id, null);
                          setOpenMenuSessionId(null);
                          setShowMoveSubmenu(false);
                        }}
                        className="flex min-h-[28px] w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-700/60"
                      >
                        <span>Remove from folder</span>
                      </button>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => openCreateFolder(session.id)}
                      className="flex min-h-[28px] w-full items-center gap-1.5 rounded-lg px-2 text-left text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
                    >
                      <FolderPlus className="h-3.5 w-3.5 shrink-0" />
                      <span>New folder</span>
                    </button>
                  </div>
                )}
              </>
            )}

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onTogglePinSession(session.id);
                setOpenMenuSessionId(null);
              }}
              className="flex min-h-[30px] w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-700/60"
            >
              {session.pinned ? (
                <>
                  <PinOff className="h-3.5 w-3.5 text-slate-500 dark:text-zinc-400" />
                  <span>Unpin chat</span>
                </>
              ) : (
                <>
                  <Pin className="h-3.5 w-3.5 text-slate-500 dark:text-zinc-400" />
                  <span>Pin chat</span>
                </>
              )}
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => startEditingSession(session)}
              className="flex min-h-[30px] w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-700/60"
            >
              <Pencil className="h-3.5 w-3.5 text-slate-500 dark:text-zinc-400" />
              <span>Rename</span>
            </button>

            <div className="my-1 border-t border-slate-100 dark:border-zinc-700/70" />

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpenMenuSessionId(null);
                onDeleteSession(session.id);
              }}
              className="flex min-h-[30px] w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Delete</span>
            </button>
          </div>
        )}
      </li>
    );
  };

  const sidebarContent = (isMobileDrawer: boolean) => (
    <div
      ref={sidebarRootRef}
      className={`flex h-full flex-col border-r border-slate-200/80 bg-[#F7F8FA] text-slate-800 dark:border-zinc-800/90 dark:bg-[#17181B] dark:text-zinc-200 ${
        isMobileDrawer ? 'w-[280px] max-w-[85vw]' : 'w-[280px]'
      }`}
    >
      {/* Top Bar */}
      <div className="flex h-14 shrink-0 items-center justify-between px-3">
        <div className="flex items-center gap-2 pl-1">
          <SparkEmblem size={26} />
          <span className="font-display text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">
            {showFoldersAndFilters ? 'Workspace' : 'Chats'}
          </span>
        </div>

        <button
          type="button"
          onClick={isMobileDrawer ? onCloseMobile : onCloseDesktop}
          aria-label="Close sidebar"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
        >
          {isMobileDrawer ? (
            <X className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Primary Action, Search & Workspace-Only Organization Controls */}
      <div className="space-y-2.5 border-b border-slate-200/75 px-3 pb-3 dark:border-zinc-800/80">
        <button
          type="button"
          onClick={() => {
            onNewChat(activeCategoryForNewChat);
            if (isMobileDrawer) onCloseMobile();
          }}
          className="flex min-h-[38px] w-full items-center justify-between rounded-xl border border-slate-200/90 bg-white px-3 text-[13px] font-medium text-slate-900 shadow-2xs transition-colors hover:border-slate-300 hover:bg-slate-50/80 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-blue-600 dark:border-zinc-700/80 dark:bg-[#23252A] dark:text-zinc-100 dark:hover:border-zinc-600 dark:hover:bg-[#2A2C32]"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Plus className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            <span className="truncate">
              {activeFilterCategory
                ? `New in ${activeFilterCategory.name}`
                : 'New chat'}
            </span>
          </span>
          {activeFilterCategory && (
            <span
              className={`h-2 w-2 shrink-0 rounded-[2px] ${
                CATEGORY_COLOR_STYLES[activeFilterCategory.color].swatch
              }`}
              aria-hidden="true"
            />
          )}
        </button>

        {/* Search Conversations by Title or Content */}
        <div className="relative flex items-center">
          <Search
            className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400 dark:text-zinc-500"
            aria-hidden="true"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search titles or messages…"
            aria-label="Search conversations by title or content"
            className="h-8 w-full rounded-lg border border-slate-200/80 bg-white/80 pr-7 pl-8 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500/60 focus:bg-white focus:outline-none dark:border-zinc-800 dark:bg-[#1F2125] dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-blue-500/60 dark:focus:bg-[#25272C]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="absolute right-1.5 inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* View Mode + Filter + New Folder Row (Workspace Mode Only) */}
        {showFoldersAndFilters && (
          <div className="relative flex items-center gap-1.5" data-sidebar-menu>
            <div
              role="tablist"
              aria-label="Conversation grouping mode"
              className="inline-flex flex-1 rounded-lg bg-slate-200/70 p-0.5 dark:bg-zinc-800/90"
            >
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'recent'}
                onClick={() => setViewMode('recent')}
                className={`min-h-[28px] flex-1 rounded-md px-2 text-[11.5px] font-medium whitespace-nowrap transition-colors ${
                  viewMode === 'recent'
                    ? 'bg-white text-slate-900 shadow-2xs dark:bg-[#2D2F34] dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                Timeline
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'folders'}
                onClick={() => setViewMode('folders')}
                className={`min-h-[28px] flex-1 rounded-md px-2 text-[11.5px] font-medium whitespace-nowrap transition-colors ${
                  viewMode === 'folders'
                    ? 'bg-white text-slate-900 shadow-2xs dark:bg-[#2D2F34] dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                Folders
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setOpenMenuSessionId(null);
                setOpenMenuFolderId(null);
                setShowFilterMenu((prev) => !prev);
              }}
              aria-expanded={showFilterMenu}
              aria-haspopup="menu"
              aria-label="Filter by folder"
              title="Filter by folder"
              className={`inline-flex h-[32px] max-w-[92px] shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[11.5px] font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 ${
                resolvedFilter !== 'all'
                  ? 'border-blue-500/40 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-950/50 dark:text-blue-200'
                  : 'border-slate-200/85 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-zinc-800 dark:bg-[#212327] dark:text-zinc-300 dark:hover:border-zinc-700'
              }`}
            >
              {activeFilterCategory ? (
                <span
                  className={`h-2 w-2 shrink-0 rounded-[2px] ${
                    CATEGORY_COLOR_STYLES[activeFilterCategory.color].swatch
                  }`}
                  aria-hidden="true"
                />
              ) : (
                <Filter className="h-3 w-3 shrink-0" />
              )}
              <span className="truncate">
                {activeFilterCategory
                  ? activeFilterCategory.name
                  : resolvedFilter === 'uncategorized'
                    ? 'Unfiled'
                    : 'Filter'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => openCreateFolder(null)}
              aria-label="Create new folder"
              title="New folder"
              className="inline-flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-lg border border-slate-200/85 bg-white text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600 dark:border-zinc-800 dark:bg-[#212327] dark:text-zinc-300 dark:hover:border-zinc-700"
            >
              <FolderPlus className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            </button>

            {showFilterMenu && (
              <div
                role="menu"
                aria-label="Filter chats by folder"
                className="absolute top-9 right-0 left-0 z-30 rounded-xl border border-slate-200/90 bg-white p-1.5 shadow-xl dark:border-zinc-700/80 dark:bg-[#24262A]"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setActiveFilter('all');
                    setShowFilterMenu(false);
                  }}
                  className={`flex min-h-[30px] w-full items-center justify-between rounded-lg px-2.5 text-xs font-medium ${
                    resolvedFilter === 'all'
                      ? 'bg-slate-100 text-slate-900 dark:bg-zinc-700/70 dark:text-white'
                      : 'text-slate-700 hover:bg-slate-100/80 dark:text-zinc-200 dark:hover:bg-zinc-700/50'
                  }`}
                >
                  <span>All folders</span>
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                    {sessions.length}
                  </span>
                </button>

                {categories.length > 0 && (
                  <div className="my-1 border-t border-slate-100 dark:border-zinc-700/70" />
                )}

                {categories.map((cat) => {
                  const style = CATEGORY_COLOR_STYLES[cat.color];
                  const count = categoryCounts.counts.get(cat.id) ?? 0;
                  const isSelected = resolvedFilter === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setActiveFilter(isSelected ? 'all' : cat.id);
                        setShowFilterMenu(false);
                      }}
                      className={`flex min-h-[30px] w-full items-center justify-between gap-2 rounded-lg px-2.5 text-xs font-medium ${
                        isSelected
                          ? 'bg-slate-100 text-slate-900 dark:bg-zinc-700/70 dark:text-white'
                          : 'text-slate-700 hover:bg-slate-100/80 dark:text-zinc-200 dark:hover:bg-zinc-700/50'
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-[3px] ${style.swatch}`}
                          aria-hidden="true"
                        />
                        <span className="truncate">{cat.name}</span>
                      </span>
                      <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                        {count}
                      </span>
                    </button>
                  );
                })}

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setActiveFilter(
                      resolvedFilter === 'uncategorized' ? 'all' : 'uncategorized'
                    );
                    setShowFilterMenu(false);
                  }}
                  className={`flex min-h-[30px] w-full items-center justify-between gap-2 rounded-lg px-2.5 text-xs font-medium ${
                    resolvedFilter === 'uncategorized'
                      ? 'bg-slate-100 text-slate-900 dark:bg-zinc-700/70 dark:text-white'
                      : 'text-slate-500 hover:bg-slate-100/80 dark:text-zinc-400 dark:hover:bg-zinc-700/50'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[3px] border border-slate-300 dark:border-zinc-600" />
                    <span>Unfiled</span>
                  </span>
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                    {categoryCounts.uncategorized}
                  </span>
                </button>
              </div>
            )}
          </div>
        )}

        {(trimmedSearch || (showFoldersAndFilters && resolvedFilter !== 'all')) && (
          <div className="flex items-center justify-between px-0.5 text-[11px] text-slate-500 dark:text-zinc-400">
            <span className="tabular-nums">
              {filteredSessions.length}{' '}
              {filteredSessions.length === 1 ? 'conversation' : 'conversations'}
            </span>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setActiveFilter('all');
              }}
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Reset
            </button>
          </div>
        )}
      </div>

      {/* Inline Folder Create / Edit Form (Workspace Only) */}
      {showFoldersAndFilters && folderEditor && (
        <div className="mx-3 mt-2.5 rounded-xl border border-slate-200/90 bg-white p-2.5 shadow-sm dark:border-zinc-700 dark:bg-[#23252A]">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-800 dark:text-zinc-100">
              {folderEditor.mode === 'create' ? 'New folder' : 'Edit folder'}
            </span>
            <button
              type="button"
              onClick={() => setFolderEditor(null)}
              aria-label="Cancel folder edit"
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <input
            type="text"
            value={folderEditor.name}
            maxLength={32}
            autoFocus
            onChange={(e) =>
              setFolderEditor((prev) =>
                prev ? { ...prev, name: e.target.value } : null
              )
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitFolderEditor();
              if (e.key === 'Escape') setFolderEditor(null);
            }}
            placeholder="Folder name…"
            aria-label="Folder name"
            className="mb-2 h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder:text-zinc-500"
          />

          <div
            role="radiogroup"
            aria-label="Folder color"
            className="mb-2.5 flex items-center justify-between gap-1"
          >
            {COLOR_ORDER.map((colorKey) => {
              const style = CATEGORY_COLOR_STYLES[colorKey];
              const selected = folderEditor.color === colorKey;
              return (
                <button
                  key={colorKey}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`${style.label} color`}
                  onClick={() =>
                    setFolderEditor((prev) =>
                      prev ? { ...prev, color: colorKey } : null
                    )
                  }
                  className={`flex h-6 w-6 items-center justify-center rounded-md transition-transform ${
                    style.swatch
                  } ${
                    selected
                      ? 'scale-110 ring-2 ring-slate-900 ring-offset-1 dark:ring-white dark:ring-offset-[#23252A]'
                      : 'opacity-80 hover:opacity-100'
                  }`}
                >
                  {selected && <Check className="h-3.5 w-3.5 text-white" />}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setFolderEditor(null)}
              className="min-h-[28px] rounded-lg px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitFolderEditor}
              disabled={!folderEditor.name.trim()}
              className="min-h-[28px] rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {folderEditor.mode === 'create' ? 'Create' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Conversation List */}
      <nav
        aria-label="Conversation history"
        className="chat-scroll flex-1 overflow-y-auto px-2.5 py-2.5"
      >
        {showFoldersAndFilters && viewMode === 'folders' ? (
          <div className="space-y-2.5">
            {folderGroups.folders.map(({ category, items }) => {
              const style = CATEGORY_COLOR_STYLES[category.color];
              const isCollapsed = Boolean(collapsedFolders[category.id]);
              const isDropHover = dragOverTarget === `folder:${category.id}`;
              const isFolderMenuOpen = openMenuFolderId === category.id;

              return (
                <div key={category.id} className="relative">
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverTarget(`folder:${category.id}`);
                    }}
                    onDragLeave={() => setDragOverTarget(null)}
                    onDrop={(e) => handleDropOnFolder(e, category.id)}
                    className={`group/folder flex min-h-[32px] items-center justify-between rounded-lg px-1.5 transition-colors ${
                      isDropHover
                        ? 'bg-blue-500/15 ring-1 ring-blue-500'
                        : 'hover:bg-slate-200/55 dark:hover:bg-zinc-800/60'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleFolderCollapse(category.id)}
                      aria-expanded={!isCollapsed}
                      className="flex min-h-[32px] min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      )}
                      {isCollapsed ? (
                        <Folder
                          className={`h-3.5 w-3.5 shrink-0 ${style.iconText}`}
                          aria-hidden="true"
                        />
                      ) : (
                        <FolderOpen
                          className={`h-3.5 w-3.5 shrink-0 ${style.iconText}`}
                          aria-hidden="true"
                        />
                      )}
                      <span className="truncate text-xs font-semibold text-slate-700 dark:text-zinc-200">
                        {category.name}
                      </span>
                    </button>

                    <div className="flex shrink-0 items-center gap-1" data-sidebar-menu>
                      <span className="px-1 font-mono text-[11px] text-slate-400 tabular-nums group-hover/folder:hidden dark:text-zinc-500">
                        {items.length}
                      </span>
                      <div
                        className={`items-center gap-0.5 ${
                          isFolderMenuOpen
                            ? 'flex'
                            : 'hidden focus-within:flex group-hover/folder:flex'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onNewChat(category.id);
                            if (isMobileDrawer) onCloseMobile();
                          }}
                          aria-label={`New chat in ${category.name}`}
                          title={`New chat in ${category.name}`}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-black/5 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenuSessionId(null);
                            setShowFilterMenu(false);
                            setOpenMenuFolderId((prev) =>
                              prev === category.id ? null : category.id
                            );
                          }}
                          aria-expanded={isFolderMenuOpen}
                          aria-label={`Options for ${category.name} folder`}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-black/5 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {isFolderMenuOpen && (
                    <div
                      data-sidebar-menu
                      role="menu"
                      className="mt-1 mb-1 ml-3.5 rounded-xl border border-slate-200/90 bg-white p-1 shadow-lg dark:border-zinc-700/80 dark:bg-[#24262A]"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => openEditFolder(category)}
                        className="flex min-h-[28px] w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-700/60"
                      >
                        <Pencil className="h-3.5 w-3.5 text-slate-500" />
                        <span>Rename or change color</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOpenMenuFolderId(null);
                          onDeleteCategory(category.id);
                        }}
                        className="flex min-h-[28px] w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Delete folder</span>
                      </button>
                    </div>
                  )}

                  {!isCollapsed && (
                    <div className="mt-0.5 pl-2">
                      {items.length === 0 ? (
                        <p className="px-3 py-1.5 text-[11px] text-slate-400 dark:text-zinc-500">
                          {trimmedSearch ? 'No matches' : 'Empty folder'}
                        </p>
                      ) : (
                        <ul className="space-y-0.5">
                          {items.map((session) =>
                            renderSessionRow(session, isMobileDrawer, false)
                          )}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {folderGroups.showUncategorized &&
              (folderGroups.uncategorized.length > 0 ||
                dragOverTarget !== null) && (
                <div>
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverTarget('folder:uncategorized');
                    }}
                    onDragLeave={() => setDragOverTarget(null)}
                    onDrop={(e) => handleDropOnFolder(e, null)}
                    className={`flex min-h-[32px] items-center justify-between rounded-lg px-1.5 transition-colors ${
                      dragOverTarget === 'folder:uncategorized'
                        ? 'bg-blue-500/15 ring-1 ring-blue-500'
                        : 'hover:bg-slate-200/55 dark:hover:bg-zinc-800/60'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleFolderCollapse('__uncategorized')}
                      aria-expanded={!collapsedFolders['__uncategorized']}
                      className="flex min-h-[32px] min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      {collapsedFolders['__uncategorized'] ? (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      )}
                      <Folder
                        className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-zinc-500"
                        aria-hidden="true"
                      />
                      <span className="truncate text-xs font-semibold text-slate-600 dark:text-zinc-300">
                        Unfiled
                      </span>
                    </button>
                    <span className="px-1 font-mono text-[11px] text-slate-400 tabular-nums dark:text-zinc-500">
                      {folderGroups.uncategorized.length}
                    </span>
                  </div>

                  {!collapsedFolders['__uncategorized'] &&
                    folderGroups.uncategorized.length > 0 && (
                      <ul className="mt-0.5 space-y-0.5 pl-2">
                        {folderGroups.uncategorized.map((session) =>
                          renderSessionRow(session, isMobileDrawer, false)
                        )}
                      </ul>
                    )}
                </div>
              )}

            {folderGroups.folders.length === 0 &&
              folderGroups.uncategorized.length === 0 && (
                <p className="px-3 py-8 text-center text-xs text-slate-500 dark:text-zinc-500">
                  No conversations match this filter.
                </p>
              )}
          </div>
        ) : timeGroups.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-slate-500 dark:text-zinc-500">
            {trimmedSearch || (showFoldersAndFilters && resolvedFilter !== 'all')
              ? 'No matching conversations found.'
              : 'Your conversations will appear here.'}
          </p>
        ) : (
          <div className="space-y-4">
            {timeGroups.map((group) => (
              <div key={group.label}>
                <h2 className="px-2 pb-1 text-[10.5px] font-semibold tracking-wider text-slate-400 uppercase dark:text-zinc-500">
                  {group.label}
                </h2>
                <ul className="space-y-0.5">
                  {group.items.map((session) =>
                    renderSessionRow(session, isMobileDrawer, true)
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}
      </nav>

      {/* Bottom Utility Navigation */}
      <div className="space-y-1 border-t border-slate-200/80 px-3 py-2.5 dark:border-zinc-800/80">
        <PWAInstallButton variant="sidebar" />
        {authUser ? (
          <div className="flex min-h-[42px] items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white px-2.5 py-1.5 dark:border-zinc-800 dark:bg-[#212327]">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${
                  authUser.isAdmin
                    ? 'bg-emerald-600 dark:bg-emerald-500'
                    : 'bg-blue-600 dark:bg-blue-500'
                }`}
              >
                {(authUser.fullName || authUser.email || 'U').charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-slate-900 dark:text-zinc-100">
                  {authUser.fullName}
                </div>
                <div className="truncate text-[10.5px] text-slate-500 dark:text-zinc-400">
                  {authUser.isAdmin ? `Admin · ${authUser.email}` : authUser.email}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              aria-label="Sign out"
              title="Sign out"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-rose-600 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-rose-400"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              onOpenAuth('signin');
              if (isMobileDrawer) onCloseMobile();
            }}
            className="flex min-h-[38px] w-full items-center gap-2.5 rounded-xl px-2.5 text-[13px] font-medium text-blue-700 transition-colors hover:bg-blue-50/80 focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-blue-400 dark:hover:bg-blue-950/35"
          >
            <LogIn className="h-4 w-4 shrink-0" />
            <span>Sign in</span>
          </button>
        )}
        {isAdmin && onOpenAdmin && (
          <button
            type="button"
            onClick={() => {
              onOpenAdmin();
              if (isMobileDrawer) onCloseMobile();
            }}
            className="flex min-h-[38px] w-full items-center gap-2.5 rounded-xl px-2.5 text-[13px] font-medium text-emerald-700 transition-colors hover:bg-emerald-50/80 focus-visible:outline-2 focus-visible:outline-emerald-600 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
          >
            <Shield className="h-4 w-4 shrink-0" />
            <span>Admin Panel</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            onOpenSettings();
            if (isMobileDrawer) onCloseMobile();
          }}
          className="flex min-h-[38px] w-full items-center gap-2.5 rounded-xl px-2.5 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-200/65 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-zinc-300 dark:hover:bg-zinc-800/75 dark:hover:text-white"
        >
          <Settings className="h-4 w-4 text-slate-500 dark:text-zinc-400" />
          <span>Settings</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside
        className={`relative hidden shrink-0 overflow-hidden transition-[width] duration-150 ease-out md:block ${
          isDesktopOpen ? 'w-[280px]' : 'w-0'
        }`}
        aria-hidden={!isDesktopOpen}
      >
        {isDesktopOpen && sidebarContent(false)}
      </aside>

      {isMobileOpen && (
        <div
          className="fixed inset-0 z-50 flex md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Chat history"
        >
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-[1px]"
            onClick={onCloseMobile}
          />
          <div className="relative z-10 h-full">{sidebarContent(true)}</div>
        </div>
      )}
    </>
  );
};
