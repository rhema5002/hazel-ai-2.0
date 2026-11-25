import React from 'react';
import { ExternalLink } from 'lucide-react';
import { CodeBlock } from './CodeBlock';

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
}

function isSafeExternalUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Matches inline code, markdown links (supporting one level of balanced parens), bold, strikethrough, italic (* or _)
  const tokenRegex =
    /(`[^`]+`|\[[^\]]+\]\((?:[^()\s]+|\([^()\s]*\))+\)|\*\*[^*]+\*\*|~~[^~]+~~|\*[^*\n]+\*|(?<![\w])_[^_\n]+_(?![\w]))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${idx++}`;

    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[0.87em] text-slate-800 dark:bg-zinc-800 dark:text-zinc-200"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (linkMatch) {
        const [, label, href] = linkMatch;
        if (isSafeExternalUrl(href)) {
          nodes.push(
            <a
              key={key}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 font-medium text-blue-600 underline decoration-blue-600/30 underline-offset-2 transition-colors hover:text-blue-700 hover:decoration-blue-700 dark:text-blue-400 dark:decoration-blue-400/35 dark:hover:text-blue-300"
            >
              <span>{label}</span>
              <ExternalLink className="inline h-3 w-3 shrink-0 opacity-75" aria-hidden="true" />
            </a>
          );
        } else {
          nodes.push(label);
        }
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong key={key} className="font-semibold text-slate-950 dark:text-white">
          {renderInline(token.slice(2, -2), `${key}-b`)}
        </strong>
      );
    } else if (token.startsWith('~~') && token.endsWith('~~')) {
      nodes.push(
        <del key={key} className="text-slate-500 dark:text-zinc-400">
          {renderInline(token.slice(2, -2), `${key}-s`)}
        </del>
      );
    } else if (
      (token.startsWith('*') && token.endsWith('*')) ||
      (token.startsWith('_') && token.endsWith('_'))
    ) {
      nodes.push(
        <em key={key} className="italic">
          {renderInline(token.slice(1, -1), `${key}-i`)}
        </em>
      );
    } else {
      nodes.push(token);
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

type Block =
  | { type: 'code'; language: string; content: string }
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; content: string }
  | { type: 'hr' }
  | { type: 'blockquote'; lines: string[] }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'paragraph'; lines: string[] };

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  return /^\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(trimmed);
}

function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((cell) => cell.trim());
}

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Fenced code block (supports unclosed blocks while streaming and optional :filename)
    const fenceMatch =
      /^```([a-zA-Z0-9_.:/+-]*(?:\s+[A-Za-z0-9_./-]+)?)\s*$/.exec(trimmed);
    if (fenceMatch) {
      const language = fenceMatch[1] || '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && /^```\s*$/.test(lines[i].trim())) {
        i++;
      }
      blocks.push({ type: 'code', language, content: codeLines.join('\n') });
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Heading
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = Math.min(6, headingMatch[1].length) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ type: 'heading', level, content: headingMatch[2].trim() });
      i++;
      continue;
    }

    // Markdown table
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const headers = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', lines: quoteLines });
      continue;
    }

    // Unordered list
    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i].trim();
        if (/^[-*+]\s+/.test(current)) {
          items.push(current.replace(/^[-*+]\s+/, ''));
          i++;
        } else if (
          current !== '' &&
          !/^(#{1,6}\s+|```|>\s?|\d+\.\s+|(-{3,}|\*{3,})$)/.test(current) &&
          lines[i].startsWith('  ')
        ) {
          items[items.length - 1] += ' ' + current;
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i].trim();
        if (/^\d+\.\s+/.test(current)) {
          items.push(current.replace(/^\d+\.\s+/, ''));
          i++;
        } else if (
          current !== '' &&
          !/^(#{1,6}\s+|```|>\s?|[-*+]\s+|(-{3,}|\*{3,})$)/.test(current) &&
          lines[i].startsWith('  ')
        ) {
          items[items.length - 1] += ' ' + current;
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    // Paragraph
    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i];
      const curTrim = cur.trim();
      if (
        !curTrim ||
        /^```/.test(curTrim) ||
        /^(#{1,6})\s+/.test(curTrim) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(curTrim) ||
        curTrim.startsWith('>') ||
        /^[-*+]\s+/.test(curTrim) ||
        /^\d+\.\s+/.test(curTrim) ||
        (cur.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
      ) {
        break;
      }
      paraLines.push(cur);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', lines: paraLines });
    } else {
      i++;
    }
  }

  return blocks;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  isStreaming = false,
}) => {
  const blocks = parseBlocks(content);

  return (
    <div className="space-y-3 text-[15px] leading-[1.68] text-slate-800 dark:text-zinc-200">
      {blocks.map((block, index) => {
        const isLast = index === blocks.length - 1;
        const caret =
          isStreaming && isLast ? (
            <span
              className="animate-caret ml-1 inline-block h-4 w-1.5 translate-y-0.5 rounded-xs bg-blue-600 dark:bg-blue-400"
              aria-hidden="true"
            />
          ) : null;

        if (block.type === 'code') {
          return (
            <CodeBlock
              key={index}
              language={block.language}
              code={block.content}
            />
          );
        }

        if (block.type === 'hr') {
          return (
            <hr
              key={index}
              className="my-4 border-slate-200 dark:border-zinc-800"
            />
          );
        }

        if (block.type === 'heading') {
          const headingSizes: Record<1 | 2 | 3 | 4 | 5 | 6, string> = {
            1: 'font-display text-xl font-semibold tracking-tight text-slate-950 dark:text-white pt-1',
            2: 'font-display text-lg font-semibold tracking-tight text-slate-950 dark:text-white pt-1',
            3: 'font-display text-base font-semibold text-slate-900 dark:text-zinc-100 pt-0.5',
            4: 'text-sm font-semibold text-slate-900 dark:text-zinc-100',
            5: 'text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-zinc-200',
            6: 'text-xs font-medium text-slate-600 dark:text-zinc-300',
          };
          const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
          return (
            <Tag key={index} className={headingSizes[block.level]}>
              {renderInline(block.content, `h-${index}`)}
              {caret}
            </Tag>
          );
        }

        if (block.type === 'blockquote') {
          return (
            <blockquote
              key={index}
              className="border-l-2 border-blue-500/60 bg-slate-50/80 py-1.5 pl-3.5 pr-3 text-slate-700 dark:border-blue-400/50 dark:bg-zinc-800/40 dark:text-zinc-300"
            >
              {block.lines.map((line, lIdx) => (
                <p key={lIdx} className={lIdx > 0 ? 'mt-1' : ''}>
                  {renderInline(line, `bq-${index}-${lIdx}`)}
                </p>
              ))}
              {caret}
            </blockquote>
          );
        }

        if (block.type === 'ul') {
          return (
            <ul key={index} className="list-disc space-y-1.5 pl-5">
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx} className="pl-1">
                  {renderInline(item, `ul-${index}-${itemIdx}`)}
                  {isStreaming && isLast && itemIdx === block.items.length - 1
                    ? caret
                    : null}
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === 'ol') {
          return (
            <ol key={index} className="list-decimal space-y-1.5 pl-5">
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx} className="pl-1">
                  {renderInline(item, `ol-${index}-${itemIdx}`)}
                  {isStreaming && isLast && itemIdx === block.items.length - 1
                    ? caret
                    : null}
                </li>
              ))}
            </ol>
          );
        }

        if (block.type === 'table') {
          return (
            <div
              key={index}
              className="chat-scroll my-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-zinc-700/80"
            >
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:bg-zinc-800/80 dark:text-zinc-300">
                  <tr>
                    {block.headers.map((head, hIdx) => (
                      <th
                        key={hIdx}
                        className="border-b border-slate-200 px-3.5 py-2.5 dark:border-zinc-700/80"
                      >
                        {renderInline(head, `th-${index}-${hIdx}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/80 dark:divide-zinc-800">
                  {block.rows.map((row, rIdx) => (
                    <tr
                      key={rIdx}
                      className="hover:bg-slate-50/70 dark:hover:bg-zinc-800/35"
                    >
                      {block.headers.map((_, cIdx) => (
                        <td
                          key={cIdx}
                          className="px-3.5 py-2.5 text-slate-700 dark:text-zinc-300"
                        >
                          {renderInline(row[cIdx] ?? '', `td-${index}-${rIdx}-${cIdx}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        return (
          <p key={index} className="whitespace-pre-wrap break-words">
            {renderInline(block.lines.join('\n'), `p-${index}`)}
            {caret}
          </p>
        );
      })}
    </div>
  );
};
