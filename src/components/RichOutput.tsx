import React, { memo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { VaultEntry } from '../services/piiVault';

const TOKEN_REGEX = /(\[(?:SECRET|CARD|ID|EMAIL|PHONE|IP|PERSON|CUSTOM)_\d+\])/g;
const EXACT_TOKEN_REGEX = /^\[(?:SECRET|CARD|ID|EMAIL|PHONE|IP|PERSON|CUSTOM)_\d+\]$/;

/**
 * Calm Notion-style inline pill colors (subtle pastel in Light mode, muted tint in Dark mode).
 */
function tokenStyle(token: string): string {
  if (token.startsWith('[SECRET_'))
    return 'bg-[#FBE4E4] text-[#9B2C2C] dark:bg-[#3A2222] dark:text-[#FCA5A5]';
  if (token.startsWith('[CARD_'))
    return 'bg-[#FAEBDD] text-[#9A4D0B] dark:bg-[#38291A] dark:text-[#FCD34D]';
  if (token.startsWith('[ID_'))
    return 'bg-[#FBF3DB] text-[#8A5A00] dark:bg-[#352C18] dark:text-[#FDE68A]';
  if (token.startsWith('[EMAIL_'))
    return 'bg-[#DDEBF1] text-[#1D5B79] dark:bg-[#1B2F3A] dark:text-[#7DD3FC]';
  if (token.startsWith('[PHONE_'))
    return 'bg-[#EAE4F2] text-[#5B3B8C] dark:bg-[#2C2338] dark:text-[#C4B5FD]';
  if (token.startsWith('[IP_'))
    return 'bg-[#E1F2F0] text-[#0F685B] dark:bg-[#19322E] dark:text-[#6EE7B7]';
  return 'bg-[#DDEDEA] text-[#0F7B6C] dark:bg-[#1A332D] dark:text-[#6EE7B7]';
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
        translate="no"
        className={`mx-0.5 inline-block rounded px-1.5 py-0.5 font-mono text-[12px] font-medium ${tokenStyle(token)}`}
      >
        {token}
      </span>
    );
  }

  return (
    <button
      type="button"
      translate="no"
      onClick={() => setPeek((v) => !v)}
      title={peek ? 'Click to hide again' : 'Click to peek original value locally'}
      className={`mx-0.5 inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[12px] font-medium transition ${
        peek
          ? 'bg-[var(--n-warn-soft)] text-[var(--n-warn)] ring-1 ring-[var(--n-warn-border)]'
          : `${tokenStyle(token)} hover:opacity-85`
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
        <strong key={idx} className="font-semibold text-[var(--n-text)]">
          {renderInline(part.slice(2, -2), vaultLookup)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**') && part.length > 2) {
      return (
        <em key={idx} className="italic text-[var(--n-muted)]">
          {renderInline(part.slice(1, -1), vaultLookup)}
        </em>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={idx}
          className="rounded bg-[var(--n-surface)] px-1.5 py-0.5 font-mono text-[12.5px] text-[var(--n-danger)]"
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
      // ignore clipboard errors
    }
  }

  return (
    <div className="overflow-x-auto rounded-md border border-[var(--n-border)] bg-[var(--n-code-bg)]">
      <div className="flex items-center justify-between border-b border-[var(--n-border)] px-3 py-1.5">
        <span className="font-mono text-[11px] text-[var(--n-muted)]">{lang || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--n-muted)] transition hover:bg-[var(--n-hover)] hover:text-[var(--n-text)]"
        >
          {copied ? (
            <Check className="h-3 w-3 text-[var(--n-accent)]" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-3.5 font-mono text-[12.5px] leading-relaxed text-[var(--n-text)]">
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
      <div className="space-y-2.5 text-[15px] leading-[1.65] text-[var(--n-text)]">
        {blocks.map((block, i) => {
          if (block.type === 'code') {
            return <CopyableCodeBlock key={i} lang={block.lang} content={block.content} />;
          }

          if (block.type === 'table') {
            return (
              <div
                key={i}
                className="overflow-x-auto rounded-md border border-[var(--n-border)] bg-[var(--n-bg)]"
              >
                <table className="w-full border-collapse text-left text-[13.5px]">
                  <thead>
                    <tr className="border-b border-[var(--n-border)] bg-[var(--n-surface)] text-[var(--n-text)]">
                      {block.headers.map((h, hi) => (
                        <th key={hi} className="px-3 py-2 font-semibold">
                          {renderInline(h, vaultLookup)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--n-border)]">
                    {block.rows.map((row, ri) => (
                      <tr key={ri} className="hover:bg-[var(--n-surface)]">
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-3 py-2 text-[var(--n-text)]">
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
              <h3 key={i} className="pt-3 text-[16px] font-semibold tracking-tight text-[var(--n-text)]">
                {renderInline(line.slice(4), vaultLookup)}
              </h3>
            );
          }
          if (line.startsWith('## ')) {
            return (
              <h2 key={i} className="pt-3 text-[18px] font-semibold tracking-tight text-[var(--n-text)]">
                {renderInline(line.slice(3), vaultLookup)}
              </h2>
            );
          }
          if (line.startsWith('# ')) {
            return (
              <h1 key={i} className="pt-3 text-[20px] font-bold tracking-tight text-[var(--n-text)]">
                {renderInline(line.slice(2), vaultLookup)}
              </h1>
            );
          }
          if (line.startsWith('> ')) {
            return (
              <blockquote
                key={i}
                className="border-l-[3px] border-[var(--n-border-strong)] pl-3.5 text-[var(--n-muted)]"
              >
                {renderInline(line.slice(2), vaultLookup)}
              </blockquote>
            );
          }
          if (/^[-*•]\s+/.test(line)) {
            return (
              <div key={i} className="flex gap-2.5 pl-1">
                <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--n-muted)]" />
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
                <span className="font-mono text-[13px] font-medium text-[var(--n-muted)]">
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
