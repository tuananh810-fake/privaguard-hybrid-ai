import React, { memo, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Cloud,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  FileWarning,
  Lock,
  RefreshCw,
  Save,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  extractRiskBanner,
  FollowUpMessage,
  HybridResponse,
  StructuredAuditReport,
} from '../services/hybridAI';
import { rehydrateLocally, SourceCounts, VaultEntry } from '../services/piiVault';
import { HighlightedRedactedText, RichOutput } from './RichOutput';
import { ExportMenuButton, ExportMenuOption } from './ExportMenuButton';
import type { SafeDocumentExportFormat } from '../services/fileRedactor';

export interface RunMetrics {
  sourceCounts: SourceCounts;
  bytesSentToCloud: number;
  rawPiiBytesSent: number;
  shieldTimeMs: number;
  sentPayloadText: string;
  sentVaultCount: number;
  sentBytesShielded: number;
  sentLeakCount: number;
}

interface AnalysisOutputPanelProps {
  result: HybridResponse | null;
  runMetrics: RunMetrics | null;
  isHistoricalView: boolean;
  displayedMarkdown: string;
  running: boolean;
  errorMsg: string | null;
  vault: VaultEntry[];
  vaultLookup: Record<string, VaultEntry>;
  bytesShielded: number;
  shieldTimeMs: number;
  rehydrate: boolean;
  onToggleRehydrate: () => void;
  savingHistory: boolean;
  savedNotice: string | null;
  onSaveToFirestore: () => void;
  copied: boolean;
  onCopyReport: () => void;
  originalFile?: File | null;
  exportingSafeFile?: boolean;
  exportNotice?: string | null;
  onExportSafeDocument: (format: SafeDocumentExportFormat) => void;
  onRetryPrimaryModel?: () => void;
  onQuickStart: () => void;
  onSwitchToFastCloud: () => void;
  followUps: FollowUpMessage[];
  followUpStreaming: string;
  followUpRunning: boolean;
  onSendFollowUp: (question: string) => void;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatEngineLabel(result: HybridResponse): string {
  if (result.inferenceSource === 'ON_DEVICE') {
    return 'Ran on: Device (Nano)';
  }
  const cleanModel = result.modelUsed.replace(/\s*\(Cloud\)\s*$/i, '').trim() || 'gemini-3.6-flash';
  return `Ran on: Cloud (${cleanModel})`;
}

const EMPTY_VAULT: VaultEntry[] = [];
const EMPTY_VAULT_LOOKUP: Record<string, VaultEntry> = {};

const SEVERITY_BADGE: Record<string, string> = {
  CRITICAL: 'bg-[var(--n-danger-soft)] text-[var(--n-danger)]',
  HIGH: 'bg-[var(--n-warn-soft)] text-[var(--n-warn)]',
  MEDIUM: 'bg-[var(--n-warn-soft)] text-[var(--n-warn)]',
  LOW: 'bg-[var(--n-accent-soft)] text-[var(--n-accent)]',
};

const StructuredAuditView: React.FC<{
  report: StructuredAuditReport;
  rehydrate: boolean;
  vault: VaultEntry[];
  vaultLookup: Record<string, VaultEntry>;
}> = memo(({ report, rehydrate, vault, vaultLookup }) => {
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  useEffect(() => {
    setChecked({});
  }, [report]);
  const completedCount = Object.values(checked).filter(Boolean).length;
  const format = (s: string) => (rehydrate ? rehydrateLocally(s, vault) : s);

  const barColor =
    report.riskScore >= 75
      ? 'bg-[var(--n-danger)]'
      : report.riskScore >= 40
        ? 'bg-[var(--n-warn)]'
        : 'bg-[var(--n-accent)]';

  return (
    <div className="space-y-6">
      {/* Notion Callout for Overall Risk */}
      <div className="rounded-lg border border-[var(--n-border)] bg-[var(--n-surface)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--n-text)]">
            <ShieldAlert className="h-4 w-4 text-[var(--n-warn)]" />
            <span>Risk level:</span>
            <span
              className={`rounded px-2 py-0.5 text-[12px] font-medium ${SEVERITY_BADGE[report.riskLevel]}`}
            >
              {report.riskLevel.charAt(0) + report.riskLevel.slice(1).toLowerCase()}
            </span>
          </div>
          <span className="font-mono text-[12.5px] tabular-nums text-[var(--n-muted)]">
            Score {report.riskScore}/100
          </span>
        </div>

        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--n-border)]">
          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${report.riskScore}%` }} />
        </div>

        <div className="mt-3 text-[14.5px] leading-[1.6] text-[var(--n-text)]">
          <HighlightedRedactedText text={format(report.summary)} vaultLookup={vaultLookup} />
        </div>

        {report.complianceFrameworks.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {report.complianceFrameworks.map((fw) => (
              <span
                key={fw}
                className="rounded border border-[var(--n-border)] bg-[var(--n-bg)] px-2 py-0.5 font-mono text-[11px] text-[var(--n-muted)]"
              >
                {fw}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Findings List */}
      <div>
        <h3 className="mb-3 text-[16px] font-semibold tracking-tight text-[var(--n-text)]">
          Key findings
        </h3>
        <div className="space-y-3">
          {report.findings.map((f, idx) => (
            <div
              key={idx}
              className="border-b border-[var(--n-border)] pb-3 last:border-b-0 last:pb-0"
            >
              <div className="mb-1 flex items-start justify-between gap-2">
                <span className="min-w-0 break-words text-[14.5px] font-medium text-[var(--n-text)]">
                  <HighlightedRedactedText text={format(f.title)} vaultLookup={vaultLookup} inline />
                </span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${SEVERITY_BADGE[f.severity]}`}
                >
                  {f.severity.charAt(0) + f.severity.slice(1).toLowerCase()}
                </span>
              </div>
              <div className="min-w-0 break-words text-[14px] leading-[1.6] text-[var(--n-muted)]">
                <HighlightedRedactedText text={format(f.detail)} vaultLookup={vaultLookup} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Interactive Notion To-Do Checklist */}
      <div>
        <div className="mb-2.5 flex items-center justify-between">
          <h3 className="text-[16px] font-semibold tracking-tight text-[var(--n-text)]">
            Recommended next steps
          </h3>
          <span className="font-mono text-[12px] tabular-nums text-[var(--n-muted)]">
            {completedCount}/{report.remediations.length} done
          </span>
        </div>
        <div className="space-y-1.5">
          {report.remediations.map((r, idx) => {
            const isDone = Boolean(checked[idx]);
            return (
              <label
                key={idx}
                className={`flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-[14.5px] transition hover:bg-[var(--n-surface)] ${
                  isDone ? 'text-[var(--n-muted)] line-through' : 'text-[var(--n-text)]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isDone}
                  onChange={() => setChecked((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                  className="mt-1 h-4 w-4 rounded accent-[var(--n-accent)]"
                />
                <div className="flex-1 leading-[1.6]">
                  <HighlightedRedactedText text={format(r.step)} vaultLookup={vaultLookup} />
                </div>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
});

StructuredAuditView.displayName = 'StructuredAuditView';

const FollowUpThread: React.FC<{
  followUps: FollowUpMessage[];
  followUpStreaming: string;
  rehydrate: boolean;
  vault: VaultEntry[];
  vaultLookup: Record<string, VaultEntry>;
}> = memo(({ followUps, followUpStreaming, rehydrate, vault, vaultLookup }) => {
  if (followUps.length === 0 && !followUpStreaming) return null;

  return (
    <div className="mt-8 space-y-4 border-t border-[var(--n-border)] pt-6">
      {followUps.map((msg) => {
        const text = rehydrate ? rehydrateLocally(msg.text, vault) : msg.text;
        return (
          <div key={msg.id}>
            {msg.role === 'user' ? (
              <p className="rounded-lg bg-[var(--n-surface)] px-3.5 py-2.5 text-[14px] font-medium text-[var(--n-text)]">
                {text}
              </p>
            ) : (
              <div className="pl-1">
                <RichOutput markdown={text} vaultLookup={vaultLookup} />
              </div>
            )}
          </div>
        );
      })}
      {followUpStreaming && (
        <div className="pl-1">
          <RichOutput
            markdown={rehydrate ? rehydrateLocally(followUpStreaming, vault) : followUpStreaming}
            vaultLookup={vaultLookup}
          />
        </div>
      )}
    </div>
  );
});

FollowUpThread.displayName = 'FollowUpThread';

export const AnalysisOutputPanel: React.FC<AnalysisOutputPanelProps> = memo(
  ({
    result,
    runMetrics,
    isHistoricalView,
    displayedMarkdown,
    running,
    errorMsg,
    vault,
    vaultLookup,
    bytesShielded,
    shieldTimeMs,
    rehydrate,
    onToggleRehydrate,
    savingHistory,
    savedNotice,
    onSaveToFirestore,
    copied,
    onCopyReport,
    originalFile = null,
    exportingSafeFile = false,
    exportNotice = null,
    onExportSafeDocument,
    onRetryPrimaryModel,
    onQuickStart,
    onSwitchToFastCloud,
    followUps,
    followUpStreaming,
    followUpRunning,
    onSendFollowUp,
  }) => {
    const [question, setQuestion] = useState('');
    const isNanoUnavailable = Boolean(result?.nanoUnavailable || result?.wasMockEcho);
    const hasVaultItems = vault.length > 0;
    const effectiveRehydrate = rehydrate && hasVaultItems && !isHistoricalView && !isNanoUnavailable;
    const effectiveVaultLookup = isHistoricalView || isNanoUnavailable ? undefined : vaultLookup;

    const originalFileName = originalFile?.name ?? null;
    const originalFileExt = originalFileName?.split('.').pop()?.toLowerCase() || '';

    const safeDocumentExportOptions = useMemo<ExportMenuOption[]>(() => {
      const ext = originalFileExt;
      const opts: ExportMenuOption[] = [];
      if (originalFileName && ext) {
        opts.push({
          id: 'original',
          label: `Keep original (.${ext})`,
          hint:
            ext === 'pdf'
              ? 'Original PDF layout · black redaction bars · 0 hidden text'
              : ext === 'docx'
                ? 'Original Word layout · shaded safe tokens · metadata scrubbed'
                : ext === 'csv'
                  ? 'Original CSV table · RFC-4180 cell-safe redaction'
                  : `Exact format-preserved safe-${originalFileName}`,
          highlight: true,
        });
      }
      opts.push(
        {
          id: 'pdf',
          label: 'Export safe .pdf',
          hint:
            ext === 'docx'
              ? 'Keeps Word tables & Unicode · blacked-out secrets · 0 hidden text'
              : ext === 'csv'
                ? 'Paginated redacted table PDF · 0 hidden text'
                : 'Verified sanitized document as clean PDF (0 hidden text)',
          highlight: !originalFileName,
        },
        {
          id: 'docx',
          label: 'Export safe .docx',
          hint: 'Verified sanitized document as Word (.docx) with shaded tokens',
        },
        { id: 'md', label: 'Export safe .md', hint: 'Verified sanitized Markdown content' },
        { id: 'txt', label: 'Export safe .txt', hint: 'Verified sanitized plain text' },
        { id: 'json', label: 'Export safe .json', hint: 'Syntax-safe sanitized JSON' }
      );
      return opts;
    }, [originalFileName, originalFileExt]);

    const riskBanner = useMemo(
      () =>
        !isNanoUnavailable && !result?.structuredAudit && displayedMarkdown
          ? extractRiskBanner(displayedMarkdown)
          : null,
      [isNanoUnavailable, result?.structuredAudit, displayedMarkdown]
    );

    function handleFollowUpSubmit(e: React.FormEvent) {
      e.preventDefault();
      const q = question.trim();
      if (!q || followUpRunning || running || isHistoricalView || isNanoUnavailable) return;
      setQuestion('');
      onSendFollowUp(q);
    }

    return (
      <section className="flex min-h-[540px] min-w-0 flex-col bg-[var(--n-bg)] px-5 py-5 sm:px-7 lg:h-full lg:min-h-0 lg:overflow-hidden lg:px-8">
        {/* Clean Page Header */}
        <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-2">
          <h2 className="text-[22px] font-bold tracking-tight text-[var(--n-text)]">Analysis</h2>

          {result && (
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--n-muted)]">
              {isNanoUnavailable ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-[var(--n-warn-border)] bg-[var(--n-warn-soft)] px-2 py-0.5 font-medium text-[var(--n-warn)]">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Nano unavailable
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md border border-[var(--n-border)] bg-[var(--n-surface)] px-2 py-0.5 font-medium text-[var(--n-text)]">
                  {result.inferenceSource === 'ON_DEVICE' ? (
                    <Cpu className="h-3.5 w-3.5 text-[var(--n-accent)]" />
                  ) : (
                    <Cloud className="h-3.5 w-3.5 text-[var(--n-accent)]" />
                  )}
                  {formatEngineLabel(result)}
                </span>
              )}
              {!isNanoUnavailable && result.cached && (
                <span className="rounded bg-[var(--n-accent-soft)] px-1.5 py-0.5 text-[var(--n-accent)]">
                  Cached
                </span>
              )}
              {!isNanoUnavailable && result.fallbackUsed && (
                <div className="inline-flex items-center gap-1.5">
                  <span
                    title={
                      result.fallbackReason === 'ttft_timeout'
                        ? 'Primary model exceeded 12s first-token timeout — automatically switched to fast Lite model'
                        : result.fallbackReason === 'cooldown_bypass'
                          ? 'Primary model cooling down after a recent rate limit/timeout'
                          : 'Primary model hit rate limit (429) — automatically switched to fast Lite model'
                    }
                    className="rounded bg-[var(--n-warn-soft)] px-1.5 py-0.5 text-[var(--n-warn)]"
                  >
                    Lite fallback
                  </span>
                  {onRetryPrimaryModel && !running && (
                    <button
                      type="button"
                      onClick={onRetryPrimaryModel}
                      className="rounded px-1.5 py-0.5 text-[11.5px] font-medium text-[var(--n-accent)] transition hover:bg-[var(--n-hover)]"
                    >
                      Retry 3.6 Flash
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Read-Only Historical Cloud Snapshot Callout */}
        {result && isHistoricalView && (
          <div
            role="status"
            className="mb-3 flex shrink-0 items-center gap-2 rounded-lg border border-[var(--n-border)] bg-[var(--n-surface)] px-3.5 py-2 text-[12.5px] text-[var(--n-muted)]"
          >
            <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--n-accent)]" />
            <span className="font-medium text-[var(--n-text)]">
              Anonymized Cloud Snapshot · Original secrets were never persisted (RAM-only vault)
            </span>
          </div>
        )}

        {/* Compact Hybrid Per-Run Metrics Strip */}
        {result && runMetrics && !isHistoricalView && (
          <div
            aria-label="Hybrid run metrics"
            className="mb-4 grid shrink-0 grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-[var(--n-border)] bg-[var(--n-surface)] px-3.5 py-2.5 text-[12px] sm:grid-cols-3 2xl:grid-cols-6"
          >
            <div className="min-w-0">
              <div className="text-[11px] text-[var(--n-muted)]">Engine</div>
              <div className="truncate font-medium text-[var(--n-text)]">
                {isNanoUnavailable
                  ? 'Nano unavailable'
                  : result.inferenceSource === 'ON_DEVICE'
                    ? 'Device (Nano)'
                    : result.modelUsed.replace(/\s*\(Cloud\)\s*$/i, '').trim()}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-[var(--n-muted)]">Latency</div>
              <div className="font-mono font-medium tabular-nums text-[var(--n-text)]">
                {isNanoUnavailable ? '—' : formatDuration(result.latencyMs)}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-[var(--n-muted)]">TTFT</div>
              <div className="font-mono font-medium tabular-nums text-[var(--n-text)]">
                {isNanoUnavailable ? '—' : formatDuration(result.ttftMs)}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-[var(--n-muted)]">Masked (rx/Na/man)</div>
              <div
                title={`regex: ${runMetrics.sourceCounts.regex}, Nano: ${runMetrics.sourceCounts.nano}, manual: ${runMetrics.sourceCounts.manual} (local shield ${shieldTimeMs < 1 ? '<1ms' : `${shieldTimeMs}ms`})`}
                className="font-mono font-medium tabular-nums text-[var(--n-text)]"
              >
                {runMetrics.sourceCounts.regex +
                  runMetrics.sourceCounts.nano +
                  runMetrics.sourceCounts.manual}{' '}
                <span className="text-[11px] font-normal text-[var(--n-muted)]">
                  ({runMetrics.sourceCounts.regex}/{runMetrics.sourceCounts.nano}/{runMetrics.sourceCounts.manual})
                </span>
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-[var(--n-muted)]">Bytes to cloud</div>
              <div className="font-mono font-medium tabular-nums text-[var(--n-text)]">
                {runMetrics.bytesSentToCloud.toLocaleString()} B
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-[var(--n-muted)]">Raw PII bytes sent</div>
              <div
                className={`font-mono font-medium tabular-nums ${
                  runMetrics.rawPiiBytesSent === 0 ? 'text-[var(--n-accent)]' : 'text-[var(--n-danger)]'
                }`}
              >
                {runMetrics.rawPiiBytesSent} B
              </div>
            </div>
          </div>
        )}

        {/* Error Callout */}
        {errorMsg && (
          <div
            role="alert"
            className="mb-3 shrink-0 rounded-lg border border-[var(--n-danger-border)] bg-[var(--n-danger-soft)] p-3.5 text-[13.5px] text-[var(--n-danger)]"
          >
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
              <FileWarning className="h-4 w-4" />
              Something went wrong
            </div>
            <p className="leading-relaxed">{errorMsg}</p>
          </div>
        )}

        {/* Honest On-Device Nano Unavailable Notice (suppresses Chromium mock echo) */}
        {isNanoUnavailable && (
          <div
            role="status"
            className="mb-3 shrink-0 rounded-lg border border-[var(--n-warn-border)] bg-[var(--n-warn-soft)] p-4 text-[13.5px] text-[var(--n-warn)]"
          >
            <div className="mb-1.5 flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              On-device Gemini Nano is not downloaded in this browser
            </div>
            <p className="leading-relaxed">
              Strict Offline blocked all outbound cloud traffic (<strong>0 B</strong> sent to cloud).
              Choose <strong>Fast Cloud</strong> to analyze masked tokens in the cloud, or enable
              Chrome Built-in AI to run fully offline on-device.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={onSwitchToFastCloud}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--n-accent)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--n-accent-fg)] transition hover:bg-[var(--n-accent-hover)]"
              >
                <Cloud className="h-3.5 w-3.5" />
                Switch to Fast Cloud
              </button>
              <a
                href="https://developer.chrome.com/docs/ai/built-in"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-[var(--n-warn-border)] bg-[var(--n-bg)] px-2.5 py-1.5 text-[12.5px] font-medium text-[var(--n-text)] transition hover:bg-[var(--n-hover)]"
              >
                How to enable Gemini Nano
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        )}

        {/* Notion Callout for Markdown Risk Banner */}
        {riskBanner && (
          <div className="mb-3 flex shrink-0 items-start gap-2.5 rounded-lg border border-[var(--n-border)] bg-[var(--n-surface)] px-4 py-3 text-[14px]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--n-warn)]" />
            <div>
              <span className="font-semibold text-[var(--n-text)]">
                Risk level: {riskBanner.level.charAt(0) + riskBanner.level.slice(1).toLowerCase()}
              </span>
              {riskBanner.summary && (
                <span className="ml-1.5 text-[var(--n-muted)]">{riskBanner.summary}</span>
              )}
            </div>
          </div>
        )}

        {/* Main Editorial Reading Area */}
        <div className="min-h-0 flex-1 overflow-y-auto pb-3">
          {isNanoUnavailable ? null : result?.structuredAudit ? (
            <>
              <StructuredAuditView
                report={result.structuredAudit}
                rehydrate={effectiveRehydrate}
                vault={isHistoricalView ? EMPTY_VAULT : vault}
                vaultLookup={effectiveVaultLookup ?? EMPTY_VAULT_LOOKUP}
              />
              <FollowUpThread
                followUps={followUps}
                followUpStreaming={followUpStreaming}
                rehydrate={effectiveRehydrate}
                vault={isHistoricalView ? EMPTY_VAULT : vault}
                vaultLookup={effectiveVaultLookup ?? EMPTY_VAULT_LOOKUP}
              />
            </>
          ) : displayedMarkdown ? (
            <>
              <RichOutput
                markdown={displayedMarkdown}
                vaultLookup={effectiveVaultLookup}
                isHistorical={isHistoricalView}
              />
              {running && (
                <span className="mt-2 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-[var(--n-accent)]" />
              )}
              <FollowUpThread
                followUps={followUps}
                followUpStreaming={followUpStreaming}
                rehydrate={effectiveRehydrate}
                vault={isHistoricalView ? EMPTY_VAULT : vault}
                vaultLookup={effectiveVaultLookup ?? EMPTY_VAULT_LOOKUP}
              />
            </>
          ) : running ? (
            <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2.5 text-center">
              <RefreshCw className="h-5 w-5 animate-spin text-[var(--n-accent)]" />
              <p className="text-[14.5px] font-medium text-[var(--n-text)]">
                Protected {vault.length} private item{vault.length === 1 ? '' : 's'} ({bytesShielded}B) on this device
              </p>
              <p className="text-[13px] text-[var(--n-muted)]">
                Streaming safe AI analysis…
              </p>
            </div>
          ) : (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center px-4 text-center">
              <div className="mb-3.5 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--n-accent-soft)] text-[var(--n-accent)]">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <h3 className="text-[16px] font-semibold tracking-tight text-[var(--n-text)]">
                Private hybrid analysis
              </h3>
              <p className="mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-[var(--n-muted)]">
                Detected secrets stay in local RAM. AI only sees safe placeholders—click any token to peek.
              </p>
              <ol className="mt-4 flex flex-wrap items-center justify-center gap-1.5 text-[11.5px] text-[var(--n-muted)]">
                <li className="rounded-md border border-[var(--n-border)] bg-[var(--n-surface)] px-2 py-0.5">1. Local mask</li>
                <li aria-hidden="true">→</li>
                <li className="rounded-md border border-[var(--n-border)] bg-[var(--n-surface)] px-2 py-0.5">2. Safe AI</li>
                <li aria-hidden="true">→</li>
                <li className="rounded-md border border-[var(--n-border)] bg-[var(--n-surface)] px-2 py-0.5">3. Local restore</li>
              </ol>
              <button
                type="button"
                onClick={onQuickStart}
                className="mt-5 inline-flex items-center gap-1.5 rounded-md border border-[var(--n-accent-border)] bg-[var(--n-bg)] px-3.5 py-1.5 text-[13.5px] font-medium text-[var(--n-accent)] transition hover:bg-[var(--n-accent-soft)]"
              >
                Analyze this sample
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Quiet Ghost Action Bar + Notion AI Follow-up Input */}
        {result && !isNanoUnavailable && (
          <div className="mt-4 shrink-0 space-y-3 border-t border-[var(--n-border)] pt-3">
            {(savedNotice || exportNotice) && (
              <div
                aria-live="polite"
                className="flex flex-wrap items-center gap-3 text-[12.5px] text-[var(--n-accent)]"
              >
                {exportNotice && (
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {exportNotice}
                  </span>
                )}
                {savedNotice && (
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {savedNotice}
                  </span>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={onToggleRehydrate}
                disabled={isHistoricalView || !hasVaultItems}
                title={
                  isHistoricalView
                    ? 'Original secrets were never saved to Firestore (RAM-only vault)'
                    : !hasVaultItems
                      ? 'No masked secrets in this document to reveal'
                      : effectiveRehydrate
                        ? 'Hide real values locally'
                        : 'Restore real values locally from RAM vault'
                }
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-45 ${
                  effectiveRehydrate
                    ? 'bg-[var(--n-warn-soft)] text-[var(--n-warn)]'
                    : 'text-[var(--n-text)] hover:bg-[var(--n-hover)]'
                }`}
              >
                {effectiveRehydrate ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {effectiveRehydrate ? 'Hide real names' : 'Show real names'}
              </button>

              <button
                type="button"
                onClick={onSaveToFirestore}
                disabled={savingHistory || isHistoricalView}
                title={isHistoricalView ? 'Already stored as a saved cloud snapshot' : 'Save anonymized report to Firestore'}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-[var(--n-muted)] transition hover:bg-[var(--n-hover)] hover:text-[var(--n-text)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Save className="h-3.5 w-3.5" />
                {savingHistory ? 'Saving…' : 'Save'}
              </button>

              <button
                type="button"
                onClick={onCopyReport}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-[var(--n-muted)] transition hover:bg-[var(--n-hover)] hover:text-[var(--n-text)]"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-[var(--n-accent)]" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied ? 'Copied' : 'Copy'}
              </button>

              <ExportMenuButton
                label="Export safe file"
                options={safeDocumentExportOptions}
                busy={exportingSafeFile}
                disabled={isHistoricalView || running}
                align="left"
                title={
                  isHistoricalView
                    ? 'Original document is never stored in cloud (RAM-only) — open or upload a document to export'
                    : 'Export your verified sanitized input file keeping its format (only sensitive info redacted)'
                }
                onSelect={(fmt) => onExportSafeDocument(fmt as SafeDocumentExportFormat)}
              />
            </div>

            {/* Slim Notion AI Follow-up Bar */}
            {!running && (
              <form
                onSubmit={handleFollowUpSubmit}
                className={`flex items-center gap-2 rounded-lg border border-[var(--n-border)] bg-[var(--n-surface)] px-3 py-1.5 ${
                  isHistoricalView ? 'opacity-65' : 'focus-within:border-[var(--n-accent)]'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--n-muted)]" />
                <input
                  id="followup-question"
                  name="followupQuestion"
                  aria-label="Follow-up question"
                  autoComplete="off"
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  disabled={followUpRunning || isHistoricalView}
                  placeholder={
                    isHistoricalView
                      ? 'Read-only snapshot · Analyze a document to ask follow-ups'
                      : 'Ask a follow-up question (private details auto-hidden)…'
                  }
                  className="min-w-0 flex-1 bg-transparent py-1 text-[13.5px] text-[var(--n-text)] placeholder:text-[var(--n-muted)] focus:outline-none disabled:cursor-not-allowed"
                />
                <button
                  type="submit"
                  disabled={!question.trim() || followUpRunning || isHistoricalView}
                  className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12.5px] font-medium text-[var(--n-accent)] transition hover:bg-[var(--n-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {followUpRunning ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  Ask
                </button>
              </form>
            )}
          </div>
        )}
      </section>
    );
  }
);

AnalysisOutputPanel.displayName = 'AnalysisOutputPanel';
