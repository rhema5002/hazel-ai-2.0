import type { ChatMessage } from '../types/chat';

export interface WorkspaceArtifact {
  id: string;
  title: string;
  language: string;
  code: string;
  isPreviewable: boolean;
  messageId: string;
  isStreaming: boolean;
}

const PREVIEWABLE_LANGS = new Set(['html', 'htm', 'svg', 'js', 'javascript']);

const LANG_EXTENSIONS: Record<string, string> = {
  html: 'html',
  htm: 'html',
  svg: 'svg',
  js: 'js',
  javascript: 'js',
  ts: 'ts',
  typescript: 'ts',
  tsx: 'tsx',
  jsx: 'jsx',
  py: 'py',
  python: 'py',
  css: 'css',
  json: 'json',
  sql: 'sql',
  bash: 'sh',
  sh: 'sh',
  rust: 'rs',
  rs: 'rs',
  go: 'go',
  cpp: 'cpp',
  c: 'c',
  yaml: 'yaml',
  yml: 'yml',
  md: 'md',
};

function detectFilename(
  infoString: string,
  code: string,
  precedingText: string,
  fallbackIndex: number
): { language: string; title: string } {
  const cleanInfo = infoString.trim();
  let language = cleanInfo.toLowerCase();
  let explicitName = '';

  // Support ```python:train.py or ```ts src/index.ts
  const colonIdx = cleanInfo.indexOf(':');
  if (colonIdx !== -1) {
    language = cleanInfo.slice(0, colonIdx).trim().toLowerCase();
    explicitName = cleanInfo.slice(colonIdx + 1).trim();
  } else if (cleanInfo.includes(' ')) {
    const parts = cleanInfo.split(/\s+/);
    language = parts[0].toLowerCase();
    explicitName = parts.slice(1).join(' ').trim();
  }

  // Check first line comment for filename (e.g. // app.ts, # model.py, <!-- index.html -->)
  if (!explicitName) {
    const firstLine = code.split('\n')[0]?.trim() ?? '';
    const commentFileMatch =
      /^(?:\/\/|#|<!--)\s*([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)\s*(?:-->)?$/.exec(
        firstLine
      );
    if (commentFileMatch) {
      explicitName = commentFileMatch[1];
    }
  }

  // Check preceding markdown line for `filename.ext` or **filename.ext**
  if (!explicitName && precedingText) {
    const tail = precedingText.trim().split('\n').slice(-2).join(' ');
    const fileMention =
      /(?:`|###?\s*|\*\*)([A-Za-z0-9_./-]+\.(?:html|htm|tsx|ts|jsx|js|py|css|json|sql|rs|go|cpp|c|sh|yaml|yml|svg|md))(?:`|\*\*|\s|$)/i.exec(
        tail
      );
    if (fileMention) {
      explicitName = fileMention[1];
    }
  }

  const ext = LANG_EXTENSIONS[language] || (language || 'txt');
  const title =
    explicitName ||
    (language === 'html' || language === 'htm'
      ? `index${fallbackIndex > 1 ? `-${fallbackIndex}` : ''}.html`
      : language === 'python' || language === 'py'
        ? `main${fallbackIndex > 1 ? `_${fallbackIndex}` : ''}.py`
        : `file-${fallbackIndex}.${ext}`);

  return { language: language || 'text', title };
}

export function extractWorkspaceArtifacts(
  messages: ChatMessage[]
): WorkspaceArtifact[] {
  const artifacts: WorkspaceArtifact[] = [];
  let counter = 0;

  for (const msg of messages) {
    if (msg.role !== 'assistant' || !msg.text) continue;
    const lines = msg.text.replace(/\r\n/g, '\n').split('\n');
    let i = 0;
    let blockIdx = 0;
    let precedingBuffer: string[] = [];

    while (i < lines.length) {
      const trimmed = lines[i].trim();
      const fenceMatch = /^```([A-Za-z0-9_.:/+-]*(?:\s+[A-Za-z0-9_./-]+)?)\s*$/.exec(
        trimmed
      );
      if (fenceMatch) {
        const info = fenceMatch[1] || '';
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length && /^```\s*$/.test(lines[i].trim())) {
          i++;
        }
        const code = codeLines.join('\n');
        if (code.trim().length > 0) {
          counter += 1;
          blockIdx += 1;
          const { language, title } = detectFilename(
            info,
            code,
            precedingBuffer.join('\n'),
            counter
          );
          artifacts.push({
            id: `${msg.id}-code-${blockIdx}`,
            title,
            language,
            code,
            isPreviewable: PREVIEWABLE_LANGS.has(language),
            messageId: msg.id,
            isStreaming: Boolean(msg.isStreaming),
          });
        }
        precedingBuffer = [];
        continue;
      }

      precedingBuffer.push(lines[i]);
      if (precedingBuffer.length > 4) {
        precedingBuffer.shift();
      }
      i++;
    }
  }

  return artifacts;
}

export function buildWorkspacePreviewDoc(language: string, code: string): string {
  const lang = language.toLowerCase();
  if (lang === 'svg') {
    return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:#fff;overflow:hidden;}svg{max-width:100%;max-height:100%;}</style></head><body>${code}</body></html>`;
  }
  if (lang === 'js' || lang === 'javascript') {
    const safeScript = code.replace(/<\/script>/gi, '<\\/script>');
    return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.6;color:#0f172a;background:#f8fafc;}.err{color:#dc2626;}.line{white-space:pre-wrap;word-break:break-word;border-bottom:1px solid #e2e8f0;padding:4px 0;}</style></head><body><div id="app"></div><div id="out"></div><script>(function(){const out=document.getElementById('out');function push(cls,args){const d=document.createElement('div');d.className='line '+cls;d.textContent=Array.from(args).map(a=>{if(typeof a==='object'&&a!==null){try{return JSON.stringify(a,null,2);}catch{return String(a);}}return String(a);}).join(' ');out.appendChild(d);}const origLog=console.log;const origErr=console.error;console.log=function(){push('',arguments);origLog.apply(console,arguments);};console.error=function(){push('err',arguments);origErr.apply(console,arguments);};window.addEventListener('error',function(e){push('err',[e.message||'Runtime error']);});try{\n${safeScript}\n}catch(e){push('err',[e&&e.message?e.message:String(e)]);}})();</script></body></html>`;
  }
  return code;
}
