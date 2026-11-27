import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Columns2,
  Copy,
  Download,
  Eye,
  FileCode2,
  Folder,
  Globe,
  Layers,
  MessageSquareText,
  Monitor,
  Smartphone,
} from 'lucide-react';
import type {
  AttachmentItem,
  AvatarGesture,
  ChatCategory,
  ChatMessage,
  ReasoningMode,
} from '../types/chat';
import {
  buildWorkspacePreviewDoc,
  type WorkspaceArtifact,
} from '../utils/workspaceArtifacts';
import { LiveAvatar2D } from './LiveAvatar2D';
import { MessageItem } from './MessageItem';
import { PromptComposer } from './PromptComposer';

interface WorkspacePanelProps {
  artifacts: WorkspaceArtifact[];
  messages: ChatMessage[];
  activeCategory: ChatCategory | null;
  composerValue: string;
  attachments: AttachmentItem[];
  mode: ReasoningMode;
  webSearch: boolean;
  isStreaming: boolean;
  attachmentError: string | null;
  speakingMessageId: string | null;
  defaultShowThoughts: boolean;
  galleryCount: number;
  avatarGesture?: AvatarGesture;
  standbyBar?: React.ReactNode;
  onRunStarterPrompt: (
    prompt: string,
    options?: { mode?: ReasoningMode; webSearch?: boolean }
  ) => void;
  onChangeComposerValue: (val: string) => void;
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveAttachment: (id: string) => void;
  onChangeMode: (mode: ReasoningMode) => void;
  onToggleWebSearch: () => void;
  onSubmit: () => void;
  onStopStreaming: () => void;
  onOpenLiveMode: () => void;
  onOpenGallery: () => void;
  onEditUserMessage: (messageId: string, nextText: string) => void;
  onRegenerate: (assistantMessageId: string) => void;
  onToggleSpeak: (message: ChatMessage) => void;
  onFeedback: (messageId: string, vote: 'up' | 'down') => void;
  onOpenMemories?: () => void;
}

const WORKSPACE_STARTERS = [
  {
    icon: Bot,
    title: 'Build a complete AI system',
    description:
      'End-to-end Transformer LLM in PyTorch with BPE tokenizer, RoPE, KV-cache, training loop, and inference CLI.',
    prompt:
      'Build me a complete, runnable AI system: a decoder-only Transformer language model in PyTorch with a BPE tokenizer, RoPE, GQA with KV-cache, training loop with AdamW & cosine warmup, checkpointing, and interactive generation CLI.',
  },
  {
    icon: Layers,
    title: 'Build an interactive web app',
    description:
      'Self-contained HTML + Canvas neural network & gradient descent playground with live training controls.',
    prompt:
      'Build me a complete, self-contained interactive Neural Network & Decision Boundary Studio web app in a single runnable HTML code block where users can pick datasets, adjust layers/learning rate, train live, and inspect loss curves.',
  },
  {
    icon: Globe,
    title: 'Build a complete website',
    description:
      'Responsive multi-section product website with theme toggle, interactive pricing calculator, and form validation.',
    prompt:
      'Build me a complete, responsive, production-grade AI developer platform website in a single runnable HTML code block with navigation, interactive architecture tabs, live pricing estimator, dark/light toggle, and validated signup form.',
  },
];

export const WorkspacePanel: React.FC<WorkspacePanelProps> = ({
  artifacts,
  messages,
  activeCategory,
  composerValue,
  attachments,
  mode,
  webSearch,
  isStreaming,
  attachmentError,
  speakingMessageId,
  defaultShowThoughts,
  galleryCount,
  avatarGesture = 'idle',
  standbyBar,
  onRunStarterPrompt,
  onChangeComposerValue,
  onAddFiles,
  onRemoveAttachment,
  onChangeMode,
  onToggleWebSearch,
  onSubmit,
  onStopStreaming,
  onOpenLiveMode,
  onOpenGallery,
  onEditUserMessage,
  onRegenerate,
  onToggleSpeak,
  onFeedback,
  onOpenMemories,
}) => {
  const [selectedId, setSelectedId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<
    'preview' | 'code' | 'split' | 'conversation'
  >('code');
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [isComposerCollapsed, setIsComposerCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);

  const notesViewportRef = useRef<HTMLDivElement>(null);
  const notesContentRef = useRef<HTMLDivElement>(null);
  const notesAutoScrollRef = useRef(true);

  useEffect(() => {
    if (activeTab !== 'conversation') return;
    if (isStreaming) {
      notesAutoScrollRef.current = true;
    }
    const viewport = notesViewportRef.current;
    const content = notesContentRef.current;
    if (!viewport || !content || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      if (notesAutoScrollRef.current) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [activeTab, isStreaming, messages.length]);

  // Auto-select latest artifact when new ones arrive
  useEffect(() => {
    if (artifacts.length === 0) {
      setSelectedId('');
      return;
    }
    const stillExists = artifacts.some((a) => a.id === selectedId);
    const latest = artifacts[artifacts.length - 1];
    if (!stillExists) {
      setSelectedId(latest.id);
      setActiveTab(latest.isPreviewable && !latest.isStreaming ? 'preview' : 'code');
    }
  }, [artifacts, selectedId]);

  const activeArtifact = useMemo(
    () =>
      artifacts.find((a) => a.id === selectedId) ??
      artifacts[artifacts.length - 1] ??
      null,
    [artifacts, selectedId]
  );

  const lastAutoSwitchedArtifactIdRef = useRef<string>('');

  // Switch previewable artifact cleanly to live preview once when generation completes
  useEffect(() => {
    if (!activeArtifact) return;
    if (!activeArtifact.isPreviewable) {
      if (activeTab === 'preview') {
        setActiveTab('code');
      }
      return;
    }
    if (
      !activeArtifact.isStreaming &&
      lastAutoSwitchedArtifactIdRef.current !== activeArtifact.id
    ) {
      lastAutoSwitchedArtifactIdRef.current = activeArtifact.id;
      if (activeTab === 'code') {
        setActiveTab('preview');
      }
    }
  }, [
    activeArtifact?.id,
    activeArtifact?.isPreviewable,
    activeArtifact?.isStreaming,
    activeTab,
    activeArtifact,
  ]);

  const previewDoc = useMemo(() => {
    if (
      !activeArtifact ||
      !activeArtifact.isPreviewable ||
      (activeTab !== 'preview' && activeTab !== 'split')
    ) {
      return '';
    }
    return buildWorkspacePreviewDoc(activeArtifact.language, activeArtifact.code);
  }, [activeArtifact, activeTab]);

  const handleCopy = async () => {
    if (!activeArtifact) return;
    try {
      await navigator.clipboard.writeText(activeArtifact.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleDownload = () => {
    if (!activeArtifact) return;
    const blob = new Blob([activeArtifact.code], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeArtifact.title;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const latestAssistant = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i];
    }
    return null;
  }, [messages]);

  return (
    <section
      aria-label="Full Workspace Studio"
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-[#F8FAFD] dark:bg-[#141517]"
    >
      {/* Workspace Studio Top Toolbar */}
      <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b border-slate-200/80 bg-white px-2.5 py-1.5 sm:h-12 sm:flex-nowrap sm:px-4 sm:py-0 dark:border-zinc-800 dark:bg-[#1A1B1E]">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-initial sm:gap-2.5">
          <FileCode2
            className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400"
            aria-hidden="true"
          />
          {artifacts.length > 0 && activeArtifact ? (
            <select
              value={activeArtifact.id}
              onChange={(e) => {
                const next = artifacts.find((a) => a.id === e.target.value);
                setSelectedId(e.target.value);
                if (next && activeTab !== 'split') {
                  setActiveTab(next.isPreviewable ? 'preview' : 'code');
                }
              }}
              aria-label="Select generated file"
              className="min-w-0 max-w-full flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none sm:max-w-[280px] sm:flex-initial sm:px-2.5 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              {artifacts.map((art, idx) => (
                <option key={art.id} value={art.id}>
                  {idx + 1}. {art.title}
                </option>
              ))}
            </select>
          ) : (
            <span className="font-display truncate text-sm font-semibold text-slate-900 dark:text-white">
              Workspace Studio
            </span>
          )}

          {activeCategory && (
            <span className="hidden items-center gap-1.5 text-xs text-slate-500 md:inline-flex dark:text-zinc-400">
              <span aria-hidden="true">·</span>
              <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="max-w-[140px] truncate">{activeCategory.name}</span>
            </span>
          )}
        </div>

        {(activeArtifact || messages.length > 0) && (
          <div
            role="tablist"
            aria-label="Workspace view"
            className="chat-scroll order-3 flex w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-slate-100 p-0.5 sm:order-none sm:ml-auto sm:w-auto dark:bg-zinc-800"
          >
            {activeArtifact?.isPreviewable && (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'preview'}
                onClick={() => setActiveTab('preview')}
                className={`inline-flex min-h-[28px] flex-1 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium whitespace-nowrap transition-colors sm:flex-initial sm:px-2.5 ${
                  activeTab === 'preview'
                    ? 'bg-white text-slate-900 shadow-2xs dark:bg-zinc-700 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                <Eye className="h-3.5 w-3.5 shrink-0" />
                <span>Preview</span>
              </button>
            )}
            {activeArtifact && (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'code'}
                onClick={() => setActiveTab('code')}
                className={`inline-flex min-h-[28px] flex-1 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium whitespace-nowrap transition-colors sm:flex-initial sm:px-2.5 ${
                  activeTab === 'code'
                    ? 'bg-white text-slate-900 shadow-2xs dark:bg-zinc-700 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                <Code2 className="h-3.5 w-3.5 shrink-0" />
                <span>Code</span>
              </button>
            )}
            {activeArtifact && (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'split'}
                onClick={() => setActiveTab('split')}
                className={`inline-flex min-h-[28px] flex-1 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium whitespace-nowrap transition-colors sm:flex-initial sm:px-2.5 ${
                  activeTab === 'split'
                    ? 'bg-white text-slate-900 shadow-2xs dark:bg-zinc-700 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                <Columns2 className="h-3.5 w-3.5 shrink-0" />
                <span>Split</span>
              </button>
            )}
            {messages.length > 0 && (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'conversation'}
                onClick={() => setActiveTab('conversation')}
                className={`inline-flex min-h-[28px] flex-1 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium whitespace-nowrap transition-colors sm:flex-initial sm:px-2.5 ${
                  activeTab === 'conversation'
                    ? 'bg-white text-slate-900 shadow-2xs dark:bg-zinc-700 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                <MessageSquareText className="h-3.5 w-3.5 shrink-0" />
                <span>Notes</span>
                <span className="font-mono text-[10.5px] opacity-70 tabular-nums">
                  {messages.length}
                </span>
              </button>
            )}
          </div>
        )}

        <div className="order-2 flex shrink-0 items-center gap-1.5 sm:order-none">
          {activeTab === 'preview' && activeArtifact?.isPreviewable && (
            <div className="hidden items-center rounded-lg bg-slate-100 p-0.5 sm:inline-flex dark:bg-zinc-800">
              <button
                type="button"
                onClick={() => setViewport('desktop')}
                aria-label="Desktop preview width"
                aria-pressed={viewport === 'desktop'}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                  viewport === 'desktop'
                    ? 'bg-white text-slate-900 shadow-2xs dark:bg-zinc-700 dark:text-white'
                    : 'text-slate-500 hover:text-slate-800 dark:text-zinc-400'
                }`}
              >
                <Monitor className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewport('mobile')}
                aria-label="Mobile preview width"
                aria-pressed={viewport === 'mobile'}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                  viewport === 'mobile'
                    ? 'bg-white text-slate-900 shadow-2xs dark:bg-zinc-700 dark:text-white'
                    : 'text-slate-500 hover:text-slate-800 dark:text-zinc-400'
                }`}
              >
                <Smartphone className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {activeArtifact && (
            <>
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy artifact code"
                title="Copy code"
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:px-2.5 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span className="hidden md:inline">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span className="hidden md:inline">Copy</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleDownload}
                aria-label={`Download ${activeArtifact.title}`}
                title={`Download ${activeArtifact.title}`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Full-Stage Body */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === 'conversation' && messages.length > 0 ? (
          <div
            ref={notesViewportRef}
            onScroll={() => {
              const el = notesViewportRef.current;
              if (!el) return;
              notesAutoScrollRef.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 120;
            }}
            className="chat-scroll flex-1 overflow-y-auto bg-white dark:bg-[#131314]"
          >
            <div
              ref={notesContentRef}
              className="mx-auto w-full max-w-3xl space-y-6 px-3 pt-5 pb-8 sm:px-6"
            >
              {messages.map((msg) => (
                <MessageItem
                  key={msg.id}
                  message={msg}
                  isSpeaking={speakingMessageId === msg.id}
                  defaultShowThoughts={defaultShowThoughts}
                  onEditUserMessage={onEditUserMessage}
                  onRegenerate={onRegenerate}
                  onToggleSpeak={onToggleSpeak}
                  onFeedback={onFeedback}
                  onOpenMemories={onOpenMemories}
                />
              ))}
            </div>
          </div>
        ) : !activeArtifact ? (
          <div className="chat-scroll flex min-h-0 flex-1 flex-col overflow-y-auto p-2.5 sm:p-8">
            <div className="mx-auto my-auto w-full max-w-3xl space-y-4 rounded-2xl border border-slate-200/70 bg-white/75 p-4 sm:space-y-6 sm:rounded-3xl sm:p-7 dark:border-zinc-800/80 dark:bg-[#18191C]/80">
              {isStreaming && latestAssistant ? (
                <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-zinc-800 dark:bg-[#1C1D20]">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                      Building in Workspace…
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('conversation')}
                      className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"
                    >
                      View full progress
                    </button>
                  </div>
                  <p className="line-clamp-4 text-xs leading-relaxed text-slate-600 dark:text-zinc-300">
                    {latestAssistant.text ||
                      latestAssistant.thoughts ||
                      'Architecting complete implementation…'}
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex flex-col-reverse items-center justify-between gap-4 sm:flex-row sm:items-center">
                    <div className="space-y-1.5 text-center sm:text-left">
                      <h2 className="font-display text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl dark:text-white">
                        Hazel Build Workspace
                      </h2>
                      <p className="max-w-2xl text-[13px] leading-relaxed text-slate-600 sm:text-sm dark:text-zinc-400">
                        Organize projects into folders on the left, filter by topic, and build complete AI systems, web apps, or websites with live preview and file export here.
                      </p>
                    </div>
                    <div className="shrink-0 rounded-2xl border border-rose-200/80 bg-gradient-to-b from-rose-50/80 to-white/75 px-3 pt-2 shadow-2xs dark:border-rose-900/40 dark:from-rose-950/25 dark:to-[#1C1D20]">
                      <LiveAvatar2D size="sm" gesture={avatarGesture} appearance="red" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5 sm:gap-3 md:grid-cols-3">
                    {WORKSPACE_STARTERS.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.title}
                          type="button"
                          onClick={() =>
                            onRunStarterPrompt(item.prompt, {
                              mode: 'coder',
                              webSearch: false,
                            })
                          }
                          className="flex flex-col items-start gap-2 rounded-2xl border border-slate-200/90 bg-white p-3.5 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/25 sm:gap-2.5 sm:p-4 dark:border-zinc-800 dark:bg-[#1C1D20] dark:hover:border-zinc-700 dark:hover:bg-[#222428]"
                        >
                          <Icon
                            className="h-5 w-5 text-blue-600 dark:text-blue-400"
                            aria-hidden="true"
                          />
                          <div>
                            <div className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                              {item.title}
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-zinc-400">
                              {item.description}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : activeTab === 'split' ? (
          <div className="chat-scroll flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
            {/* Left Pane: Code */}
            <div className="chat-scroll min-h-[240px] min-w-0 shrink-0 overflow-auto border-b border-slate-200/80 bg-[#F8FAFD] p-3 sm:p-4 md:h-auto md:min-h-0 md:w-1/2 md:shrink md:border-r md:border-b-0 dark:border-zinc-800 dark:bg-[#141517]">
              <div className="mb-2.5 flex items-center justify-between text-xs text-slate-500 dark:text-zinc-400">
                <span className="font-mono">
                  {activeArtifact.title} · {activeArtifact.language}
                </span>
                <span className="font-mono tabular-nums">
                  {activeArtifact.code.split('\n').length} lines
                </span>
              </div>
              <pre className="overflow-x-auto rounded-2xl border border-slate-200/90 bg-white p-3 font-mono text-[12.5px] leading-[1.6] text-slate-800 sm:p-4 sm:text-[13px] sm:leading-[1.65] dark:border-zinc-800 dark:bg-[#1A1B1E] dark:text-zinc-100">
                <code>{activeArtifact.code}</code>
              </pre>
            </div>

            {/* Right / Bottom Pane: Live Preview or Notes */}
            <div className="flex min-h-[340px] min-w-0 flex-1 flex-col overflow-auto bg-slate-100/75 p-2 sm:p-3 md:h-auto md:min-h-0 md:w-1/2 dark:bg-[#101113]">
              {activeArtifact.isPreviewable ? (
                <iframe
                  sandbox="allow-scripts"
                  title={`Workspace split preview: ${activeArtifact.title}`}
                  srcDoc={previewDoc}
                  className="h-full min-h-[320px] w-full flex-1 rounded-xl border border-slate-200/90 bg-white shadow-sm md:min-h-0 dark:border-zinc-700 dark:bg-[#16171A]"
                />
              ) : (
                <div className="chat-scroll flex-1 overflow-y-auto rounded-2xl bg-white p-3 sm:p-4 dark:bg-[#131314]">
                  <div className="space-y-5">
                    {messages.map((msg) => (
                      <MessageItem
                        key={msg.id}
                        message={msg}
                        isSpeaking={speakingMessageId === msg.id}
                        defaultShowThoughts={defaultShowThoughts}
                        onEditUserMessage={onEditUserMessage}
                        onRegenerate={onRegenerate}
                        onToggleSpeak={onToggleSpeak}
                        onFeedback={onFeedback}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'preview' && activeArtifact.isPreviewable ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-slate-100/75 p-1 sm:p-4 dark:bg-[#101113]">
            <div
              className={`h-full ${
                viewport === 'mobile' ? 'w-[390px] max-w-full' : 'w-full'
              }`}
            >
              <iframe
                sandbox="allow-scripts"
                title={`Workspace preview: ${activeArtifact.title}`}
                srcDoc={previewDoc}
                className="h-full w-full rounded-xl border border-slate-200/90 bg-white shadow-sm dark:border-zinc-700 dark:bg-[#16171A]"
              />
            </div>
          </div>
        ) : (
          <div className="chat-scroll flex-1 overflow-auto bg-[#F8FAFD] p-2.5 sm:p-6 dark:bg-[#141517]">
            <div className="mx-auto w-full max-w-5xl">
              <div className="mb-2.5 flex items-center justify-between text-xs text-slate-500 dark:text-zinc-400">
                <span className="font-mono">
                  {activeArtifact.title} · {activeArtifact.language}
                </span>
                <span className="font-mono tabular-nums">
                  {activeArtifact.code.split('\n').length} lines
                </span>
              </div>
              <pre className="overflow-x-auto rounded-2xl border border-slate-200/90 bg-white p-3 font-mono text-[12.5px] leading-[1.6] text-slate-800 sm:p-4 sm:text-[13px] sm:leading-[1.65] dark:border-zinc-800 dark:bg-[#1A1B1E] dark:text-zinc-100">
                <code>{activeArtifact.code}</code>
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Standby Voice Bar + Collapsible Docked Composer */}
      {standbyBar}
      <div className="border-t border-slate-200/70 bg-white/90 backdrop-blur-xs dark:border-zinc-800/80 dark:bg-[#161719]/95">
        <div className="flex items-center justify-center border-b border-slate-200/50 py-1 dark:border-zinc-800/60">
          <button
            type="button"
            onClick={() => setIsComposerCollapsed((prev) => !prev)}
            aria-expanded={!isComposerCollapsed}
            aria-label={
              isComposerCollapsed
                ? 'Expand workspace prompt bar'
                : 'Collapse workspace prompt bar for larger view'
            }
            className="inline-flex min-h-[28px] items-center gap-1 rounded-full px-3 py-0.5 text-[11.5px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            {isComposerCollapsed ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                <span>Show prompt bar</span>
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                <span>Minimize prompt bar</span>
              </>
            )}
          </button>
        </div>

        {!isComposerCollapsed && (
          <PromptComposer
            value={composerValue}
            attachments={attachments}
            mode={mode}
            webSearch={webSearch}
            view="workspace"
            isStreaming={isStreaming}
            attachmentError={attachmentError}
            onChangeValue={onChangeComposerValue}
            onAddFiles={onAddFiles}
            onRemoveAttachment={onRemoveAttachment}
            onChangeMode={onChangeMode}
            onToggleWebSearch={onToggleWebSearch}
            onSubmit={onSubmit}
            onStopStreaming={onStopStreaming}
            onOpenLiveMode={onOpenLiveMode}
            onOpenGallery={onOpenGallery}
            galleryCount={galleryCount}
          />
        )}
      </div>
    </section>
  );
};
