import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  AudioLines,
  Brain,
  Check,
  Code2,
  FileCode2,
  FileText,
  Film,
  Globe,
  GraduationCap,
  Image as ImageIcon,
  Images,
  Mic,
  MicOff,
  Music2,
  Paperclip,
  Plus,
  Square,
  Timer,
  X,
  Zap,
} from 'lucide-react';
import type { AppView, AttachmentItem, ReasoningMode } from '../types/chat';
import { formatBytes } from '../services/chatStreamClient';
import { formatCountdownClock, parseNaturalTimerCommand } from '../utils/timerParser';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionErrorEventLike {
  error?: string;
}
interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface PromptComposerProps {
  value: string;
  attachments: AttachmentItem[];
  mode: ReasoningMode;
  webSearch: boolean;
  view?: AppView;
  isStreaming: boolean;
  attachmentError: string | null;
  onChangeValue: (val: string) => void;
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveAttachment: (id: string) => void;
  onChangeMode: (mode: ReasoningMode) => void;
  onToggleWebSearch: () => void;
  onSubmit: () => void;
  onStopStreaming: () => void;
  onOpenLiveMode: () => void;
  onOpenGallery?: () => void;
  galleryCount?: number;
}

export const PromptComposer: React.FC<PromptComposerProps> = ({
  value,
  attachments,
  mode,
  webSearch,
  view = 'chat',
  isStreaming,
  attachmentError,
  onChangeValue,
  onAddFiles,
  onRemoveAttachment,
  onChangeMode,
  onToggleWebSearch,
  onSubmit,
  onStopStreaming,
  onOpenLiveMode,
  onOpenGallery,
  galleryCount = 0,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const baseTextRef = useRef('');
  const finalizedTextRef = useRef('');

  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [dictationError, setDictationError] = useState<string | null>(null);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const plusMenuRef = useRef<HTMLDivElement>(null);

  const supportsSpeech =
    typeof window !== 'undefined' &&
    Boolean(
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
        (window as unknown as Record<string, unknown>).webkitSpeechRecognition
    );

  // Auto-grow textarea with content
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (
        plusMenuRef.current &&
        !plusMenuRef.current.contains(e.target as Node)
      ) {
        setShowPlusMenu(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      recognitionRef.current?.stop();
    };
  }, []);

  const stopDictation = () => {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        // Ignore already-stopped recognition
      }
    }
    setIsListening(false);
    setInterimText('');
  };

  const toggleVoiceDictation = () => {
    setDictationError(null);

    if (isListening) {
      stopDictation();
      return;
    }

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const RecognitionCtor = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!RecognitionCtor) {
      setDictationError(
        'Hands-free voice dictation is not supported in this browser. Try Chrome, Edge, or Safari—or use Live mode.'
      );
      return;
    }

    baseTextRef.current = value.trimEnd();
    finalizedTextRef.current = '';
    setInterimText('');

    const recognition = new RecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    recognition.onresult = (event) => {
      let newlyFinal = '';
      let currentInterim = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const piece = res[0]?.transcript ?? '';
        if (res.isFinal) {
          newlyFinal += piece;
        } else {
          currentInterim += piece;
        }
      }

      if (newlyFinal) {
        finalizedTextRef.current = `${finalizedTextRef.current} ${newlyFinal}`.trim();
      }
      setInterimText(currentInterim.trim());

      const composed = [
        baseTextRef.current,
        finalizedTextRef.current,
        currentInterim.trim(),
      ]
        .filter(Boolean)
        .join(' ');
      onChangeValue(composed);
    };

    recognition.onerror = (errEvent) => {
      const code = errEvent?.error;
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setDictationError('Microphone access was blocked. Allow microphone permission to dictate.');
      } else if (code === 'audio-capture') {
        setDictationError('No microphone was found on this device.');
      } else if (code && code !== 'aborted' && code !== 'no-speech') {
        setDictationError('Voice dictation interrupted. Please try again.');
      }
      setIsListening(false);
      setInterimText('');
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimText('');
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsListening(true);
    } catch {
      setDictationError('Could not start voice dictation.');
      setIsListening(false);
    }
  };

  const canSend =
    !isStreaming && (value.trim().length > 0 || attachments.length > 0);

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const pastedFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const f = items[i].getAsFile();
        if (f) pastedFiles.push(f);
      }
    }
    if (pastedFiles.length > 0) {
      onAddFiles(pastedFiles);
    }
  };

  const activeError = attachmentError || dictationError;
  const detectedTimer = value.trim() ? parseNaturalTimerCommand(value) : null;

  const applyCreateTemplate = (template: string) => {
    onChangeValue(template);
    setShowPlusMenu(false);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(template.length, template.length);
      }
    });
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-6 sm:pb-5">
      {activeError && (
        <p
          role="alert"
          className="mb-2 rounded-xl bg-rose-50 px-3.5 py-2 text-xs font-medium text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
        >
          {activeError}
        </p>
      )}

      <div className="rounded-[26px] border border-slate-200/90 bg-[#F0F4F9] px-3.5 pt-2.5 pb-2.5 shadow-xs transition-colors focus-within:border-blue-400/70 focus-within:bg-[#F8FAFD] focus-within:shadow-sm dark:border-zinc-700/70 dark:bg-[#1E1F20] dark:focus-within:border-zinc-600 dark:focus-within:bg-[#232528]">
        {/* Live Voice Dictation & Timer Detection Banner */}
        {(isListening || detectedTimer) && (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-blue-50/90 px-3 py-1.5 text-xs text-blue-800 dark:bg-blue-950/50 dark:text-blue-200">
            <div className="flex min-w-0 items-center gap-2">
              {isListening ? (
                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-rose-500" />
              ) : (
                <Timer className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
              )}
              <span className="truncate font-medium">
                {detectedTimer
                  ? `Timer command ready: ${detectedTimer.label} (${formatCountdownClock(detectedTimer.durationSeconds)})`
                  : interimText
                    ? `Listening: "${interimText}"`
                    : 'Listening — speak now (e.g., "Set a timer for 10 minutes")…'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {detectedTimer && !isStreaming && (
                <button
                  type="button"
                  onClick={() => {
                    if (isListening) stopDictation();
                    onSubmit();
                  }}
                  className="shrink-0 rounded-full bg-blue-600 px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-blue-700"
                >
                  Start timer
                </button>
              )}
              {isListening && (
                <button
                  type="button"
                  onClick={stopDictation}
                  className="shrink-0 rounded-full bg-slate-700 px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-slate-800"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        )}

        {/* Staged Attachments Strip */}
        {attachments.length > 0 && (
          <div className="mb-2.5 flex flex-wrap gap-2">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="relative flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-1.5 pr-2.5 text-xs text-slate-700 dark:border-zinc-700 dark:bg-[#2A2C30] dark:text-zinc-200"
              >
                {att.kind === 'image' && att.previewUrl ? (
                  <img
                    src={att.previewUrl}
                    alt={att.name}
                    className="h-10 w-10 rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 dark:bg-zinc-800">
                    {att.kind === 'pdf' ? (
                      <FileText className="h-4 w-4 text-rose-500" />
                    ) : (
                      <FileCode2 className="h-4 w-4 text-blue-500" />
                    )}
                  </div>
                )}
                <div className="min-w-0 max-w-[130px]">
                  <div className="truncate font-medium">{att.name}</div>
                  <div className="text-[11px] text-slate-400 dark:text-zinc-500">
                    {formatBytes(att.sizeBytes)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(att.id)}
                  aria-label={`Remove ${att.name}`}
                  className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-zinc-700 dark:hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Prompt Textarea */}
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => onChangeValue(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) {
                if (isListening) stopDictation();
                onSubmit();
              }
            }
          }}
          placeholder={
            mode === 'teacher'
              ? 'Ask Hazel to teach or explain anything simply…'
              : view === 'workspace'
                ? 'Build an app, explore an AI/ML concept, or debug code…'
                : 'Chat with Hazel about your day or anything on your mind…'
          }
          aria-label="Message prompt"
          className="chat-scroll max-h-[180px] w-full resize-none bg-transparent px-1.5 py-1 text-[15px] leading-relaxed text-slate-900 placeholder:text-slate-500 focus:outline-none dark:text-zinc-100 dark:placeholder:text-zinc-400 dark:caret-zinc-100"
        />

        {/* Bottom Composer Action Row */}
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="relative flex items-center gap-2" ref={plusMenuRef}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.txt,.md,.markdown,.csv,.tsv,.json,.xml,.ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.html,.htm,.css,.scss,.sql,.yaml,.yml,.toml,.ini,.env,.sh,.bash,.log,.go,.rs,.java,.c,.cpp,.h"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  onAddFiles(e.target.files);
                  e.target.value = '';
                }
              }}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => setShowPlusMenu((o) => !o)}
              aria-expanded={showPlusMenu}
              aria-haspopup="menu"
              aria-label="Open tools, search, mode, and attachments menu"
              title="Tools, search, mode & attachments"
              className={`inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 ${
                showPlusMenu
                  ? 'bg-slate-200 text-slate-900 dark:bg-zinc-700 dark:text-white'
                  : 'text-slate-600 hover:bg-slate-200/75 hover:text-slate-900 dark:text-zinc-300 dark:hover:bg-zinc-700/70 dark:hover:text-white'
              }`}
            >
              <Plus
                className={`h-5 w-5 transition-transform duration-150 ${
                  showPlusMenu ? 'rotate-45' : ''
                }`}
              />
            </button>

            {(webSearch || mode !== 'fast') && (
              <button
                type="button"
                onClick={() => setShowPlusMenu(true)}
                className="truncate text-xs font-medium text-slate-500 transition-colors hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                {[
                  mode === 'teacher'
                    ? 'Teacher'
                    : mode === 'deep'
                      ? 'Deep Think'
                      : mode === 'coder'
                        ? 'Pro Coder'
                        : null,
                  webSearch ? 'Web search' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </button>
            )}

            {showPlusMenu && (
              <div
                role="menu"
                aria-label="Composer tools and options"
                className="absolute bottom-13 left-0 z-30 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-zinc-700 dark:bg-[#222428]"
              >
                {/* File Attachments */}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowPlusMenu(false);
                    fileInputRef.current?.click();
                  }}
                  className="flex min-h-[38px] w-full items-center gap-2.5 rounded-xl px-3 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-700/70"
                >
                  <Paperclip className="h-4 w-4 text-slate-500 dark:text-zinc-400" />
                  <span>Upload image, PDF, or file</span>
                </button>

                {onOpenGallery && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowPlusMenu(false);
                      onOpenGallery();
                    }}
                    className="flex min-h-[38px] w-full items-center justify-between gap-2.5 rounded-xl px-3 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-700/70"
                  >
                    <span className="flex items-center gap-2.5">
                      <Images className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      <span>Media gallery</span>
                    </span>
                    {galleryCount > 0 && (
                      <span className="font-mono text-[11px] font-medium text-slate-400 tabular-nums dark:text-zinc-500">
                        {galleryCount}
                      </span>
                    )}
                  </button>
                )}

                {/* Web Search Toggle */}
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={webSearch}
                  onClick={() => onToggleWebSearch()}
                  className="flex min-h-[38px] w-full items-center justify-between gap-2.5 rounded-xl px-3 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-700/70"
                >
                  <span className="flex items-center gap-2.5">
                    <Globe
                      className={`h-4 w-4 ${
                        webSearch
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-slate-500 dark:text-zinc-400'
                      }`}
                    />
                    <span>Web search</span>
                  </span>
                  {webSearch && (
                    <Check className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  )}
                </button>

                <div className="my-1.5 border-t border-slate-200/70 dark:border-zinc-700/70" />

                {/* Reasoning Mode Section */}
                <div className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase dark:text-zinc-500">
                  Mode
                </div>
                <div
                  className={`grid gap-1 px-1 pb-1 ${
                    view === 'workspace' ? 'grid-cols-2' : 'grid-cols-3'
                  }`}
                >
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={mode === 'fast'}
                    onClick={() => onChangeMode('fast')}
                    className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[11px] font-medium transition-colors ${
                      mode === 'fast'
                        ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-300 dark:bg-blue-950/60 dark:text-blue-300 dark:ring-blue-700/70'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-zinc-300 dark:hover:bg-zinc-700/70'
                    }`}
                  >
                    <Zap className="h-3.5 w-3.5" />
                    <span>Fast</span>
                  </button>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={mode === 'teacher'}
                    onClick={() => onChangeMode('teacher')}
                    className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[11px] font-medium transition-colors ${
                      mode === 'teacher'
                        ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-700/70'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-zinc-300 dark:hover:bg-zinc-700/70'
                    }`}
                  >
                    <GraduationCap className="h-3.5 w-3.5" />
                    <span>Teacher</span>
                  </button>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={mode === 'deep'}
                    onClick={() => onChangeMode('deep')}
                    className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[11px] font-medium transition-colors ${
                      mode === 'deep'
                        ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-300 dark:bg-indigo-950/60 dark:text-indigo-300 dark:ring-indigo-700/70'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-zinc-300 dark:hover:bg-zinc-700/70'
                    }`}
                  >
                    <Brain className="h-3.5 w-3.5" />
                    <span>Deep</span>
                  </button>
                  {view === 'workspace' && (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={mode === 'coder'}
                      onClick={() => onChangeMode('coder')}
                      className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[11px] font-medium transition-colors ${
                        mode === 'coder'
                          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-700/70'
                          : 'text-slate-600 hover:bg-slate-100 dark:text-zinc-300 dark:hover:bg-zinc-700/70'
                      }`}
                    >
                      <Code2 className="h-3.5 w-3.5" />
                      <span>Pro Coder</span>
                    </button>
                  )}
                </div>

                <div className="my-1.5 border-t border-slate-200/70 dark:border-zinc-700/70" />

                {/* Create Section */}
                <div className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase dark:text-zinc-500">
                  Create
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => applyCreateTemplate('Create an uplifting lo-fi song about ')}
                  className="flex min-h-[36px] w-full items-center gap-2.5 rounded-xl px-3 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-700/70"
                >
                  <Music2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <span>Generate song</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => applyCreateTemplate('Generate an image of ')}
                  className="flex min-h-[36px] w-full items-center gap-2.5 rounded-xl px-3 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-700/70"
                >
                  <ImageIcon className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                  <span>Generate image</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => applyCreateTemplate('Generate an animated video of ')}
                  className="flex min-h-[36px] w-full items-center gap-2.5 rounded-xl px-3 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-700/70"
                >
                  <Film className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                  <span>Generate video</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => applyCreateTemplate('Set a timer for 10 minutes')}
                  className="flex min-h-[36px] w-full items-center gap-2.5 rounded-xl px-3 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-700/70"
                >
                  <Timer className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Set a timer</span>
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 sm:gap-1.5">

            <button
              type="button"
              onClick={toggleVoiceDictation}
              aria-label={
                isListening
                  ? 'Stop voice dictation'
                  : supportsSpeech
                    ? 'Microphone voice dictation'
                    : 'Microphone dictation unsupported in this browser'
              }
              aria-pressed={isListening}
              title={
                isListening
                  ? 'Stop microphone dictation'
                  : supportsSpeech
                    ? 'Microphone dictation'
                    : 'Voice dictation unavailable in this browser'
              }
              className={`inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 sm:h-11 sm:w-11 ${
                isListening
                  ? 'bg-rose-100 text-rose-600 ring-1 ring-rose-300 dark:bg-rose-950/60 dark:text-rose-400 dark:ring-rose-700/60'
                  : 'text-slate-600 hover:bg-slate-200/75 hover:text-slate-900 dark:text-zinc-300 dark:hover:bg-zinc-700/70 dark:hover:text-white'
              }`}
            >
              {isListening ? (
                <MicOff className="h-4.5 w-4.5" />
              ) : (
                <Mic className="h-4.5 w-4.5" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                if (isListening) stopDictation();
                onOpenLiveMode();
              }}
              aria-label="Talk to Hazel Live"
              title="Talk to Hazel Live"
              className="inline-flex h-11 items-center gap-1.5 rounded-full bg-slate-900/90 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:bg-[#2C2F36] dark:text-zinc-100 dark:hover:bg-[#383C45]"
            >
              <AudioLines className="h-4 w-4 text-blue-400" />
              <span>Live</span>
            </button>

            {isStreaming ? (
              <button
                type="button"
                onClick={onStopStreaming}
                aria-label="Stop generating"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-white transition-transform hover:bg-slate-800 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                <Square className="h-4 w-4 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (isListening) stopDictation();
                  onSubmit();
                }}
                disabled={!canSend}
                aria-label="Send message"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-blue-600 text-white transition-all hover:bg-blue-700 active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:bg-blue-500 dark:hover:bg-blue-400 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-500"
              >
                <ArrowUp className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="mt-1.5 text-center text-[11px] text-slate-400 dark:text-zinc-500">
        Hazel may make mistakes. Verify important details.
      </p>
    </div>
  );
};
