import React, { memo, useEffect } from 'react';
import { History, Trash2, X } from 'lucide-react';
import type { SavedAnalysis } from '../services/historyStore';

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface HistoryDrawerProps {
  history: SavedAnalysis[];
  firestoreError: string | null;
  onSelect: (item: SavedAnalysis) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export const HistoryDrawer: React.FC<HistoryDrawerProps> = memo(
  ({ history, firestoreError, onSelect, onDelete, onClose }) => {
    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Saved anonymized reports"
        className="fixed inset-0 z-40 flex justify-end bg-[var(--n-overlay)]"
        onClick={onClose}
      >
        <aside
          className="flex h-full w-full max-w-md flex-col overscroll-contain border-l border-[var(--n-border)] bg-[var(--n-bg)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--n-border)] px-5">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-[var(--n-accent)]" />
              <h2 className="text-[14px] font-semibold text-[var(--n-text)]">
                Saved reports ({history.length})
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-[var(--n-muted)] transition hover:bg-[var(--n-hover)] hover:text-[var(--n-text)]"
              aria-label="Close saved reports"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            <p className="mb-3 text-[12px] text-[var(--n-muted)]">
              Anonymized cloud snapshots stored in Firestore without original secrets (RAM-only vault).
            </p>

            {firestoreError && (
              <p className="mb-3 rounded-md border border-[var(--n-warn-border)] bg-[var(--n-warn-soft)] px-3 py-2 text-[12.5px] text-[var(--n-warn)]">
                Firestore notice: {firestoreError}
              </p>
            )}

            {history.length === 0 ? (
              <div className="rounded-lg border border-[var(--n-border)] bg-[var(--n-surface)] p-5 text-center text-[13px] text-[var(--n-muted)]">
                No saved reports yet. Run an analysis and click <strong>Save</strong> to store an anonymized snapshot.
              </div>
            ) : (
              <div className="space-y-2.5">
                {history.map((item) => {
                  const taskLabel = item.task.replace('_', ' ');
                  return (
                    <div
                      key={item.id}
                      className="group relative rounded-lg border border-[var(--n-border)] bg-[var(--n-surface)] transition hover:border-[var(--n-border-strong)] hover:bg-[var(--n-hover)]"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelect(item);
                          onClose();
                        }}
                        className="block w-full rounded-lg p-3.5 pr-10 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--n-accent)]"
                      >
                        <div className="mb-1 flex items-center justify-between gap-2 text-[12px]">
                          <span className="font-semibold capitalize text-[var(--n-text)]">
                            {taskLabel}
                          </span>
                          <span className="font-medium text-[var(--n-accent)]">
                            {item.piiCount} hidden
                          </span>
                        </div>
                        <p className="line-clamp-2 font-mono text-[11.5px] leading-relaxed text-[var(--n-muted)]">
                          {item.redactedPreview}
                        </p>
                        <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--n-muted)]">
                          <span>{item.inferenceSource === 'ON_DEVICE' ? 'On-device (Nano)' : 'Cloud'}</span>
                          <span className="font-mono tabular-nums">{formatDuration(item.latencyMs)}</span>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(item.id)}
                        title="Delete saved report"
                        aria-label={`Delete saved ${taskLabel} report`}
                        className="absolute right-2 top-2 rounded p-1.5 text-[var(--n-muted)] opacity-70 transition hover:bg-[var(--n-danger-soft)] hover:text-[var(--n-danger)] hover:opacity-100 focus:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </div>
    );
  }
);

HistoryDrawer.displayName = 'HistoryDrawer';
