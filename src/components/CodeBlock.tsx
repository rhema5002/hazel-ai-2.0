import React, { useMemo, useState } from 'react';
import { Check, Copy, Eye, EyeOff, WrapText } from 'lucide-react';

interface CodeBlockProps {
  language: string;
  code: string;
}

type TokenKind =
  | 'comment'
  | 'string'
  | 'keyword'
  | 'type'
  | 'number'
  | 'function'
  | 'property'
  | 'tag'
  | 'operator'
  | 'plain';

interface SyntaxToken {
  kind: TokenKind;
  text: string;
}

const KEYWORDS = new Set([
  'abstract',
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'def',
  'delete',
  'do',
  'elif',
  'else',
  'enum',
  'except',
  'export',
  'extends',
  'finally',
  'fn',
  'for',
  'from',
  'func',
  'function',
  'if',
  'impl',
  'import',
  'in',
  'instanceof',
  'interface',
  'is',
  'lambda',
  'let',
  'match',
  'mut',
  'new',
  'nonlocal',
  'not',
  'of',
  'or',
  'package',
  'pass',
  'private',
  'protected',
  'pub',
  'public',
  'raise',
  'readonly',
  'return',
  'self',
  'static',
  'struct',
  'super',
  'switch',
  'this',
  'throw',
  'try',
  'type',
  'typeof',
  'use',
  'var',
  'void',
  'while',
  'with',
  'yield',
  // SQL keywords
  'select',
  'SELECT',
  'FROM',
  'WHERE',
  'INSERT',
  'INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE',
  'CREATE',
  'TABLE',
  'ALTER',
  'DROP',
  'JOIN',
  'LEFT',
  'RIGHT',
  'INNER',
  'ON',
  'GROUP',
  'BY',
  'ORDER',
  'LIMIT',
  'AS',
  'AND',
  'OR',
  'NOT',
  'NULL',
]);

const TYPES_AND_LITERALS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'NaN',
  'Infinity',
  'True',
  'False',
  'None',
  'string',
  'number',
  'boolean',
  'unknown',
  'any',
  'never',
  'object',
  'bigint',
  'symbol',
  'Promise',
  'Record',
  'Array',
  'Map',
  'Set',
  'Error',
  'React',
  'console',
  'window',
  'document',
  'Math',
  'JSON',
  'Date',
  'int',
  'float',
  'str',
  'bool',
  'list',
  'dict',
  'tuple',
  'vec',
  'Option',
  'Result',
  'String',
  'u32',
  'i32',
  'usize',
  'torch',
  'nn',
  'F',
  'np',
  'pd',
  'jax',
  'tf',
  'Tensor',
  'DataLoader',
  'Dataset',
  'Module',
  'AdamW',
]);

const TOKEN_CLASSES: Record<TokenKind, string> = {
  comment: 'italic text-slate-400 dark:text-zinc-500',
  string: 'text-emerald-700 dark:text-emerald-400',
  keyword: 'font-medium text-purple-700 dark:text-violet-400',
  type: 'text-amber-700 dark:text-amber-300',
  number: 'text-orange-600 dark:text-orange-300',
  function: 'text-blue-700 dark:text-sky-300',
  property: 'text-sky-700 dark:text-cyan-300',
  tag: 'text-rose-700 dark:text-rose-400',
  operator: 'text-slate-500 dark:text-zinc-400',
  plain: 'text-slate-800 dark:text-zinc-100',
};

function tokenizeCode(code: string, language: string): SyntaxToken[] {
  const lang = language.toLowerCase();
  const isJson = lang === 'json' || lang === 'jsonc';
  const isPythonOrShell =
    lang === 'py' ||
    lang === 'python' ||
    lang === 'bash' ||
    lang === 'sh' ||
    lang === 'zsh' ||
    lang === 'yaml' ||
    lang === 'yml' ||
    lang === 'toml';
  const isMarkup =
    lang === 'html' || lang === 'xml' || lang === 'svg' || lang === 'tsx' || lang === 'jsx';
  const isSql = lang === 'sql';

  // Single-pass ordered lexer regex (safe, linear-time, no catastrophic backtracking)
  const masterRegex =
    /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|--[^\n]*|"""[\s\S]*?"""|'''[\s\S]*?'''|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|<\/?[A-Za-z][A-Za-z0-9.-]*|\b0[xXbB][0-9a-fA-F_]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b[A-Za-z_$][A-Za-z0-9_$]*\b(?=\s*\()|\b[A-Za-z_$][A-Za-z0-9_$]*\b(?=\s*:)|@[A-Za-z_][A-Za-z0-9_-]*|\b[A-Za-z_$][A-Za-z0-9_$]*\b|[=+\-*/%<>!&|^~?:]+)/g;

  const tokens: SyntaxToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = masterRegex.exec(code)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: 'plain', text: code.slice(lastIndex, match.index) });
    }

    const text = match[0];
    let kind: TokenKind = 'plain';

    if (text.startsWith('/*') || text.startsWith('//')) {
      kind = 'comment';
    } else if (text.startsWith('#') && isPythonOrShell) {
      kind = 'comment';
    } else if (text.startsWith('--') && isSql) {
      kind = 'comment';
    } else if (text.startsWith('--') && (lang === 'bash' || lang === 'sh' || lang === 'zsh')) {
      kind = 'property';
    } else if (text.startsWith('#') && (lang === 'css' || lang === 'scss')) {
      kind = 'number';
    } else if (
      text.startsWith('"') ||
      text.startsWith("'") ||
      text.startsWith('`')
    ) {
      if (isJson && text.startsWith('"')) {
        // Peek ahead past whitespace for colon to distinguish JSON keys from values
        const rest = code.slice(masterRegex.lastIndex);
        kind = /^\s*:/.test(rest) ? 'property' : 'string';
      } else {
        kind = 'string';
      }
    } else if (text.startsWith('<') && isMarkup && /^<\/?[A-Za-z]/.test(text)) {
      kind = 'tag';
    } else if (text.startsWith('@')) {
      kind = 'keyword';
    } else if (/^\d|^0[xXbB]/.test(text)) {
      kind = 'number';
    } else if (/^[A-Za-z_$]/.test(text)) {
      const rest = code.slice(masterRegex.lastIndex);
      if (KEYWORDS.has(text) || (isSql && KEYWORDS.has(text.toUpperCase()))) {
        kind = 'keyword';
      } else if (TYPES_AND_LITERALS.has(text)) {
        kind = 'type';
      } else if (/^\s*\(/.test(rest)) {
        kind = 'function';
      } else if (/^\s*:/.test(rest)) {
        kind = 'property';
      } else if (/^[A-Z][A-Za-z0-9_]*$/.test(text)) {
        kind = 'type';
      }
    } else if (/^[=+\-*/%<>!&|^~?:]+$/.test(text)) {
      kind = 'operator';
    }

    tokens.push({ kind, text });
    lastIndex = masterRegex.lastIndex;
  }

  if (lastIndex < code.length) {
    tokens.push({ kind: 'plain', text: code.slice(lastIndex) });
  }

  return tokens;
}

function buildPreviewSrcDoc(language: string, code: string): string {
  const lang = language.toLowerCase();
  if (lang === 'svg') {
    return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:#fff;overflow:hidden;}svg{max-width:100%;max-height:100%;}</style></head><body>${code}</body></html>`;
  }
  if (lang === 'js' || lang === 'javascript') {
    const safeScript = code.replace(/<\/script>/gi, '<\\/script>');
    return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.5;color:#0f172a;background:#f8fafc;}.err{color:#dc2626;}.line{white-space:pre-wrap;word-break:break-word;border-bottom:1px solid #e2e8f0;padding:3px 0;}</style></head><body><div id="app"></div><div id="out"></div><script>(function(){const out=document.getElementById('out');function push(cls,args){const d=document.createElement('div');d.className='line '+cls;d.textContent=Array.from(args).map(a=>{if(typeof a==='object'&&a!==null){try{return JSON.stringify(a,null,2);}catch{return String(a);}}return String(a);}).join(' ');out.appendChild(d);}const origLog=console.log;const origErr=console.error;console.log=function(){push('',arguments);origLog.apply(console,arguments);};console.error=function(){push('err',arguments);origErr.apply(console,arguments);};window.addEventListener('error',function(e){push('err',[e.message||'Runtime error']);});try{\n${safeScript}\n}catch(e){push('err',[e&&e.message?e.message:String(e)]);}})();</script></body></html>`;
  }
  return code;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);
  const [wrapLines, setWrapLines] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const { normalizedLang, displayHeader } = useMemo(() => {
    const trimmed = (language || '').trim();
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx !== -1) {
      const base = trimmed.slice(0, colonIdx).trim().toLowerCase();
      const file = trimmed.slice(colonIdx + 1).trim();
      return {
        normalizedLang: base,
        displayHeader: file ? `${base} · ${file}` : base || 'code',
      };
    }
    const spaceParts = trimmed.split(/\s+/).filter(Boolean);
    if (spaceParts.length > 1) {
      const base = spaceParts[0].toLowerCase();
      const file = spaceParts.slice(1).join(' ');
      return {
        normalizedLang: base,
        displayHeader: `${base} · ${file}`,
      };
    }
    return {
      normalizedLang: trimmed.toLowerCase(),
      displayHeader: trimmed || 'code',
    };
  }, [language]);

  const canPreview =
    normalizedLang === 'html' ||
    normalizedLang === 'htm' ||
    normalizedLang === 'svg' ||
    normalizedLang === 'js' ||
    normalizedLang === 'javascript';

  const previewSrcDoc = useMemo(
    () => (showPreview && canPreview ? buildPreviewSrcDoc(normalizedLang, code) : ''),
    [showPreview, canPreview, normalizedLang, code]
  );

  const tokens = useMemo(
    () => tokenizeCode(code, normalizedLang),
    [code, normalizedLang]
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  return (
    <div className="my-3.5 overflow-hidden rounded-xl border border-slate-200 bg-[#F8FAFD] dark:border-zinc-700/80 dark:bg-[#18191C]">
      <div className="flex items-center justify-between border-b border-slate-200/80 bg-slate-100/80 px-3.5 py-1.5 text-xs text-slate-600 dark:border-zinc-700/80 dark:bg-[#222428] dark:text-zinc-300">
        <span className="truncate font-mono font-medium lowercase tracking-tight">
          {displayHeader}
        </span>

        <div className="flex items-center gap-1">
          {canPreview && (
            <button
              type="button"
              onClick={() => setShowPreview((p) => !p)}
              aria-pressed={showPreview}
              aria-label={showPreview ? 'Hide live preview' : 'Show live preview'}
              title={showPreview ? 'Hide preview' : 'Preview runnable code'}
              className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 ${
                showPreview
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'text-slate-600 hover:bg-slate-200/80 hover:text-slate-900 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-white'
              }`}
            >
              {showPreview ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              <span>{showPreview ? 'Hide' : 'Preview'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setWrapLines((w) => !w)}
            aria-pressed={wrapLines}
            aria-label={wrapLines ? 'Disable line wrapping' : 'Wrap long lines'}
            title={wrapLines ? 'Unwrap lines' : 'Wrap lines'}
            className={`inline-flex min-h-[32px] items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 ${
              wrapLines
                ? 'bg-slate-200 text-slate-900 dark:bg-zinc-700 dark:text-white'
                : 'text-slate-600 hover:bg-slate-200/80 hover:text-slate-900 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-white'
            }`}
          >
            <WrapText className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? 'Code copied' : 'Copy code'}
            className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200/80 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-white"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-emerald-700 dark:text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      <pre className="chat-scroll overflow-x-auto p-3.5 text-[13px] leading-[1.6]">
        <code
          className={`font-mono ${
            wrapLines ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
          }`}
        >
          {tokens.map((tok, i) =>
            tok.kind === 'plain' ? (
              tok.text
            ) : (
              <span key={i} className={TOKEN_CLASSES[tok.kind]}>
                {tok.text}
              </span>
            )
          )}
        </code>
      </pre>

      {showPreview && canPreview && (
        <div className="border-t border-slate-200 dark:border-zinc-700">
          <div className="bg-slate-100/70 px-3.5 py-1 text-[11px] font-medium text-slate-500 dark:bg-[#222428] dark:text-zinc-400">
            Sandboxed Preview
          </div>
          <iframe
            sandbox="allow-scripts"
            title="Live code preview"
            srcDoc={previewSrcDoc}
            className="h-64 w-full bg-white dark:bg-[#16171A]"
          />
        </div>
      )}
    </div>
  );
};
