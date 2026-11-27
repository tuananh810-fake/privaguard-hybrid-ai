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
      <section className="rounded-2xl border border-[#1E2733] bg-[#10151C]/70 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xs font-semibold text-slate-300">
            <History className="h-3.5 w-3.5 text-sky-400" />
            Saved anonymized reports ({history.length})
          </h2>
          <span className="text-[11px] text-slate-500">Private to this browser session</span>
        </div>

        {firestoreError && (
          <p className="mb-2 text-xs text-amber-300">Firestore notice: {firestoreError}</p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {history.map((item) => (
            <div
              key={item.id}
              onClick={() => onSelect(item)}
              className="group relative cursor-pointer rounded-xl border border-[#1E2733] bg-[#0C1016] p-3 transition hover:border-sky-500/50"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(item.id);
                }}
                title="Delete saved report"
                aria-label="Delete saved report"
                className="absolute right-2 top-2 rounded p-1 text-slate-500 opacity-0 transition hover:bg-rose-500/20 hover:text-rose-300 group-hover:opacity-100 focus:opacity-100"
              >
                <Trash2 className="h-3 w-3" />
              </button>
              <div className="mb-1 flex items-center justify-between pr-5 text-[11px]">
                <span className="font-semibold capitalize text-sky-300">
                  {item.task.replace('_', ' ')}
                </span>
                <span className="text-emerald-400">{item.piiCount} shielded</span>
              </div>
              <p className="line-clamp-2 font-mono text-[11px] text-slate-400">
                {item.redactedPreview}
              </p>
              <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
                <span>{item.inferenceSource === 'ON_DEVICE' ? 'On-Device' : 'Cloud'}</span>
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
