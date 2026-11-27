import React, { memo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { VaultEntry } from '../services/piiVault';

const TOKEN_REGEX = /(\[(?:SECRET|CARD|ID|EMAIL|PHONE|IP|PERSON|CUSTOM)_\d+\])/g;
const EXACT_TOKEN_REGEX = /^\[(?:SECRET|CARD|ID|EMAIL|PHONE|IP|PERSON|CUSTOM)_\d+\]$/;

function tokenStyle(token: string): string {
  if (token.startsWith('[SECRET_')) return 'bg-rose-500/15 text-rose-300 ring-rose-500/40 hover:bg-rose-500/25';
  if (token.startsWith('[CARD_')) return 'bg-amber-500/15 text-amber-300 ring-amber-500/40 hover:bg-amber-500/25';
  if (token.startsWith('[ID_')) return 'bg-orange-500/15 text-orange-300 ring-orange-500/40 hover:bg-orange-500/25';
  if (token.startsWith('[EMAIL_')) return 'bg-sky-500/15 text-sky-300 ring-sky-500/40 hover:bg-sky-500/25';
  if (token.startsWith('[PHONE_')) return 'bg-violet-500/15 text-violet-300 ring-violet-500/40 hover:bg-violet-500/25';
  if (token.startsWith('[IP_')) return 'bg-cyan-500/15 text-cyan-300 ring-cyan-500/40 hover:bg-cyan-500/25';
  return 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40 hover:bg-emerald-500/25';
}

interface TokenChipProps {
  token: string;
  vaultLookup?: Record<string, VaultEntry>;
}

const InteractiveTokenChip: React.FC<TokenChipProps> = memo(({ token, vaultLookup }) => {
  const [peek, setPeek] = useState(false);
  const entry = vaultLookup?.[token];

  if (!entry) {
    return (
      <span
        className={`mx-0.5 inline-block rounded px-1.5 py-0.5 font-mono text-[11px] font-medium ring-1 ${tokenStyle(token)}`}
      >
        {token}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPeek((v) => !v)}
      title={peek ? 'Click to re-mask token' : 'Click to peek original value locally'}
      className={`mx-0.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] font-medium ring-1 transition ${
        peek
          ? 'bg-amber-500/20 text-amber-200 ring-amber-400/60'
          : tokenStyle(token)
      }`}
    >
      {peek ? entry.original : token}
    </button>
  );
});

InteractiveTokenChip.displayName = 'InteractiveTokenChip';

function renderInline(text: string, vaultLookup?: Record<string, VaultEntry>): React.ReactNode[] {
  const parts = text.split(
    /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[(?:SECRET|CARD|ID|EMAIL|PHONE|IP|PERSON|CUSTOM)_\d+\])/g
  );
  return parts.map((part, idx) => {
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-white">
          {renderInline(part.slice(2, -2), vaultLookup)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**') && part.length > 2) {
      return (
        <em key={idx} className="italic text-slate-300">
          {renderInline(part.slice(1, -1), vaultLookup)}
        </em>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={idx}
          className="rounded bg-slate-800/90 px-1.5 py-0.5 font-mono text-[11px] text-emerald-300"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (EXACT_TOKEN_REGEX.test(part)) {
      return <InteractiveTokenChip key={idx} token={part} vaultLookup={vaultLookup} />;
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export const HighlightedRedactedText = memo(
  ({ text, vaultLookup }: { text: string; vaultLookup?: Record<string, VaultEntry> }) => {
    const parts = text.split(TOKEN_REGEX);
    return (
      <div className="whitespace-pre-wrap break-words">
        {parts.map((part, idx) => {
          if (EXACT_TOKEN_REGEX.test(part)) {
            return <InteractiveTokenChip key={idx} token={part} vaultLookup={vaultLookup} />;
          }
          return <React.Fragment key={idx}>{part}</React.Fragment>;
        })}
      </div>
    );
  }
);

HighlightedRedactedText.displayName = 'HighlightedRedactedText';

type MdBlock =
  | { type: 'code'; lang: string; content: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'line'; raw: string };

function parseMarkdownBlocks(markdown: string): MdBlock[] {
  const lines = markdown.split('\n');
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // Fenced code block ```
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: 'code', lang, content: codeLines.join('\n') });
      i += 1;
      continue;
    }

    // Markdown table
    if (
      trimmed.includes('|') &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])
    ) {
      const splitRow = (row: string) =>
        row
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());

      const headers = splitRow(lines[i]);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().includes('|')) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    blocks.push({ type: 'line', raw: lines[i] });
    i += 1;
  }

  return blocks;
}

const CopyableCodeBlock: React.FC<{ lang: string; content: string }> = memo(({ lang, content }) => {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore clipboard error in restricted contexts
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-[#1E2733] bg-[#090C10]">
      <div className="flex items-center justify-between border-b border-[#1E2733] bg-[#0D1117] px-3 py-1">
        <span className="font-mono text-[10px] text-slate-400">{lang || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-400 transition hover:bg-slate-800 hover:text-white"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-3 font-mono text-xs leading-relaxed text-emerald-200">
        <code>{content}</code>
      </pre>
    </div>
  );
});

CopyableCodeBlock.displayName = 'CopyableCodeBlock';

export const RichOutput = memo(
  ({
    markdown,
    vaultLookup,
  }: {
    markdown: string;
    vaultLookup?: Record<string, VaultEntry>;
  }) => {
    const blocks = parseMarkdownBlocks(markdown);

    return (
      <div className="space-y-2.5 text-[13px] leading-relaxed text-slate-200">
        {blocks.map((block, i) => {
          if (block.type === 'code') {
            return <CopyableCodeBlock key={i} lang={block.lang} content={block.content} />;
          }

          if (block.type === 'table') {
            return (
              <div
                key={i}
                className="overflow-x-auto rounded-lg border border-[#1E2733] bg-[#090C10]"
              >
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#1E2733] bg-[#10151C] text-slate-300">
                      {block.headers.map((h, hi) => (
                        <th key={hi} className="px-3 py-2 font-semibold">
                          {renderInline(h, vaultLookup)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1E2733]/70">
                    {block.rows.map((row, ri) => (
                      <tr key={ri} className="hover:bg-slate-900/40">
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-3 py-2 text-slate-300">
                            {renderInline(cell, vaultLookup)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }

          const line = block.raw.trim();
          if (!line) return <div key={i} className="h-1" />;

          if (line.startsWith('### ')) {
            return (
              <h3 key={i} className="pt-2 text-sm font-semibold text-emerald-300">
                {renderInline(line.slice(4), vaultLookup)}
              </h3>
            );
          }
          if (line.startsWith('## ')) {
            return (
              <h2 key={i} className="pt-2 text-[15px] font-semibold text-white">
                {renderInline(line.slice(3), vaultLookup)}
              </h2>
            );
          }
          if (line.startsWith('# ')) {
            return (
              <h1 key={i} className="pt-2 text-base font-bold text-white">
                {renderInline(line.slice(2), vaultLookup)}
              </h1>
            );
          }
          if (line.startsWith('> ')) {
            return (
              <blockquote
                key={i}
                className="border-l-2 border-emerald-500/60 bg-emerald-500/5 py-1 pl-3 text-slate-300"
              >
                {renderInline(line.slice(2), vaultLookup)}
              </blockquote>
            );
          }
          if (/^[-*•]\s+/.test(line)) {
            return (
              <div key={i} className="flex gap-2.5 pl-1">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                <div className="flex-1">
                  {renderInline(line.replace(/^[-*•]\s+/, ''), vaultLookup)}
                </div>
              </div>
            );
          }
          const numMatch = line.match(/^(\d+)\.\s+(.*)$/);
          if (numMatch) {
            return (
              <div key={i} className="flex gap-2.5 pl-1">
                <span className="font-mono text-xs font-semibold text-sky-400">
                  {numMatch[1]}.
                </span>
                <div className="flex-1">{renderInline(numMatch[2], vaultLookup)}</div>
              </div>
            );
          }
          return <p key={i}>{renderInline(line, vaultLookup)}</p>;
        })}
      </div>
    );
  }
);

RichOutput.displayName = 'RichOutput';
