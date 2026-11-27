import React from 'react';

const TOKEN_REGEX = /(\[(?:SECRET|CARD|ID|EMAIL|PHONE|IP|PERSON|CUSTOM)_\d+\])/g;

function tokenStyle(token: string): string {
  if (token.startsWith('[SECRET_')) return 'bg-rose-500/20 text-rose-300 ring-rose-500/40';
  if (token.startsWith('[CARD_')) return 'bg-amber-500/20 text-amber-300 ring-amber-500/40';
  if (token.startsWith('[ID_')) return 'bg-orange-500/20 text-orange-300 ring-orange-500/40';
  if (token.startsWith('[EMAIL_')) return 'bg-sky-500/20 text-sky-300 ring-sky-500/40';
  if (token.startsWith('[PHONE_')) return 'bg-violet-500/20 text-violet-300 ring-violet-500/40';
  if (token.startsWith('[IP_')) return 'bg-cyan-500/20 text-cyan-300 ring-cyan-500/40';
  return 'bg-emerald-500/20 text-emerald-300 ring-emerald-500/40';
}

function renderInline(text: string): React.ReactNode[] {
  // Split by bold (**...**), inline code (`...`), or [TOKEN_N]
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[(?:SECRET|CARD|ID|EMAIL|PHONE|IP|PERSON|CUSTOM)_\d+\])/g);
  return parts.map((part, idx) => {
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={idx} className="font-semibold text-white">
          {renderInline(part.slice(2, -2))}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={idx} className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-emerald-300">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (TOKEN_REGEX.test(part)) {
      TOKEN_REGEX.lastIndex = 0;
      return (
        <span
          key={idx}
          className={`mx-0.5 inline-block rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ring-1 ${tokenStyle(part)}`}
        >
          {part}
        </span>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export function HighlightedRedactedText({ text }: { text: string }) {
  const parts = text.split(TOKEN_REGEX);
  return (
    <>
      {parts.map((part, idx) => {
        if (TOKEN_REGEX.test(part)) {
          TOKEN_REGEX.lastIndex = 0;
          return (
            <span
              key={idx}
              className={`mx-0.5 inline-block rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ring-1 ${tokenStyle(part)}`}
            >
              {part}
            </span>
          );
        }
        return <React.Fragment key={idx}>{part}</React.Fragment>;
      })}
    </>
  );
}

export function RichOutput({ markdown }: { markdown: string }) {
  const lines = markdown.split('\n');
  return (
    <div className="space-y-2 text-xs leading-relaxed text-slate-200">
      {lines.map((rawLine, i) => {
        const line = rawLine.trim();
        if (!line) return <div key={i} className="h-1" />;

        if (line.startsWith('### ')) {
          return (
            <h3 key={i} className="pt-1 text-sm font-bold text-emerald-300">
              {renderInline(line.slice(4))}
            </h3>
          );
        }
        if (line.startsWith('## ')) {
          return (
            <h2 key={i} className="pt-1 text-sm font-bold text-white">
              {renderInline(line.slice(3))}
            </h2>
          );
        }
        if (line.startsWith('# ')) {
          return (
            <h1 key={i} className="pt-1 text-base font-bold text-white">
              {renderInline(line.slice(2))}
            </h1>
          );
        }
        if (/^[-*•]\s+/.test(line)) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
              <div className="flex-1">{renderInline(line.replace(/^[-*•]\s+/, ''))}</div>
            </div>
          );
        }
        const numMatch = line.match(/^(\d+)\.\s+(.*)$/);
        if (numMatch) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="font-mono font-semibold text-indigo-300">{numMatch[1]}.</span>
              <div className="flex-1">{renderInline(numMatch[2])}</div>
            </div>
          );
        }
        return <p key={i}>{renderInline(line)}</p>;
      })}
    </div>
  );
}
