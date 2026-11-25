import React, { useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileCode2,
  FileText,
  Globe,
  Pencil,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { ChatMessage } from '../types/chat';
import { useTypingEffect } from '../hooks/useTypingEffect';
import { formatBytes } from '../services/chatStreamClient';
import { ImageWidget, SongWidget, VideoWidget } from './CreativeMediaWidgets';
import { MarkdownRenderer } from './MarkdownRenderer';
import { MemoryWidget } from './MemoryWidget';
import { SparkEmblem } from './SparkEmblem';
import { TimerWidget } from './TimerWidget';

function isSafeSourceUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

interface MessageItemProps {
  message: ChatMessage;
  isSpeaking: boolean;
  defaultShowThoughts?: boolean;
  onEditUserMessage: (messageId: string, nextText: string) => void;
  onRegenerate: (assistantMessageId: string) => void;
  onToggleSpeak: (message: ChatMessage) => void;
  onFeedback: (messageId: string, vote: 'up' | 'down') => void;
  onOpenMemories?: () => void;
}

export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  isSpeaking,
  defaultShowThoughts = false,
  onEditUserMessage,
  onRegenerate,
  onToggleSpeak,
  onFeedback,
  onOpenMemories,
}) => {
  const [copied, setCopied] = useState(false);
  const [showThoughts, setShowThoughts] = useState(defaultShowThoughts);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.text);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  if (message.role === 'user') {
    const submitEdit = () => {
      const trimmed = editDraft.trim();
      if (!trimmed) return;
      setIsEditing(false);
      onEditUserMessage(message.id, trimmed);
    };

    return (
      <div className="group flex flex-col items-end gap-1.5">
        {isEditing ? (
          <div className="w-full max-w-2xl rounded-2xl border border-blue-500/50 bg-[#F0F4F9] p-3.5 dark:border-blue-400/40 dark:bg-[#242629]">
            <textarea
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              rows={3}
              aria-label="Edit prompt"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submitEdit();
                } else if (e.key === 'Escape') {
                  setIsEditing(false);
                  setEditDraft(message.text);
                }
              }}
              className="w-full resize-y bg-transparent text-[15px] leading-relaxed text-slate-900 focus:outline-none dark:text-zinc-100"
            />
            <div className="mt-2.5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsEditing(false);
                  setEditDraft(message.text);
                }}
                className="min-h-[38px] rounded-full px-4 text-xs font-medium text-slate-600 hover:bg-slate-200/70 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitEdit}
                disabled={!editDraft.trim()}
                className="min-h-[38px] rounded-full bg-blue-600 px-4 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-400"
              >
                Update &amp; send
              </button>
            </div>
          </div>
        ) : (
          <>
            {message.attachments && message.attachments.length > 0 && (
              <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
                {message.attachments.map((att) =>
                  att.kind === 'image' && att.previewUrl ? (
                    <img
                      key={att.id}
                      src={att.previewUrl}
                      alt={att.name}
                      className="max-h-48 max-w-[220px] rounded-2xl border border-slate-200 object-cover shadow-xs dark:border-zinc-700"
                    />
                  ) : (
                    <div
                      key={att.id}
                      className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                    >
                      {att.kind === 'pdf' ? (
                        <FileText className="h-4 w-4 shrink-0 text-rose-500" />
                      ) : (
                        <FileCode2 className="h-4 w-4 shrink-0 text-blue-500" />
                      )}
                      <span className="max-w-[160px] truncate font-medium">
                        {att.name}
                      </span>
                      <span className="text-slate-400 dark:text-zinc-500">
                        {formatBytes(att.sizeBytes)}
                      </span>
                    </div>
                  )
                )}
              </div>
            )}

            {message.text && (
              <div className="max-w-[88%] rounded-[22px] rounded-tr-md bg-[#F0F4F9] px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap break-words text-slate-900 sm:max-w-[78%] dark:bg-[#282A2C] dark:text-zinc-100">
                {message.text}
              </div>
            )}

            <div className="flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy prompt"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditDraft(message.text);
                  setIsEditing(true);
                }}
                aria-label="Edit prompt"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  const isAssistant = message.role === 'assistant';
  const { displayedText, isTyping } = useTypingEffect(
    isAssistant ? message.text : '',
    Boolean(isAssistant && message.isStreaming),
    isAssistant
  );

  const hasThoughts = Boolean(message.thoughts && message.thoughts.trim().length > 0);
  const showThinkingAccordion = hasThoughts || Boolean(message.isThinking);
  const safeSources = (message.sources ?? []).filter((src) => isSafeSourceUrl(src.url));
  const hasSources = safeSources.length > 0;
  const isTypingActive = Boolean(message.isStreaming) || isTyping;

  return (
    <div className="flex items-start gap-3 sm:gap-4">
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
        <SparkEmblem size={34} streaming={isTypingActive} />
      </div>

      <div className="min-w-0 flex-1 space-y-2.5">
        {/* Collapsible Thinking Drawer */}
        {showThinkingAccordion && (
          <div className="rounded-xl border border-slate-200/80 bg-[#F8FAFD] dark:border-zinc-800 dark:bg-[#1B1C1E]">
            <button
              type="button"
              onClick={() => setShowThoughts((prev) => !prev)}
              aria-expanded={showThoughts}
              className="flex min-h-[40px] w-full items-center justify-between px-3.5 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              <span className="flex items-center gap-2">
                <span>
                  {message.isThinking && !message.text
                    ? 'Thinking…'
                    : showThoughts
                      ? 'Hide thinking'
                      : 'Show thinking'}
                </span>
              </span>
              {showThoughts ? (
                <ChevronUp className="h-4 w-4 shrink-0" />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0" />
              )}
            </button>
            {showThoughts && (
              <div className="border-t border-slate-200/70 px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap text-slate-600 dark:border-zinc-800 dark:text-zinc-400">
                {message.thoughts?.trim() || 'Reasoning through your request…'}
              </div>
            )}
          </div>
        )}

        {/* Loading placeholder before first typed character */}
        {isTypingActive && !displayedText && (!message.widgets || message.widgets.length === 0) && !message.error && (
          <div className="space-y-2 py-1" aria-label="Generating response">
            <div className="h-3.5 w-3/4 animate-pulse rounded-full bg-slate-200/80 dark:bg-zinc-800" />
            <div className="h-3.5 w-1/2 animate-pulse rounded-full bg-slate-200/60 dark:bg-zinc-800/70" />
          </div>
        )}

        {/* Interactive Tool Widgets (Timers, Songs, Images, Videos) */}
        {message.widgets && message.widgets.length > 0 && (
          <div className="space-y-2.5">
            {message.widgets.map((widget) => {
              if (widget.kind === 'timer') {
                return <TimerWidget key={widget.id} timer={widget} />;
              }
              if (widget.kind === 'song') {
                return <SongWidget key={widget.id} data={widget} />;
              }
              if (widget.kind === 'image') {
                return <ImageWidget key={widget.id} data={widget} />;
              }
              if (widget.kind === 'video') {
                return <VideoWidget key={widget.id} data={widget} />;
              }
              if (widget.kind === 'memory') {
                return (
                  <MemoryWidget
                    key={widget.id}
                    data={widget}
                    onOpenMemories={onOpenMemories}
                  />
                );
              }
              return null;
            })}
          </div>
        )}

        {/* Main Markdown Answer */}
        {displayedText && (
          <MarkdownRenderer
            content={displayedText}
            isStreaming={isTypingActive}
          />
        )}

        {/* Error Box */}
        {message.error && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/90 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/35 dark:text-rose-200"
          >
            <div className="flex items-center gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{message.error}</span>
            </div>
            <button
              type="button"
              onClick={() => onRegenerate(message.id)}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-rose-600 px-3.5 text-xs font-medium text-white hover:bg-rose-700"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Try again</span>
            </button>
          </div>
        )}

        {/* Grounded Web Sources */}
        {hasSources && (
          <div className="pt-1">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-zinc-400">
              <Globe className="h-3.5 w-3.5" />
              <span>Sources</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {safeSources.map((src, idx) => {
                let host = src.title;
                try {
                  host = new URL(src.url).hostname.replace(/^www\./, '');
                } catch {
                  // Keep title fallback
                }
                return (
                  <a
                    key={`${src.url}-${idx}`}
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[34px] max-w-[240px] items-center gap-1.5 rounded-full border border-slate-200 bg-[#F8FAFD] px-3 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50/60 dark:border-zinc-700/80 dark:bg-[#1E1F20] dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                  >
                    <span className="truncate">{src.title || host}</span>
                    <span className="shrink-0 text-[11px] text-slate-400 dark:text-zinc-500">
                      · {host}
                    </span>
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {/* Turn Action Toolbar */}
        {!isTypingActive && message.text && (
          <div className="flex flex-wrap items-center gap-1 pt-0.5 text-slate-500 dark:text-zinc-400">
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy response"
              title="Copy"
              className="inline-flex h-10 min-w-[40px] items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600 dark:hover:bg-zinc-800 dark:hover:text-white"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-emerald-700 dark:text-emerald-400">Copied</span>
                </>
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>

            <button
              type="button"
              onClick={() => onToggleSpeak(message)}
              aria-label={isSpeaking ? 'Stop reading aloud' : 'Read aloud'}
              title={isSpeaking ? 'Stop reading' : 'Read aloud'}
              className={`inline-flex h-10 min-w-[40px] items-center justify-center rounded-full px-2.5 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600 dark:hover:bg-zinc-800 dark:hover:text-white ${
                isSpeaking ? 'text-blue-600 dark:text-blue-400' : ''
              }`}
            >
              {isSpeaking ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </button>

            <button
              type="button"
              onClick={() => onRegenerate(message.id)}
              aria-label="Regenerate response"
              title="Regenerate"
              className="inline-flex h-10 min-w-[40px] items-center justify-center rounded-full px-2.5 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600 dark:hover:bg-zinc-800 dark:hover:text-white"
            >
              <RotateCcw className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => onFeedback(message.id, 'up')}
              aria-label="Good response"
              aria-pressed={message.feedback === 'up'}
              title="Good response"
              className={`inline-flex h-10 min-w-[40px] items-center justify-center rounded-full px-2.5 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600 dark:hover:bg-zinc-800 dark:hover:text-white ${
                message.feedback === 'up'
                  ? 'text-blue-600 dark:text-blue-400'
                  : ''
              }`}
            >
              <ThumbsUp className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => onFeedback(message.id, 'down')}
              aria-label="Needs improvement"
              aria-pressed={message.feedback === 'down'}
              title="Needs improvement"
              className={`inline-flex h-10 min-w-[40px] items-center justify-center rounded-full px-2.5 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600 dark:hover:bg-zinc-800 dark:hover:text-white ${
                message.feedback === 'down'
                  ? 'text-rose-600 dark:text-rose-400'
                  : ''
              }`}
            >
              <ThumbsDown className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
