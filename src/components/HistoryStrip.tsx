import React, { memo } from 'react';
import { History, Trash2 } from 'lucide-react';
import type { SavedAnalysis } from '../services/historyStore';

interface HistoryStripProps {
  history: SavedAnalysis[];
  firestoreError: string | null;
  onSelect: (item: SavedAnalysis) => void;
  onDelete: (id: string) => void;
}

export const HistoryStrip: React.FC<HistoryStripProps> = memo(
  ({ history, firestoreError, onSelect, onDelete }) => {
    if (history.length === 0 && !firestoreError) return null;

    return (
      <section className="border-t border-[var(--n-border)] bg-[var(--n-surface)] px-6 py-5 sm:px-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-[var(--n-text)]">
            <History className="h-3.5 w-3.5 text-[var(--n-muted)]" />
            Saved reports ({history.length})
          </h2>
          <span className="text-[12px] text-[var(--n-muted)]">
            Stored without personal details
          </span>
        </div>

        {firestoreError && (
          <p className="mb-2 text-[12.5px] text-[var(--n-warn)]">
            Firestore notice: {firestoreError}
          </p>
        )}

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {history.map((item) => (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(item)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(item);
                }
              }}
              className="group relative cursor-pointer rounded-lg border border-[var(--n-border)] bg-[var(--n-bg)] p-3 transition hover:bg-[var(--n-hover)]"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(item.id);
                }}
                title="Delete saved report"
                aria-label="Delete saved report"
                className="absolute right-2 top-2 rounded p-1 text-[var(--n-muted)] opacity-0 transition hover:bg-[var(--n-danger-soft)] hover:text-[var(--n-danger)] group-hover:opacity-100 focus:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <div className="mb-1 flex items-center justify-between pr-5 text-[12px]">
                <span className="font-medium capitalize text-[var(--n-text)]">
                  {item.task.replace('_', ' ')}
                </span>
                <span className="text-[var(--n-accent)]">{item.piiCount} hidden</span>
              </div>
              <p className="line-clamp-2 font-mono text-[11.5px] text-[var(--n-muted)]">
                {item.redactedPreview}
              </p>
              <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--n-muted)]">
                <span>{item.inferenceSource === 'ON_DEVICE' ? 'On-device' : 'Cloud'}</span>
                <span className="font-mono">{item.latencyMs}ms</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }
);

HistoryStrip.displayName = 'HistoryStrip';
