import React, { useEffect, useMemo, useState } from 'react';
import { Eye, RefreshCw, ShieldAlert } from 'lucide-react';
import type { VaultEntry } from '../services/piiVault';
import { safeSanitizeDocumentHtml } from '../services/safeHtml';
import type { PreviewVisualMode } from './PdfPreviewPane';

interface DocxPreviewPaneProps {
  file: File;
  vault: VaultEntry[];
  visualMode: PreviewVisualMode;
  onAddManualTerm?: (term: string) => void;
  onWhitelistValue?: (value: string) => void;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Safely renders a sanitized HTML string into React elements (zero innerHTML),
 * wrapping detected vault entries in interactive Leak Highlight or solid-black Redacted pills.
 */
export const SafeHtmlDocumentView: React.FC<{
  sanitizedHtml: string;
  vault: VaultEntry[];
  visualMode: PreviewVisualMode;
  onSelectLeak?: (entry: VaultEntry) => void;
}> = React.memo(({ sanitizedHtml, vault, visualMode, onSelectLeak }) => {
  const matcher = useMemo(() => {
    const valid = [...vault]
      .filter((v) => v.original && v.original.length >= 2)
      .sort((a, b) => b.original.length - a.original.length);
    if (valid.length === 0) return null;
    const byLower = new Map<string, VaultEntry>();
    for (const v of valid) {
      if (!byLower.has(v.original.toLowerCase())) {
        byLower.set(v.original.toLowerCase(), v);
      }
    }
    const regex = new RegExp(`(${valid.map((v) => escapeRegExp(v.original)).join('|')})`, 'gi');
    return { regex, byLower };
  }, [vault]);

  const renderedNodes = useMemo(() => {
    if (!sanitizedHtml || typeof DOMParser === 'undefined') return null;
    const doc = new DOMParser().parseFromString(sanitizedHtml, 'text/html');
    let keySeq = 0;

    const renderTextWithHighlights = (text: string): React.ReactNode => {
      if (!matcher || !text) return text;
      const parts = text.split(matcher.regex);
      if (parts.length === 1) return text;

      return parts.map((chunk, idx) => {
        const hit = matcher.byLower.get(chunk.toLowerCase());
        if (!hit) return <React.Fragment key={idx}>{chunk}</React.Fragment>;

        if (visualMode === 'redacted') {
          return (
            <button
              key={idx}
              type="button"
              onClick={() => onSelectLeak?.(hit)}
              title={`Redacted ${hit.category} (${hit.source}) — click to inspect`}
              className="mx-0.5 inline-flex items-center rounded bg-zinc-950 px-1.5 py-0.5 align-baseline font-mono text-[11px] font-semibold leading-tight text-white transition hover:bg-zinc-800"
            >
              {hit.token}
            </button>
          );
        }

        return (
          <button
            key={idx}
            type="button"
            onClick={() => onSelectLeak?.(hit)}
            title={`${hit.token} · ${hit.source} — click to inspect or keep visible`}
            className="mx-0.5 inline-flex items-baseline gap-1 rounded border border-red-400/80 bg-red-500/15 px-1 py-0.2 text-left text-inherit transition hover:bg-red-500/25"
          >
            <span className="font-medium text-red-900">{chunk}</span>
            <span className="rounded bg-red-600 px-1 py-0.2 font-mono text-[9.5px] font-semibold text-white">
              {hit.token}
            </span>
          </button>
        );
      });
    };

    const convertNode = (node: Node): React.ReactNode => {
      const k = `n-${keySeq++}`;
      if (node.nodeType === 3) {
        return <React.Fragment key={k}>{renderTextWithHighlights(node.textContent || '')}</React.Fragment>;
      }
      if (node.nodeType !== 1) return null;
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      const children = Array.from(el.childNodes).map(convertNode);

      switch (tag) {
        case 'h1':
          return <h1 key={k} className="mb-2 mt-4 text-[18px] font-bold text-zinc-900 first:mt-0">{children}</h1>;
        case 'h2':
          return <h2 key={k} className="mb-1.5 mt-3.5 text-[15.5px] font-bold text-zinc-900">{children}</h2>;
        case 'h3':
        case 'h4':
          return <h3 key={k} className="mb-1 mt-3 text-[14px] font-semibold text-zinc-900">{children}</h3>;
        case 'p':
          return <p key={k} className="mb-2 leading-[1.6] text-zinc-800">{children}</p>;
        case 'strong':
        case 'b':
          return <strong key={k} className="font-semibold text-zinc-950">{children}</strong>;
        case 'em':
        case 'i':
          return <em key={k}>{children}</em>;
        case 'u':
          return <u key={k}>{children}</u>;
        case 'ul':
          return <ul key={k} className="mb-2 list-disc space-y-1 pl-5 text-zinc-800">{children}</ul>;
        case 'ol':
          return <ol key={k} className="mb-2 list-decimal space-y-1 pl-5 text-zinc-800">{children}</ol>;
        case 'li':
          return <li key={k} className="leading-[1.55]">{children}</li>;
        case 'blockquote':
          return (
            <blockquote key={k} className="my-2 border-l-2 border-teal-600 pl-3 italic text-zinc-600">
              {children}
            </blockquote>
          );
        case 'pre':
          return (
            <pre key={k} className="my-2 overflow-x-auto rounded border border-zinc-200 bg-zinc-50 p-2.5 font-mono text-[11.5px] leading-relaxed text-zinc-800">
              {children}
            </pre>
          );
        case 'code':
          return <code key={k} className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[12px] text-zinc-900">{children}</code>;
        case 'table':
          return (
            <div key={k} className="my-2.5 overflow-x-auto">
              <table className="w-full border-collapse border border-zinc-300 text-[12.5px]">{children}</table>
            </div>
          );
        case 'thead':
          return <thead key={k} className="bg-zinc-100">{children}</thead>;
        case 'tbody':
          return <tbody key={k}>{children}</tbody>;
        case 'tr':
          return <tr key={k} className="border-b border-zinc-200">{children}</tr>;
        case 'th':
          return (
            <th
              key={k}
              colSpan={Number(el.getAttribute('colspan') || 1) || undefined}
              rowSpan={Number(el.getAttribute('rowspan') || 1) || undefined}
              className="border border-zinc-300 px-2.5 py-1.5 text-left font-semibold text-zinc-900"
            >
              {children}
            </th>
          );
        case 'td':
          return (
            <td
              key={k}
              colSpan={Number(el.getAttribute('colspan') || 1) || undefined}
              rowSpan={Number(el.getAttribute('rowspan') || 1) || undefined}
              className="border border-zinc-300 px-2.5 py-1.5 align-top text-zinc-800"
            >
              {children}
            </td>
          );
        case 'hr':
          return <hr key={k} className="my-3 border-zinc-200" />;
        case 'br':
          return <br key={k} />;
        case 'img': {
          const src = el.getAttribute('src') || '';
          if (!src.startsWith('data:image/')) return null;
          return (
            <img
              key={k}
              src={src}
              alt={el.getAttribute('alt') || 'Embedded document image'}
              className="my-2 max-h-64 max-w-full rounded border border-zinc-200 object-contain"
            />
          );
        }
        case 'a': {
          const href = el.getAttribute('href') || '';
          return href ? (
            <a key={k} href={href} target="_blank" rel="noopener noreferrer" className="text-teal-700 underline">
              {children}
            </a>
          ) : (
            <span key={k}>{children}</span>
          );
        }
        default:
          return <span key={k}>{children}</span>;
      }
    };

    return Array.from(doc.body.childNodes).map(convertNode);
  }, [sanitizedHtml, matcher, visualMode, onSelectLeak]);

  return (
    <div className="rounded-lg border border-[var(--n-border)] bg-white p-5 text-[13.5px] text-zinc-900 shadow-xs sm:p-6">
      {renderedNodes}
    </div>
  );
});

SafeHtmlDocumentView.displayName = 'SafeHtmlDocumentView';

export const DocxPreviewPane: React.FC<DocxPreviewPaneProps> = ({
  file,
  vault,
  visualMode,
  onAddManualTerm,
  onWhitelistValue,
}) => {
  const [sanitizedHtml, setSanitizedHtml] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLeak, setSelectedLeak] = useState<VaultEntry | null>(null);
  const [selectedPhrase, setSelectedPhrase] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedLeak(null);

    void (async () => {
      try {
        const mammothMod = await import('mammoth');
        const mammoth = mammothMod.default ?? mammothMod;
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (!cancelled) {
          setSanitizedHtml(safeSanitizeDocumentHtml(result.value || '<p>(Empty Word document)</p>'));
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to render Word document preview.');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file]);

  function handleMouseUp() {
    if (!onAddManualTerm || typeof window === 'undefined') return;
    const text = window.getSelection()?.toString().trim() || '';
    if (text.length >= 2 && text.length <= 80 && !/^\[[A-Z]+_\d+\]$/.test(text)) {
      setSelectedPhrase(text);
    } else {
      setSelectedPhrase('');
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[220px] items-center justify-center gap-2 text-[13px] text-[var(--n-muted)]">
        <RefreshCw className="h-4 w-4 animate-spin text-[var(--n-accent)]" />
        Rendering Word (.docx) layout locally…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-[var(--n-danger-border)] bg-[var(--n-danger-soft)] p-3 text-[12.5px] text-[var(--n-danger)]">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-2.5 py-1 pb-4" onMouseUp={handleMouseUp}>
      {selectedPhrase && onAddManualTerm && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--n-accent-border)] bg-[var(--n-accent-soft)] px-2.5 py-1 text-[12px]">
          <span className="truncate text-[var(--n-text)]">
            Selected in Word: <code className="font-mono">&ldquo;{selectedPhrase}&rdquo;</code>
          </span>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onAddManualTerm(selectedPhrase);
              setSelectedPhrase('');
            }}
            className="shrink-0 rounded px-2 py-0.5 font-medium text-[var(--n-accent)] transition hover:bg-[var(--n-bg)]"
          >
            Mask as sensitive
          </button>
        </div>
      )}

      {selectedLeak && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--n-border)] bg-[var(--n-surface)] px-2.5 py-1.5 text-[12px]">
          <div className="min-w-0">
            <ShieldAlert className="mr-1 inline h-3.5 w-3.5 text-[var(--n-danger)]" />
            <span className="font-mono font-semibold text-[var(--n-danger)]">
              {selectedLeak.token}
            </span>{' '}
            <span className="text-[var(--n-muted)]">
              ({selectedLeak.category} · {selectedLeak.source}):
            </span>{' '}
            <code className="break-all font-mono text-[var(--n-text)]">{selectedLeak.original}</code>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {onWhitelistValue && (
              <button
                type="button"
                onClick={() => {
                  onWhitelistValue(selectedLeak.original);
                  setSelectedLeak(null);
                }}
                className="inline-flex items-center gap-1 rounded border border-[var(--n-border)] bg-[var(--n-bg)] px-2 py-0.5 text-[11.5px] font-medium text-[var(--n-text)] hover:bg-[var(--n-hover)]"
              >
                <Eye className="h-3 w-3 text-[var(--n-accent)]" />
                Keep visible
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedLeak(null)}
              className="rounded px-1.5 py-0.5 text-[11.5px] text-[var(--n-muted)] hover:bg-[var(--n-hover)]"
            >
              Close
            </button>
          </div>
        </div>
      )}

      <SafeHtmlDocumentView
        sanitizedHtml={sanitizedHtml}
        vault={vault}
        visualMode={visualMode}
        onSelectLeak={setSelectedLeak}
      />
    </div>
  );
};
