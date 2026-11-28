import React, { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Code2,
  Columns2,
  Copy,
  Cpu,
  Download,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  Upload,
  X,
} from 'lucide-react';
import { SAMPLE_DOCUMENTS } from '../data/samples';
import { AnalysisTask, AttachedImage, ModeKey, NanoAvailability } from '../services/hybridAI';
import { RedactionResult, VaultEntry } from '../services/piiVault';
import type { ManualPdfBox } from '../services/fileRedactor';
import { HighlightedRedactedText } from './RichOutput';

const DocumentPreviewPane = lazy(() =>
  import('./DocumentPreviewPane').then((m) => ({ default: m.DocumentPreviewPane }))
);

export const TASK_OPTIONS: { key: AnalysisTask; label: string }[] = [
  { key: 'risk_audit', label: 'Security audit' },
  { key: 'executive', label: 'Executive brief' },
  { key: 'action_plan', label: 'Action plan' },
  { key: 'quick_offline', label: 'Quick summary' },
];

const QUICK_MODE_OPTIONS: { key: ModeKey; label: string; title: string }[] = [
  { key: 'PREFER_ON_DEVICE', label: 'Auto Hybrid', title: 'On-device Nano first, Cloud fallback' },
  { key: 'PREFER_IN_CLOUD', label: 'Fast Cloud', title: 'Gemini Cloud JSON audit on masked tokens' },
  { key: 'ONLY_ON_DEVICE', label: 'Strict Offline', title: '100% on-device Gemini Nano (0 B to cloud)' },
];

export type InputTabKey = 'original' | 'safe' | 'preview' | 'diff' | 'audit';

interface DocumentInputPanelProps {
  rawText: string;
  onRawTextChange: (val: string) => void;
  onSelectSample: (content: string) => void;
  onTextFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFileDrop: (file: File) => void;
  extractingFile: boolean;
  fileMeta: string | null;
  onClearFileMeta: () => void;
  originalFile?: File | null;
  inputTab: InputTabKey;
  onInputTabChange: (tab: InputTabKey) => void;
  redaction: RedactionResult;
  vaultLookup: Record<string, VaultEntry>;
  leakCheck: number;
  outgoingPrompt: string;
  smartContextGuard: boolean;
  onToggleSmartContextGuard: () => void;
  contextGuardSummary: string;
  keptSafeCount: number;
  manualTerms: string[];
  onAddManualTerm: (term: string) => void;
  onRemoveManualTerm: (term: string) => void;
  ignoredValues?: string[];
  onWhitelistValue?: (value: string) => void;
  onRestoreWhitelisted?: (value: string) => void;
  manualPdfBoxes?: ManualPdfBox[];
  onAddManualBox?: (box: ManualPdfBox) => void;
  onRemoveManualBox?: (id: string) => void;
  nanoStatus: NanoAvailability | 'checking';
  scanningNano: boolean;
  nanoScanCompleted: boolean;
  nanoScanNotice: string | null;
  nanoScanTruncated: boolean;
  nanoScanTimedOut: boolean;
  onScanNano: () => void;
  onCancelNanoScan: () => void;
  onOpenNanoGuide: () => void;
  attachedImage: AttachedImage | null;
  imageMaskCount: number;
  onOpenImageRedactor: () => void;
  onRemoveImage: () => void;
  task: AnalysisTask;
  onTaskChange: (t: AnalysisTask) => void;
  mode: ModeKey;
  simulatedOffline: boolean;
  onQuickModeChange: (m: ModeKey) => void;
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
        .filter((s) => s.length >= 2)
        .sort((a, b) => b.length - a.length);
      if (uniqueOriginals.length === 0) return [{ text: rawText, isPii: false }];
      const regex = new RegExp(`(${uniqueOriginals.map(escapeRegExp).join('|')})`, 'gi');
      const lowerSet = new Set(uniqueOriginals.map((s) => s.toLowerCase()));
      return rawText.split(regex).map((chunk) => ({
        text: chunk,
        isPii: lowerSet.has(chunk.toLowerCase()),
      }));
    }, [rawText, vault]);

    return (
      <div className="whitespace-pre-wrap break-words">
        {parts.map((p, i) =>
          p.isPii ? (
            <mark
              key={i}
              className="rounded bg-[var(--n-danger-soft)] px-1 py-0.5 text-[var(--n-danger)]"
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
    onFileDrop,
    extractingFile,
    fileMeta,
    onClearFileMeta,
    originalFile = null,
    inputTab,
    onInputTabChange,
    redaction,
    vaultLookup,
    leakCheck,
    outgoingPrompt,
    smartContextGuard,
    onToggleSmartContextGuard,
    contextGuardSummary,
    keptSafeCount,
    manualTerms,
    onAddManualTerm,
    onRemoveManualTerm,
    ignoredValues = [],
    onWhitelistValue,
    onRestoreWhitelisted,
    manualPdfBoxes = [],
    onAddManualBox,
    onRemoveManualBox,
    nanoStatus,
    scanningNano,
    nanoScanCompleted,
    nanoScanNotice,
    nanoScanTruncated,
    nanoScanTimedOut,
    onScanNano,
    onCancelNanoScan,
    onOpenNanoGuide,
    attachedImage,
    imageMaskCount,
    onOpenImageRedactor,
    onRemoveImage,
    task,
    onTaskChange,
    mode,
    simulatedOffline,
    onQuickModeChange,
    running,
    onRunPipeline,
    onStop,
  }) => {
    const activeQuickMode: ModeKey = simulatedOffline
      ? 'ONLY_ON_DEVICE'
      : mode === 'ONLY_IN_CLOUD'
        ? 'PREFER_IN_CLOUD'
        : mode;
    const textFileRef = useRef<HTMLInputElement>(null);
    const imageFileRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const attachMenuRef = useRef<HTMLDivElement>(null);
    const dragDepthRef = useRef(0);
    const [attachMenuOpen, setAttachMenuOpen] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [loadingSample, setLoadingSample] = useState<'pdf' | 'image' | null>(null);
    const [selectedText, setSelectedText] = useState('');
    const [safeCopied, setSafeCopied] = useState(false);

    async function handleCopySafeText() {
      if (!redaction.redactedText) return;
      try {
        await navigator.clipboard.writeText(redaction.redactedText);
        setSafeCopied(true);
        setTimeout(() => setSafeCopied(false), 1800);
      } catch {
        // ignore clipboard permission errors
      }
    }

    const originalFileName = originalFile?.name ?? null;
    const originalFileExt = originalFileName?.split('.').pop()?.toLowerCase() || '';

    function handleDownloadRedactedImage() {
      if (!attachedImage?.previewUrl) return;
      const baseName = attachedImage.name.replace(/\.[^.]+$/, '') || 'image';
      const ext = attachedImage.mimeType === 'image/png' ? 'png' : attachedImage.mimeType === 'image/jpeg' ? 'jpg' : 'webp';
      const a = document.createElement('a');
      a.href = attachedImage.previewUrl;
      a.download = `privaguard-redacted-${baseName}.${ext}`;
      a.click();
    }

    const activeManualTerms = useMemo(() => {
      if (manualTerms.length === 0 || !rawText) return [];
      const lowerDoc = rawText.toLowerCase();
      return manualTerms.filter((term) => lowerDoc.includes(term.toLowerCase()));
    }, [manualTerms, rawText]);

    function syncSelection() {
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      if (end > start) {
        const picked = el.value.slice(start, end).trim();
        setSelectedText(picked.length >= 2 && picked.length <= 80 ? picked : '');
      } else {
        setSelectedText('');
      }
    }

    function handleMarkSelectedAsSensitive() {
      if (!selectedText) return;
      onAddManualTerm(selectedText);
      setSelectedText('');
    }

    function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        const el = e.currentTarget;
        const start = el.selectionStart ?? 0;
        const end = el.selectionEnd ?? 0;
        if (end > start) {
          const picked = el.value.slice(start, end).trim();
          if (picked.length >= 2 && picked.length <= 80) {
            onAddManualTerm(picked);
            setSelectedText('');
          }
        }
      }
    }

    async function handleLoadSampleFile(kind: 'pdf' | 'image') {
      if (loadingSample || extractingFile) return;
      setLoadingSample(kind);
      try {
        const url = kind === 'pdf' ? '/samples/nda-sample.pdf' : '/samples/id-card-sample.png';
        const fileName = kind === 'pdf' ? 'nda-sample.pdf' : 'id-card-sample.png';
        const mimeType = kind === 'pdf' ? 'application/pdf' : 'image/png';
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch ${fileName} (${res.status})`);
        const blob = await res.blob();
        const file = new File([blob], fileName, { type: blob.type || mimeType });
        onFileDrop(file);
      } catch (err) {
        console.error('Failed to load sample file:', err);
      } finally {
        setLoadingSample(null);
      }
    }

    useEffect(() => {
      if (!attachMenuOpen) return;
      const onPointerDown = (e: MouseEvent) => {
        if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
          setAttachMenuOpen(false);
        }
      };
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setAttachMenuOpen(false);
      };
      document.addEventListener('mousedown', onPointerDown);
      window.addEventListener('keydown', onKeyDown);
      return () => {
        document.removeEventListener('mousedown', onPointerDown);
        window.removeEventListener('keydown', onKeyDown);
      };
    }, [attachMenuOpen]);

    function handleDragEnter(e: React.DragEvent) {
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current += 1;
      if (e.dataTransfer.types.includes('Files')) {
        setIsDragging(true);
      }
    }

    function handleDragOver(e: React.DragEvent) {
      e.preventDefault();
      e.stopPropagation();
    }

    function handleDragLeave(e: React.DragEvent) {
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDragging(false);
      }
    }

    function handleDrop(e: React.DragEvent) {
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = 0;
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) onFileDrop(file);
    }

    return (
      <section
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="relative flex min-h-[540px] min-w-0 flex-col bg-[var(--n-bg)] px-5 py-5 sm:px-7 lg:h-full lg:min-h-0 lg:overflow-hidden lg:px-8 lg:border-r lg:border-[var(--n-border)]"
      >
        {/* Subtle Notion Drag & Drop Overlay */}
        {isDragging && (
          <div className="pointer-events-none absolute inset-3 z-30 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--n-accent)] bg-[var(--n-bg)]/95 p-6 text-center">
            <Upload className="mb-2.5 h-6 w-6 text-[var(--n-accent)]" />
            <p className="text-[14.5px] font-medium text-[var(--n-text)]">
              Drop PDF, Word, text or image — processed 100% on this device
            </p>
            <p className="mt-1 text-[12.5px] text-[var(--n-muted)]">
              Zero raw files uploaded to any server
            </p>
          </div>
        )}

        {/* Heading + trust badge, unified sample row */}
        <div className="mb-3 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h2 className="text-[22px] font-bold tracking-tight text-[var(--n-text)]">Document</h2>
            <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--n-accent)]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {leakCheck === 0 ? '0 detected PII sent to cloud' : `${leakCheck} detected PII remaining`}
            </span>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-[12px] text-[var(--n-muted)]">Try:</span>
            {SAMPLE_DOCUMENTS.map((s) => (
              <button
                type="button"
                key={s.id}
                onClick={() => onSelectSample(s.content)}
                className="rounded-md bg-[var(--n-surface)] px-2.5 py-1 text-[12px] font-medium text-[var(--n-text)] transition hover:bg-[var(--n-hover)]"
              >
                {s.label
                  .replace(' Incident Log', ' log')
                  .replace(' Patient Note', ' note')
                  .replace(' & Payout', '')}
              </button>
            ))}
            <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-[var(--n-border)]" />
            <button
              type="button"
              onClick={() => handleLoadSampleFile('pdf')}
              disabled={extractingFile || loadingSample !== null}
              aria-label="Try sample NDA PDF processed locally"
              aria-busy={loadingSample === 'pdf'}
              className="inline-flex items-center gap-1 rounded-md bg-[var(--n-surface)] px-2.5 py-1 text-[12px] font-medium text-[var(--n-text)] transition hover:bg-[var(--n-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--n-accent)] disabled:opacity-50"
            >
              {loadingSample === 'pdf' ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <FileText className="h-3 w-3" />
              )}
              {loadingSample === 'pdf' ? 'Loading PDF…' : 'NDA PDF'}
            </button>
            <button
              type="button"
              onClick={() => handleLoadSampleFile('image')}
              disabled={extractingFile || loadingSample !== null}
              aria-label="Try sample ID card image for local OCR redaction"
              aria-busy={loadingSample === 'image'}
              className="inline-flex items-center gap-1 rounded-md bg-[var(--n-surface)] px-2.5 py-1 text-[12px] font-medium text-[var(--n-text)] transition hover:bg-[var(--n-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--n-accent)] disabled:opacity-50"
            >
              {loadingSample === 'image' ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <ImageIcon className="h-3 w-3" />
              )}
              {loadingSample === 'image' ? 'Loading image…' : 'ID image'}
            </button>
          </div>
        </div>

        {/* Clean 2-Tab Bar + Subtle Diff/Payload Inspector Icons */}
        <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--n-border)] pb-2">
          <div className="flex items-center gap-1">
            {originalFile && (
              <button
                type="button"
                onClick={() => onInputTabChange('preview')}
                title="View uploaded file in its original layout with leak highlights and redaction preview"
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium transition ${
                  inputTab === 'preview'
                    ? 'bg-[var(--n-surface)] text-[var(--n-text)]'
                    : 'text-[var(--n-muted)] hover:bg-[var(--n-hover)] hover:text-[var(--n-text)]'
                }`}
              >
                <FileText className="h-3.5 w-3.5 text-[var(--n-accent)]" />
                Preview{originalFileExt ? ` (.${originalFileExt})` : ''}
              </button>
            )}
            <button
              type="button"
              onClick={() => onInputTabChange('original')}
              className={`rounded-md px-2.5 py-1 text-[13px] font-medium transition ${
                inputTab === 'original'
                  ? 'bg-[var(--n-surface)] text-[var(--n-text)]'
                  : 'text-[var(--n-muted)] hover:bg-[var(--n-hover)] hover:text-[var(--n-text)]'
              }`}
            >
              {originalFile ? 'Text' : 'Document'}
            </button>
            <button
              type="button"
              onClick={() => onInputTabChange('safe')}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium transition ${
                inputTab === 'safe'
                  ? 'bg-[var(--n-accent-soft)] text-[var(--n-accent)]'
                  : 'text-[var(--n-muted)] hover:bg-[var(--n-hover)] hover:text-[var(--n-text)]'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Safe preview ({redaction.vault.length + manualPdfBoxes.length})
            </button>
          </div>

          <div className="flex items-center gap-1 text-[12px]">
            <button
              type="button"
              onClick={() => onInputTabChange(inputTab === 'diff' ? 'original' : 'diff')}
              title="Compare original vs safe payload side-by-side"
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 transition ${
                inputTab === 'diff'
                  ? 'bg-[var(--n-surface)] font-medium text-[var(--n-text)]'
                  : 'text-[var(--n-muted)] hover:bg-[var(--n-hover)] hover:text-[var(--n-text)]'
              }`}
            >
              <Columns2 className="h-3.5 w-3.5" />
              Diff
            </button>
            <button
              type="button"
              onClick={() => onInputTabChange(inputTab === 'audit' ? 'original' : 'audit')}
              title="Inspect exact text sent to AI"
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 transition ${
                inputTab === 'audit'
                  ? 'bg-[var(--n-surface)] font-medium text-[var(--n-text)]'
                  : 'text-[var(--n-muted)] hover:bg-[var(--n-hover)] hover:text-[var(--n-text)]'
              }`}
            >
              <Code2 className="h-3.5 w-3.5" />
              Payload
            </button>
          </div>
        </div>

        {/* Honest detection scope note */}
        <p className="mb-2 shrink-0 text-[11.5px] text-[var(--n-muted)]">
          Regex + Context Guard + on-device Nano + manual marks · review Diff before sending.
        </p>

        {/* Smart Context Guard banner (shown when educational/sample items are preserved or overridden) */}
        {(keptSafeCount > 0 || !smartContextGuard) && (
          <div
            role="status"
            aria-live="polite"
            className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--n-accent-border)] bg-[var(--n-accent-soft)] px-2.5 py-1.5 text-[12px] text-[var(--n-text)]"
          >
            <span className="min-w-0">
              {smartContextGuard
                ? `Smart Context Guard · ${contextGuardSummary}`
                : 'Strict masking active · all patterns (including lab/sample items) are masked'}
            </span>
            <button
              type="button"
              onClick={onToggleSmartContextGuard}
              className="shrink-0 rounded px-2 py-0.5 text-[11.5px] font-medium text-[var(--n-accent)] transition hover:bg-[var(--n-bg)]"
            >
              {smartContextGuard ? 'Mask all anyway' : 'Enable smart guard'}
            </button>
          </div>
        )}

        {/* Local Extraction Status / Meta Line */}
        {extractingFile && (
          <div
            aria-live="polite"
            className="mb-2 flex shrink-0 items-center gap-2 rounded-md bg-[var(--n-surface)] px-3 py-1.5 text-[12.5px] text-[var(--n-text)]"
          >
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-[var(--n-accent)]" />
            Extracting locally…
          </div>
        )}

        {fileMeta && !extractingFile && (
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2 rounded-md bg-[var(--n-surface)] px-3 py-1.5 text-[12px] text-[var(--n-muted)]">
            <span className="flex min-w-0 items-center gap-1.5 truncate">
              <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--n-accent)]" />
              <span className="truncate">{fileMeta}</span>
            </span>
            <button
              type="button"
              onClick={onClearFileMeta}
              aria-label="Dismiss file info"
              className="shrink-0 rounded p-0.5 hover:bg-[var(--n-hover)] hover:text-[var(--n-text)]"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Clean Notion Editorial Surface */}
        <div className="flex min-h-0 flex-1 flex-col">
          {(inputTab === 'diff' || inputTab === 'audit') && (
            <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--n-border)] bg-[var(--n-surface)] px-2.5 py-1.5 text-[12px]">
              {nanoStatus === 'available' ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={onScanNano}
                      disabled={scanningNano || running || !rawText.trim()}
                      aria-label="Scan semantic PII locally with Gemini Nano before sending"
                      aria-busy={scanningNano}
                      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-medium text-[var(--n-text)] transition hover:bg-[var(--n-hover)] hover:text-[var(--n-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--n-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {scanningNano ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin text-[var(--n-accent)]" />
                      ) : (
                        <Cpu className="h-3.5 w-3.5 text-[var(--n-accent)]" />
                      )}
                      {scanningNano ? 'Scanning with Nano…' : 'Scan semantic PII (Nano)'}
                    </button>
                    {scanningNano && (
                      <button
                        type="button"
                        onClick={onCancelNanoScan}
                        aria-label="Cancel Gemini Nano semantic scan"
                        className="rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-[var(--n-danger)] transition hover:bg-[var(--n-danger-soft)]"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                  <span
                    role="status"
                    aria-live="polite"
                    className={`text-[11.5px] ${
                      nanoScanTruncated || nanoScanTimedOut
                        ? 'font-medium text-[var(--n-warn)]'
                        : 'text-[var(--n-muted)]'
                    }`}
                  >
                    {nanoScanNotice ?? 'Preview local Nano entity masks before cloud analysis'}
                  </span>
                </>
              ) : nanoStatus === 'downloading' || nanoStatus === 'downloadable' ? (
                <>
                  <button
                    type="button"
                    disabled
                    aria-label="Scan semantic PII locally with Gemini Nano (model not ready yet)"
                    className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md px-2 py-0.5 font-medium text-[var(--n-muted)] opacity-60"
                  >
                    <Cpu className="h-3.5 w-3.5" />
                    Scan semantic PII (Nano)
                  </button>
                  <div className="flex flex-wrap items-center gap-2">
                    <span role="status" aria-live="polite" className="text-[11.5px] text-[var(--n-muted)]">
                      {nanoStatus === 'downloading'
                        ? 'Gemini Nano model downloading…'
                        : 'Gemini Nano ready to download in Chrome'}
                    </span>
                    <button
                      type="button"
                      onClick={onOpenNanoGuide}
                      className="rounded-md px-2 py-0.5 text-[11.5px] font-medium text-[var(--n-accent)] transition hover:bg-[var(--n-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--n-accent)]"
                    >
                      Open settings →
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled
                    aria-label="Scan semantic PII locally with Gemini Nano (enable Chrome Built-in AI)"
                    className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md px-2 py-0.5 font-medium text-[var(--n-muted)] opacity-60"
                  >
                    <Cpu className="h-3.5 w-3.5" />
                    Scan semantic PII (Nano)
                  </button>
                  <div className="flex flex-wrap items-center gap-2">
                    <span role="status" aria-live="polite" className="text-[11.5px] text-[var(--n-muted)]">
                      {nanoStatus === 'checking'
                        ? 'Checking Chrome Built-in AI…'
                        : 'Enable Chrome Built-in AI for local name/org discovery'}
                    </span>
                    <button
                      type="button"
                      onClick={onOpenNanoGuide}
                      className="rounded-md px-2 py-0.5 text-[11.5px] font-medium text-[var(--n-accent)] transition hover:bg-[var(--n-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--n-accent)]"
                    >
                      Enable Gemini Nano →
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {inputTab === 'original' ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {selectedText && (
                <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2 rounded-md border border-[var(--n-accent-border)] bg-[var(--n-accent-soft)] px-2.5 py-1 text-[12px]">
                  <span className="truncate text-[var(--n-text)]">
                    Selected: <code className="font-mono">&ldquo;{selectedText}&rdquo;</code>
                  </span>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleMarkSelectedAsSensitive}
                    aria-label={`Mark "${selectedText}" as sensitive`}
                    title="Shortcut: Ctrl/Cmd + Shift + M"
                    className="shrink-0 rounded px-2 py-0.5 font-medium text-[var(--n-accent)] transition hover:bg-[var(--n-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--n-accent)]"
                  >
                    Mark as sensitive <span className="ml-1 font-mono text-[10.5px] opacity-75">⇧⌘M</span>
                  </button>
                </div>
              )}
              <textarea
                id="document-input"
                name="documentInput"
                aria-label="Document input"
                ref={textareaRef}
                value={rawText}
                onChange={(e) => onRawTextChange(e.target.value)}
                onSelect={syncSelection}
                onKeyUp={syncSelection}
                onMouseUp={syncSelection}
                onKeyDown={handleTextareaKeyDown}
                rows={7}
                placeholder="Paste text or drop a PDF, Word (.docx), log file, or image here. Highlight any word and press Ctrl/Cmd+Shift+M to mark it sensitive…"
                className="min-h-[140px] w-full flex-1 resize-none overflow-y-auto rounded bg-transparent py-1.5 pb-3 text-[14.5px] leading-[1.65] text-[var(--n-text)] placeholder:text-[var(--n-muted)] focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--n-accent)]"
              />
              {activeManualTerms.length > 0 && (
                <div
                  aria-label="Manually marked sensitive terms active in this document"
                  className="mt-1.5 flex shrink-0 flex-wrap items-center gap-1.5 border-t border-[var(--n-border)] pt-2 text-[11.5px]"
                >
                  <span className="text-[var(--n-muted)]">Marked sensitive:</span>
                  {activeManualTerms.map((term) => (
                    <span
                      key={term}
                      className="inline-flex items-center gap-1 rounded border border-[var(--n-border)] bg-[var(--n-surface)] px-2 py-0.5 text-[var(--n-text)]"
                    >
                      <span>{term}</span>
                      <button
                        type="button"
                        onClick={() => onRemoveManualTerm(term)}
                        aria-label={`Remove marked term ${term}`}
                        className="rounded p-0.5 text-[var(--n-muted)] transition hover:bg-[var(--n-hover)] hover:text-[var(--n-danger)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--n-accent)]"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : inputTab === 'safe' ? (
            <div className="min-h-0 flex-1 overflow-y-auto py-2 pb-4 text-[14.5px] leading-[1.65] text-[var(--n-text)]">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12.5px] text-[var(--n-muted)]">
                  Safe preview before sending. Click any highlighted tag to peek locally — run Analyze safely to verify and export.
                </p>
                <button
                  type="button"
                  onClick={handleCopySafeText}
                  disabled={!redaction.redactedText}
                  title="Copy masked safe text to paste into ChatGPT, Gemini, or Claude"
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--n-border)] bg-[var(--n-surface)] px-2 py-1 text-[11.5px] font-medium text-[var(--n-text)] transition hover:bg-[var(--n-hover)] disabled:opacity-40"
                >
                  {safeCopied ? (
                    <CheckCircle2 className="h-3 w-3 text-[var(--n-accent)]" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  {safeCopied ? 'Copied' : 'Copy safe text'}
                </button>
              </div>
              <HighlightedRedactedText text={redaction.redactedText} vaultLookup={vaultLookup} />
            </div>
          ) : inputTab === 'preview' && originalFile ? (
            <Suspense
              fallback={
                <div className="flex min-h-[180px] items-center justify-center gap-2 text-[13px] text-[var(--n-muted)]">
                  <RefreshCw className="h-4 w-4 animate-spin text-[var(--n-accent)]" />
                  Rendering original document preview…
                </div>
              }
            >
              <DocumentPreviewPane
                file={originalFile}
                rawText={rawText}
                vault={redaction.vault}
                ignoredValues={ignoredValues}
                manualPdfBoxes={manualPdfBoxes}
                onAddManualBox={(b) => onAddManualBox?.(b)}
                onRemoveManualBox={(id) => onRemoveManualBox?.(id)}
                onAddManualTerm={onAddManualTerm}
                onWhitelistValue={(v) => onWhitelistValue?.(v)}
                onRestoreWhitelisted={(v) => onRestoreWhitelisted?.(v)}
              />
            </Suspense>
          ) : inputTab === 'diff' ? (
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto py-1.5 sm:grid-cols-2 sm:overflow-hidden">
              <div className="min-h-0 overflow-y-auto rounded-lg border border-[var(--n-border)] bg-[var(--n-surface)] p-3 pb-4 text-[13.5px] leading-relaxed">
                <div className="mb-2 flex items-center justify-between gap-2 text-[12px] font-medium text-[var(--n-muted)]">
                  <span>Original</span>
                  <span className="shrink-0 font-mono tabular-nums text-[var(--n-danger)]">
                    {redaction.bytesShielded}B private
                  </span>
                </div>
                <HighlightedRawPii rawText={rawText} vault={redaction.vault} />
              </div>
              <div className="min-h-0 overflow-y-auto rounded-lg border border-[var(--n-border)] bg-[var(--n-surface)] p-3 pb-4 text-[13.5px] leading-relaxed">
                <div className="mb-2 flex items-center justify-between gap-2 text-[12px] font-medium text-[var(--n-muted)]">
                  <span>Safe payload</span>
                  <span className="shrink-0 font-mono text-[11px] font-normal tabular-nums text-[var(--n-accent)]">
                    rx {redaction.sourceCounts.regex} · Na {redaction.sourceCounts.nano} · man {redaction.sourceCounts.manual}
                  </span>
                </div>
                <HighlightedRedactedText text={redaction.redactedText} vaultLookup={vaultLookup} />
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-[var(--n-border)] bg-[var(--n-surface)] p-3.5 pb-4 font-mono text-[12px] leading-relaxed text-[var(--n-text)]">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 font-sans text-[12px] font-medium text-[var(--n-muted)]">
                <span>Exact network payload (0 detected PII included):</span>
                <span className="rounded bg-[var(--n-bg)] px-2 py-0.5 text-[11px] text-[var(--n-muted)]">
                  {nanoScanCompleted ? (
                    <span className="text-[var(--n-text)]">
                      {redaction.sourceCounts.nano}{' '}
                      {redaction.sourceCounts.nano === 1 ? 'entity' : 'entities'} found on-device by
                      Gemini Nano
                    </span>
                  ) : nanoStatus === 'available' ? (
                    'Nano scan not run yet'
                  ) : (
                    'Nano scan not run (model not downloaded)'
                  )}
                </span>
              </div>
              <pre className="whitespace-pre-wrap break-words">{outgoingPrompt}</pre>
            </div>
          )}

          {/* Attached Image Strip */}
          {attachedImage && (
            <div className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--n-border)] bg-[var(--n-surface)] px-3 py-2 text-[13px]">
              <div className="flex min-w-0 items-center gap-2.5">
                <img
                  src={attachedImage.previewUrl}
                  alt={attachedImage.name}
                  width={32}
                  height={32}
                  className="h-8 w-8 shrink-0 rounded object-cover"
                />
                <div className="min-w-0">
                  <div className="truncate font-medium text-[var(--n-text)]">{attachedImage.name}</div>
                  <div className="text-[12px] text-[var(--n-muted)]">
                    {imageMaskCount > 0
                      ? `${imageMaskCount} area${imageMaskCount > 1 ? 's' : ''} hidden locally`
                      : 'Click Hide areas to auto-detect or cover private text'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {imageMaskCount > 0 && (
                  <button
                    type="button"
                    onClick={handleDownloadRedactedImage}
                    title="Download redacted image to upload to any AI tool"
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--n-border)] bg-[var(--n-bg)] px-2 py-1 text-[12px] font-medium text-[var(--n-text)] transition hover:bg-[var(--n-hover)]"
                  >
                    <Download className="h-3 w-3" />
                    Save image
                  </button>
                )}
                <button
                  type="button"
                  onClick={onOpenImageRedactor}
                  className="rounded-md border border-[var(--n-border)] bg-[var(--n-bg)] px-2.5 py-1 text-[12px] font-medium text-[var(--n-text)] transition hover:bg-[var(--n-hover)]"
                >
                  Hide areas
                </button>
                <button
                  type="button"
                  onClick={onRemoveImage}
                  className="rounded p-1 text-[var(--n-muted)] hover:bg-[var(--n-hover)] hover:text-[var(--n-danger)]"
                  aria-label="Remove image"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Action Footer: 2 balanced rows (mode strip, action row) */}
        <div className="mt-3 flex shrink-0 flex-col gap-2.5 border-t border-[var(--n-border)] pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-[12px] font-medium text-[var(--n-muted)]">Mode</span>
            {/* Compact Notion-style Hybrid Mode Segmented Pill */}
            <div
              role="group"
              aria-label="Hybrid inference mode"
              className="inline-flex items-center rounded-md border border-[var(--n-border)] bg-[var(--n-surface)] p-0.5"
            >
              {QUICK_MODE_OPTIONS.map((opt) => {
                const isActive = activeQuickMode === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => onQuickModeChange(opt.key)}
                    disabled={running}
                    title={opt.title}
                    aria-pressed={isActive}
                    className={`whitespace-nowrap rounded-[4px] px-2 py-1 text-[11.5px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      isActive
                        ? 'bg-[var(--n-bg)] text-[var(--n-text)] shadow-2xs ring-1 ring-[var(--n-border)]'
                        : 'text-[var(--n-muted)] hover:text-[var(--n-text)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            </div>
            <span className="hidden text-[11.5px] text-[var(--n-muted)] sm:inline">Ctrl + Enter</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
            <input
              id="attach-doc-file"
              name="attachDocFile"
              ref={textFileRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,.log,.json,.env,.csv"
              onChange={onTextFileUpload}
              className="hidden"
            />
            <input
              id="attach-img-file"
              name="attachImgFile"
              ref={imageFileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={onImageUpload}
              className="hidden"
            />

            {/* Single + Attach Menu */}
            <div ref={attachMenuRef} className="relative">
              <button
                type="button"
                aria-expanded={attachMenuOpen}
                aria-haspopup="menu"
                onClick={() => setAttachMenuOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--n-border)] bg-[var(--n-bg)] px-2.5 py-1.5 text-[13px] font-medium text-[var(--n-text)] transition hover:bg-[var(--n-hover)]"
              >
                <Paperclip className="h-3.5 w-3.5 text-[var(--n-muted)]" />
                Attach
              </button>
              {attachMenuOpen && (
                <div
                  role="menu"
                  className="absolute bottom-full left-0 z-20 mb-1.5 w-56 rounded-lg border border-[var(--n-border)] bg-[var(--n-bg)] p-1"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAttachMenuOpen(false);
                      textFileRef.current?.click();
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-[var(--n-text)] hover:bg-[var(--n-hover)]"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--n-muted)]" />
                    Document (PDF, DOCX, TXT)
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAttachMenuOpen(false);
                      imageFileRef.current?.click();
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-[var(--n-text)] hover:bg-[var(--n-hover)]"
                  >
                    <ImageIcon className="h-3.5 w-3.5 shrink-0 text-[var(--n-muted)]" />
                    Image (with auto-mask)
                  </button>
                </div>
              )}
            </div>

            <select
              id="analysis-goal"
              name="analysisGoal"
              aria-label="Analysis goal"
              value={task}
              onChange={(e) => onTaskChange(e.target.value as AnalysisTask)}
              className="rounded-md border border-[var(--n-border)] bg-[var(--n-bg)] px-2.5 py-1.5 text-[13px] font-medium text-[var(--n-text)] transition hover:bg-[var(--n-hover)] focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--n-accent)]"
            >
              {TASK_OPTIONS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
            </div>
          <div className="flex shrink-0 items-center gap-2">
            {running && (
              <button
                type="button"
                onClick={onStop}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--n-border)] bg-[var(--n-bg)] px-3 py-1.5 text-[13px] font-medium text-[var(--n-danger)] transition hover:bg-[var(--n-danger-soft)]"
              >
                <Square className="h-3 w-3 fill-current" />
                Stop
              </button>
            )}

            <button
              type="button"
              onClick={onRunPipeline}
              disabled={running || extractingFile || !rawText.trim()}
              title="Shortcut: Ctrl + Enter"
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--n-accent)] px-4 py-1.5 text-[13.5px] font-medium text-[var(--n-accent-fg)] transition hover:bg-[var(--n-accent-hover)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {running ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Analyzing…
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 fill-current" />
                  Analyze safely
                </>
              )}
            </button>
          </div>
          </div>
        </div>
      </section>
    );
  }
);

DocumentInputPanel.displayName = 'DocumentInputPanel';
