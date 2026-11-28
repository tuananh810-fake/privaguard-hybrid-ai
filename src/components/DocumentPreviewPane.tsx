import React, { lazy, Suspense, useMemo, useState } from 'react';
import { Eye, EyeOff, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import type { VaultEntry } from '../services/piiVault';
import type { ManualPdfBox } from '../services/fileRedactor';
import { getFileExtension } from '../services/documentParser';
import { parseCsvRows } from '../services/lightFileRedactor';
import { markdownToSafeHtml } from '../services/richPdfRenderer';
import { DocxPreviewPane, SafeHtmlDocumentView } from './DocxPreviewPane';
import type { PreviewVisualMode } from './PdfPreviewPane';

const PdfPreviewPane = lazy(() =>
  import('./PdfPreviewPane').then((m) => ({ default: m.PdfPreviewPane }))
);

interface DocumentPreviewPaneProps {
  file: File;
  rawText: string;
  vault: VaultEntry[];
  ignoredValues: string[];
  manualPdfBoxes: ManualPdfBox[];
  onAddManualBox: (box: ManualPdfBox) => void;
  onRemoveManualBox: (id: string) => void;
  onAddManualTerm: (term: string) => void;
  onWhitelistValue: (value: string) => void;
  onRestoreWhitelisted: (value: string) => void;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const InlineCellText: React.FC<{
  text: string;
  vault: VaultEntry[];
  visualMode: PreviewVisualMode;
  onWhitelistValue: (val: string) => void;
}> = React.memo(({ text, vault, visualMode, onWhitelistValue }) => {
  const parts = useMemo(() => {
    const valid = [...vault]
      .filter((v) => v.original && v.original.length >= 2)
      .sort((a, b) => b.original.length - a.original.length);
    if (!text || valid.length === 0) return [{ text, hit: null as VaultEntry | null }];
    const map = new Map<string, VaultEntry>();
    for (const v of valid) {
      if (!map.has(v.original.toLowerCase())) map.set(v.original.toLowerCase(), v);
    }
    const regex = new RegExp(`(${valid.map((v) => escapeRegExp(v.original)).join('|')})`, 'gi');
    return text.split(regex).map((chunk) => ({
      text: chunk,
      hit: map.get(chunk.toLowerCase()) ?? null,
    }));
  }, [text, vault]);

  return (
    <>
      {parts.map((p, idx) => {
        if (!p.hit) return <React.Fragment key={idx}>{p.text}</React.Fragment>;
        const hit = p.hit;
        if (visualMode === 'redacted') {
          return (
            <span
              key={idx}
              title={`Redacted ${hit.category} (${hit.source})`}
              className="mx-0.5 inline-block rounded bg-zinc-950 px-1 py-0.2 font-mono text-[10.5px] font-semibold text-white"
            >
              {hit.token}
            </span>
          );
        }
        return (
          <button
            key={idx}
            type="button"
            onClick={() => onWhitelistValue(hit.original)}
            title={`${hit.token} (${hit.source}) — click to keep visible (whitelist)`}
            className="mx-0.5 inline-flex items-baseline gap-1 rounded border border-red-400/80 bg-red-500/15 px-1 text-left transition hover:bg-red-500/25"
          >
            <span className="font-medium text-red-900 dark:text-red-200">{p.text}</span>
            <span className="rounded bg-red-600 px-1 font-mono text-[9px] font-semibold text-white">
              {hit.token}
            </span>
          </button>
        );
      })}
    </>
  );
});

InlineCellText.displayName = 'InlineCellText';

export const DocumentPreviewPane: React.FC<DocumentPreviewPaneProps> = ({
  file,
  rawText,
  vault,
  ignoredValues,
  manualPdfBoxes,
  onAddManualBox,
  onRemoveManualBox,
  onAddManualTerm,
  onWhitelistValue,
  onRestoreWhitelisted,
}) => {
  const [visualMode, setVisualMode] = useState<PreviewVisualMode>('leaks');
  const ext = getFileExtension(file.name);
  const mime = (file.type || '').toLowerCase();

  const kind = useMemo(() => {
    if (ext === 'pdf' || mime === 'application/pdf') return 'pdf' as const;
    if (
      ext === 'docx' ||
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      return 'docx' as const;
    }
    if (ext === 'csv' || mime === 'text/csv') return 'csv' as const;
    if (ext === 'json' || mime === 'application/json') return 'json' as const;
    if (ext === 'md' || ext === 'markdown') return 'md' as const;
    return 'text' as const;
  }, [ext, mime]);

  const csvData = useMemo(() => (kind === 'csv' ? parseCsvRows(rawText) : null), [kind, rawText]);
  const mdHtml = useMemo(() => (kind === 'md' ? markdownToSafeHtml(rawText) : ''), [kind, rawText]);
  const prettyJson = useMemo(() => {
    if (kind !== 'json') return '';
    try {
      return JSON.stringify(JSON.parse(rawText), null, 2);
    } catch {
      return rawText;
    }
  }, [kind, rawText]);

  const totalDetections = vault.length + (kind === 'pdf' ? manualPdfBoxes.length : 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Unified Dual-Mode Inspection Bar */}
      <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--n-border)] bg-[var(--n-surface)] px-2.5 py-1.5 text-[12px]">
        <div
          role="group"
          aria-label="Document preview overlay mode"
          className="inline-flex items-center rounded-md border border-[var(--n-border)] bg-[var(--n-bg)] p-0.5"
        >
          <button
            type="button"
            onClick={() => setVisualMode('leaks')}
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11.5px] font-medium transition ${
              visualMode === 'leaks'
                ? 'bg-[var(--n-danger-soft)] text-[var(--n-danger)]'
                : 'text-[var(--n-muted)] hover:text-[var(--n-text)]'
            }`}
          >
            <Eye className="h-3 w-3" />
            Highlight leaks
          </button>
          <button
            type="button"
            onClick={() => setVisualMode('redacted')}
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11.5px] font-medium transition ${
              visualMode === 'redacted'
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'text-[var(--n-muted)] hover:text-[var(--n-text)]'
            }`}
          >
            <EyeOff className="h-3 w-3" />
            Redacted preview
          </button>
        </div>

        <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--n-muted)]">
          <ShieldCheck className="h-3.5 w-3.5 text-[var(--n-accent)]" />
          {totalDetections > 0
            ? `${totalDetections} protected item${totalDetections === 1 ? '' : 's'} · click any highlight to whitelist`
            : 'No leaks detected on original layout'}
        </span>
      </div>

      {/* Session Whitelist Recovery Strip */}
      {ignoredValues.length > 0 && (
        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5 rounded-md border border-[var(--n-border)] bg-[var(--n-surface)] px-2.5 py-1 text-[11.5px]">
          <span className="text-[var(--n-muted)]">Kept visible (whitelisted):</span>
          {ignoredValues.map((val) => (
            <button
              key={val}
              type="button"
              onClick={() => onRestoreWhitelisted(val)}
              title="Click to restore redaction for this value"
              className="inline-flex items-center gap-1 rounded border border-[var(--n-border)] bg-[var(--n-bg)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--n-text)] transition hover:border-[var(--n-accent)]"
            >
              <span className="max-w-[140px] truncate">{val}</span>
              <RotateCcw className="h-2.5 w-2.5 text-[var(--n-accent)]" />
            </button>
          ))}
        </div>
      )}

      {/* Format-Specific Native Visual Renderer */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {kind === 'pdf' ? (
          <Suspense
            fallback={
              <div className="flex min-h-[180px] items-center justify-center gap-2 text-[13px] text-[var(--n-muted)]">
                <RefreshCw className="h-4 w-4 animate-spin text-[var(--n-accent)]" />
                Loading PDF preview…
              </div>
            }
          >
            <PdfPreviewPane
              file={file}
              vault={vault}
              visualMode={visualMode}
              manualBoxes={manualPdfBoxes}
              onAddManualBox={onAddManualBox}
              onRemoveManualBox={onRemoveManualBox}
              onWhitelistValue={onWhitelistValue}
            />
          </Suspense>
        ) : kind === 'docx' ? (
          <DocxPreviewPane
            file={file}
            vault={vault}
            visualMode={visualMode}
            onAddManualTerm={onAddManualTerm}
            onWhitelistValue={onWhitelistValue}
          />
        ) : kind === 'csv' && csvData ? (
          <div className="overflow-x-auto rounded-lg border border-[var(--n-border)] bg-[var(--n-bg)]">
            <table className="w-full border-collapse text-left text-[12px]">
              {csvData.rows.length > 0 && (
                <thead className="sticky top-0 bg-[var(--n-surface)]">
                  <tr>
                    {csvData.rows[0].map((cell, ci) => (
                      <th
                        key={ci}
                        className="border-b border-r border-[var(--n-border)] px-2.5 py-1.5 font-semibold text-[var(--n-text)] last:border-r-0"
                      >
                        <InlineCellText
                          text={cell}
                          vault={vault}
                          visualMode={visualMode}
                          onWhitelistValue={onWhitelistValue}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {csvData.rows.slice(1, 201).map((row, ri) => (
                  <tr key={ri} className="border-b border-[var(--n-border)] last:border-b-0">
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className="border-r border-[var(--n-border)] px-2.5 py-1.5 align-top text-[var(--n-text)] last:border-r-0"
                      >
                        <InlineCellText
                          text={cell}
                          vault={vault}
                          visualMode={visualMode}
                          onWhitelistValue={onWhitelistValue}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : kind === 'md' ? (
          <SafeHtmlDocumentView
            sanitizedHtml={mdHtml}
            vault={vault}
            visualMode={visualMode}
            onSelectLeak={(entry) => onWhitelistValue(entry.original)}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--n-border)] bg-[var(--n-surface)] p-3 font-mono text-[12px] leading-relaxed text-[var(--n-text)]">
            {(kind === 'json' ? prettyJson : rawText).split(/\r?\n/).map((line, idx) => (
              <div key={idx} className="flex gap-3 hover:bg-[var(--n-hover)]/50">
                <span className="w-8 shrink-0 select-none text-right text-[11px] text-[var(--n-muted)]">
                  {idx + 1}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                  <InlineCellText
                    text={line || ' '}
                    vault={vault}
                    visualMode={visualMode}
                    onWhitelistValue={onWhitelistValue}
                  />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
