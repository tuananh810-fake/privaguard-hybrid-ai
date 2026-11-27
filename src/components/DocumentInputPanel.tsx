import React, { memo, useMemo, useRef } from 'react';
import {
  CheckCircle2,
  Code2,
  Columns2,
  Image as ImageIcon,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  Upload,
  X,
} from 'lucide-react';
import { SAMPLE_DOCUMENTS } from '../data/samples';
import { AnalysisTask, AttachedImage } from '../services/hybridAI';
import { RedactionResult, VaultEntry } from '../services/piiVault';
import { HighlightedRedactedText } from './RichOutput';

export const TASK_OPTIONS: { key: AnalysisTask; label: string }[] = [
  { key: 'risk_audit', label: 'Security audit' },
  { key: 'executive', label: 'Executive brief' },
  { key: 'action_plan', label: 'Action plan' },
  { key: 'quick_offline', label: 'Quick summary' },
];

export type InputTabKey = 'original' | 'safe' | 'diff' | 'audit';

interface DocumentInputPanelProps {
  rawText: string;
  onRawTextChange: (val: string) => void;
  onSelectSample: (content: string) => void;
  onTextFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  inputTab: InputTabKey;
  onInputTabChange: (tab: InputTabKey) => void;
  redaction: RedactionResult;
  vaultLookup: Record<string, VaultEntry>;
  leakCheck: number;
  outgoingPrompt: string;
  attachedImage: AttachedImage | null;
  imageMaskCount: number;
  onOpenImageRedactor: () => void;
  onRemoveImage: () => void;
  task: AnalysisTask;
  onTaskChange: (t: AnalysisTask) => void;
  running: boolean;
  onRunPipeline: () => void;
  onStop: () => void;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const HighlightedRawPii: React.FC<{ rawText: string; vault: VaultEntry[] }> = memo(
  ({ rawText, vault }) => {
    const parts = useMemo(() => {
      if (vault.length === 0) return [{ text: rawText, isPii: false }];
      const uniqueOriginals = Array.from(new Set(vault.map((v) => v.original)))
        .filter((s) => s.length >= 3)
        .sort((a, b) => b.length - a.length);
      if (uniqueOriginals.length === 0) return [{ text: rawText, isPii: false }];
      const regex = new RegExp(`(${uniqueOriginals.map(escapeRegExp).join('|')})`, 'g');
      const set = new Set(uniqueOriginals);
      return rawText.split(regex).map((chunk) => ({
        text: chunk,
        isPii: set.has(chunk),
      }));
    }, [rawText, vault]);

    return (
      <div className="whitespace-pre-wrap break-words">
        {parts.map((p, i) =>
          p.isPii ? (
            <mark
              key={i}
              className="rounded bg-rose-500/25 px-1 py-0.5 text-rose-200 ring-1 ring-rose-500/40"
            >
              {p.text}
            </mark>
          ) : (
            <React.Fragment key={i}>{p.text}</React.Fragment>
          )
        )}
      </div>
    );
  }
);

HighlightedRawPii.displayName = 'HighlightedRawPii';

export const DocumentInputPanel: React.FC<DocumentInputPanelProps> = memo(
  ({
    rawText,
    onRawTextChange,
    onSelectSample,
    onTextFileUpload,
    onImageUpload,
    inputTab,
    onInputTabChange,
    redaction,
    vaultLookup,
    leakCheck,
    outgoingPrompt,
    attachedImage,
    imageMaskCount,
    onOpenImageRedactor,
    onRemoveImage,
    task,
    onTaskChange,
    running,
    onRunPipeline,
    onStop,
  }) => {
    const textFileRef = useRef<HTMLInputElement>(null);
    const imageFileRef = useRef<HTMLInputElement>(null);

    return (
      <section className="flex flex-col rounded-2xl border border-[#1E2733] bg-[#10151C] p-5 shadow-xl lg:col-span-5">
        {/* Quick Samples & Upload Bar */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {SAMPLE_DOCUMENTS.map((s) => (
              <button
                type="button"
                key={s.id}
                onClick={() => onSelectSample(s.content)}
                className="rounded-lg border border-[#1E2733] bg-[#0C1016] px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:border-emerald-500/50 hover:text-white"
              >
                {s.label
                  .replace(' Incident Log', ' Log')
                  .replace(' Patient Note', ' Note')
                  .replace(' & Payout', '')}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <input
              ref={textFileRef}
              type="file"
              accept=".txt,.md,.log,.json,.env,.csv"
              onChange={onTextFileUpload}
              className="hidden"
            />
            <input
              ref={imageFileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={onImageUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => textFileRef.current?.click()}
              title="Upload text or log file"
              className="inline-flex items-center gap-1 rounded-lg border border-[#1E2733] bg-[#0C1016] px-2.5 py-1 text-xs text-slate-300 hover:border-emerald-500/50 hover:text-white"
            >
              <Upload className="h-3.5 w-3.5" />
              File
            </button>
            <button
              type="button"
              onClick={() => imageFileRef.current?.click()}
              title="Upload and mask image locally"
              className="inline-flex items-center gap-1 rounded-lg border border-[#1E2733] bg-[#0C1016] px-2.5 py-1 text-xs text-slate-300 hover:border-sky-500/50 hover:text-white"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              Image
            </button>
          </div>
        </div>

        {/* Mode Tabs: Original | Masked | Diff | Payload */}
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-lg bg-[#090C10] p-0.5 ring-1 ring-[#1E2733]">
            <button
              type="button"
              onClick={() => onInputTabChange('original')}
              className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                inputTab === 'original'
                  ? 'bg-[#1A222E] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Document
            </button>
            <button
              type="button"
              onClick={() => onInputTabChange('safe')}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                inputTab === 'safe'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Masked ({redaction.vault.length})
            </button>
            <button
              type="button"
              onClick={() => onInputTabChange('diff')}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                inputTab === 'diff'
                  ? 'bg-amber-500/15 text-amber-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Columns2 className="h-3.5 w-3.5" />
              Diff
            </button>
            <button
              type="button"
              onClick={() => onInputTabChange('audit')}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                inputTab === 'audit'
                  ? 'bg-sky-500/15 text-sky-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Code2 className="h-3.5 w-3.5" />
              Payload
            </button>
          </div>

          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {leakCheck === 0 ? '0 bytes PII leaked' : `${leakCheck} leaks`}
          </span>
        </div>

        {/* Editor / Masked / Side-by-Side Diff / Payload */}
        {inputTab === 'original' ? (
          <textarea
            value={rawText}
            onChange={(e) => onRawTextChange(e.target.value)}
            rows={11}
            placeholder="Paste any confidential log, contract, medical note, or upload a file..."
            className="w-full flex-1 resize-none rounded-xl border border-[#1E2733] bg-[#090C10] p-3.5 font-mono text-xs leading-relaxed text-slate-200 outline-none focus:border-emerald-500"
          />
        ) : inputTab === 'safe' ? (
          <div className="min-h-[236px] flex-1 overflow-y-auto rounded-xl border border-emerald-500/30 bg-[#090C10] p-3.5 font-mono text-xs leading-relaxed text-slate-200">
            <div className="mb-2 text-[11px] text-slate-400">
              Click any highlighted token to peek its original value locally.
            </div>
            <HighlightedRedactedText text={redaction.redactedText} vaultLookup={vaultLookup} />
          </div>
        ) : inputTab === 'diff' ? (
          <div className="grid min-h-[236px] flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="overflow-y-auto rounded-xl border border-rose-500/30 bg-[#090C10] p-3 font-mono text-[11px] leading-relaxed text-slate-300">
              <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-rose-400">
                <span>Local RAM (Raw)</span>
                <span>{redaction.bytesShielded}B PII</span>
              </div>
              <HighlightedRawPii rawText={rawText} vault={redaction.vault} />
            </div>
            <div className="overflow-y-auto rounded-xl border border-emerald-500/30 bg-[#090C10] p-3 font-mono text-[11px] leading-relaxed text-slate-200">
              <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                <span>Sent to AI (Safe)</span>
                <span>{leakCheck === 0 ? '0B leaked' : `${leakCheck} leaks`}</span>
              </div>
              <HighlightedRedactedText text={redaction.redactedText} vaultLookup={vaultLookup} />
            </div>
          </div>
        ) : (
          <div className="min-h-[236px] flex-1 overflow-y-auto rounded-xl border border-sky-500/30 bg-[#090C10] p-3.5 font-mono text-[11px] leading-relaxed text-sky-100">
            <div className="mb-2 text-[11px] font-medium text-sky-400">
              Exact payload sent to AI (0 raw PII):
            </div>
            <pre className="whitespace-pre-wrap">{outgoingPrompt}</pre>
          </div>
        )}

        {/* Live PII Breakdown Strip */}
        {redaction.breakdown.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {redaction.breakdown.map((b) => (
              <span
                key={b.category}
                className="rounded-md bg-[#0C1016] px-2 py-0.5 font-mono text-[10px] text-slate-300 ring-1 ring-[#1E2733]"
              >
                {b.category}: <strong className="text-emerald-400">{b.count}</strong>
              </span>
            ))}
          </div>
        )}

        {/* Attached Image Card */}
        {attachedImage && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs">
            <div className="flex min-w-0 items-center gap-2.5">
              <img
                src={attachedImage.previewUrl}
                alt={attachedImage.name}
                className="h-8 w-8 shrink-0 rounded object-cover"
              />
              <div className="min-w-0">
                <div className="truncate font-medium text-sky-100">{attachedImage.name}</div>
                <div
                  className={`text-[11px] ${
                    imageMaskCount > 0 ? 'text-emerald-300' : 'text-amber-300'
                  }`}
                >
                  {imageMaskCount > 0
                    ? `Masked locally (${imageMaskCount} bar${imageMaskCount > 1 ? 's' : ''}) · ${Math.round((attachedImage.base64Data.length * 0.75) / 1024)} KB`
                    : 'Unmasked — click Redact image to hide private regions'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onOpenImageRedactor}
                className="rounded-lg bg-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/30"
              >
                Redact image
              </button>
              <button
                type="button"
                onClick={onRemoveImage}
                className="p-1 text-slate-400 hover:text-rose-300"
                aria-label="Remove image"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Task Selector */}
        <div className="mt-4">
          <div className="mb-1.5 text-xs font-medium text-slate-400">Analysis goal</div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-2">
            {TASK_OPTIONS.map((t) => (
              <button
                type="button"
                key={t.key}
                onClick={() => onTaskChange(t.key)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                  task === t.key
                    ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/50'
                    : 'bg-[#0C1016] text-slate-400 ring-1 ring-[#1E2733] hover:text-slate-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Primary CTA */}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onRunPipeline}
            disabled={running || !rawText.trim()}
            title="Shortcut: Ctrl + Enter"
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/15 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Analyzing safely...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 fill-current" />
                Analyze safely ({redaction.vault.length} shielded)
              </>
            )}
          </button>

          {running && (
            <button
              type="button"
              onClick={onStop}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3.5 py-2.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/25"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              Stop
            </button>
          )}
        </div>
        <div className="mt-1.5 text-center text-[10px] text-slate-500">
          Tip: Press <kbd className="rounded bg-[#0C1016] px-1 py-0.5 font-mono ring-1 ring-[#1E2733]">Ctrl+Enter</kbd> to run · <kbd className="rounded bg-[#0C1016] px-1 py-0.5 font-mono ring-1 ring-[#1E2733]">Esc</kbd> to close modals
        </div>
      </section>
    );
  }
);

DocumentInputPanel.displayName = 'DocumentInputPanel';
