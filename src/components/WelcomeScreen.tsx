import React from 'react';
import { BookOpen, Compass, Lightbulb, PenLine } from 'lucide-react';
import type { AvatarGesture, ReasoningMode } from '../types/chat';
import { LiveAvatar2D } from './LiveAvatar2D';
import { SparkEmblem } from './SparkEmblem';

interface WelcomeScreenProps {
  gesture?: AvatarGesture;
  onSelectPrompt: (
    prompt: string,
    options?: { mode?: ReasoningMode; webSearch?: boolean }
  ) => void;
}

const CONVERSATION_STARTERS = [
  {
    icon: Lightbulb,
    title: 'Brainstorm & Ideas',
    prompt:
      'Help me brainstorm thoughtful, memorable ways to celebrate a close friend’s birthday this weekend.',
    mode: 'fast' as ReasoningMode,
    webSearch: false,
  },
  {
    icon: BookOpen,
    title: 'Explain Simply',
    prompt:
      'Explain how sleep cycles work in plain language and share practical habits to wake up feeling more rested.',
    mode: 'teacher' as ReasoningMode,
    webSearch: false,
  },
  {
    icon: PenLine,
    title: 'Write & Refine',
    prompt:
      'Help me write a warm, natural message catching up with an old colleague and suggesting coffee this week.',
    mode: 'fast' as ReasoningMode,
    webSearch: false,
  },
  {
    icon: Compass,
    title: 'Talk It Through',
    prompt:
      'I want to organize my week with less stress and clearer priorities—ask me a couple of quick questions and help me plan.',
    mode: 'fast' as ReasoningMode,
    webSearch: false,
  },
];

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  gesture = 'idle',
  onSelectPrompt,
}) => {
  return (
    <div className="flex min-h-full w-full items-center justify-center px-3 py-5 sm:px-6 sm:py-8">
      <div className="flex w-full max-w-3xl flex-col justify-center rounded-3xl border border-slate-200/80 bg-[#F8FAFD]/70 p-5 shadow-xs sm:p-7 dark:border-zinc-800/90 dark:bg-[#18191C]/80">

        <div className="mb-8 flex flex-col-reverse items-center justify-between gap-5 sm:flex-row sm:items-center">
          <div className="space-y-2.5 text-center sm:text-left">
            <div className="inline-flex items-center gap-2.5">
              <SparkEmblem size={30} />
              <span className="font-display text-sm font-medium tracking-tight text-slate-500 dark:text-zinc-400">
                Hazel · Conversation
              </span>
            </div>
            <h1 className="font-display bg-gradient-to-r from-slate-900 via-blue-700 to-indigo-600 bg-clip-text text-3xl font-semibold tracking-tight text-transparent sm:text-4xl dark:from-white dark:via-blue-300 dark:to-indigo-300">
              What would you like to talk about today?
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
              Ask questions, explore new topics, draft messages, brainstorm ideas, or switch to live voice for a natural back-and-forth chat.
            </p>
          </div>

          <div className="shrink-0 rounded-3xl border border-slate-200/80 bg-gradient-to-b from-blue-50/80 to-white/70 px-3 pt-2 shadow-2xs dark:border-zinc-800 dark:from-blue-950/25 dark:to-[#1B1C1E]">
            <LiveAvatar2D size="sm" gesture={gesture} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CONVERSATION_STARTERS.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.title}
                type="button"
                onClick={() =>
                  onSelectPrompt(card.prompt, {
                    mode: card.mode,
                    webSearch: card.webSearch,
                  })
                }
                className="group flex min-h-[88px] flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-4 text-left transition-all hover:border-blue-300 hover:bg-[#F0F4F9] active:scale-[0.995] focus-visible:outline-2 focus-visible:outline-blue-600 dark:border-zinc-800 dark:bg-[#1B1C1E] dark:hover:border-zinc-700 dark:hover:bg-[#232528]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm font-semibold text-slate-900 dark:text-zinc-100">
                    {card.title}
                  </span>
                  <Icon
                    className="h-4 w-4 shrink-0 text-blue-600 opacity-80 transition-transform group-hover:translate-x-0.5 dark:text-blue-400"
                    aria-hidden="true"
                  />
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-600 dark:text-zinc-400">
                  {card.prompt}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
