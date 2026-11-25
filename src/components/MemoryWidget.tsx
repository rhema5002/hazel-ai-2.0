import React from 'react';
import { BookmarkCheck, BookmarkMinus } from 'lucide-react';
import type { MemoryWidgetData } from '../types/chat';

interface MemoryWidgetProps {
  data: MemoryWidgetData;
  onOpenMemories?: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  preference: 'Preference',
  fact: 'Fact',
  project: 'Project',
  goal: 'Goal',
  person: 'Person',
  general: 'Note',
};

export const MemoryWidget: React.FC<MemoryWidgetProps> = ({
  data,
  onOpenMemories,
}) => {
  const isSaved = data.action === 'saved';
  const catLabel = CATEGORY_LABELS[data.category] ?? 'Note';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/90 bg-[#F8FAFD] px-3.5 py-2.5 text-xs dark:border-zinc-800 dark:bg-[#1B1C1E]">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        {isSaved ? (
          <BookmarkCheck
            className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
        ) : (
          <BookmarkMinus
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 font-medium">
            <span
              className={
                isSaved
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400'
              }
            >
              {isSaved ? 'Saved to memory' : 'Removed from memory'}
            </span>
            <span aria-hidden="true" className="text-slate-400 dark:text-zinc-500">
              ·
            </span>
            <span className="text-slate-500 dark:text-zinc-400">{catLabel}</span>
          </div>
          <p className="mt-0.5 break-words text-slate-700 dark:text-zinc-200">
            {data.content}
          </p>
        </div>
      </div>

      {onOpenMemories && (
        <button
          type="button"
          onClick={onOpenMemories}
          className="shrink-0 text-xs font-medium text-blue-600 whitespace-nowrap hover:underline dark:text-blue-400"
        >
          Manage
        </button>
      )}
    </div>
  );
};
