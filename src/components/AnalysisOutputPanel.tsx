import React, { memo, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Cloud,
  Copy,
  Cpu,
  Download,
  Eye,
  EyeOff,
  FileWarning,
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
import { rehydrateLocally, VaultEntry } from '../services/piiVault';
import { HighlightedRedactedText, RichOutput } from './RichOutput';

interface AnalysisOutputPanelProps {
  result: HybridResponse | null;
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
  onExportMarkdown: () => void;
  onQuickStart: () => void;
  followUps: FollowUpMessage[];
  followUpStreaming: string;
  followUpRunning: boolean;
  onSendFollowUp: (question: string) => void;
}

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
          <span className="font-mono text-[12.5px] text-[var(--n-muted)]">
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
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[14.5px] font-medium text-[var(--n-text)]">
                  {format(f.title)}
                </span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${SEVERITY_BADGE[f.severity]}`}
                >
                  {f.severity.charAt(0) + f.severity.slice(1).toLowerCase()}
                </span>
              </div>
              <div className="text-[14px] leading-[1.6] text-[var(--n-muted)]">
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
          <span className="font-mono text-[12px] text-[var(--n-muted)]">
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

export const AnalysisOutputPanel: React.FC<AnalysisOutputPanelProps> = memo(
  ({
    result,
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
    onExportMarkdown,
    onQuickStart,
    followUps,
    followUpStreaming,
    followUpRunning,
    onSendFollowUp,
  }) => {
    const [question, setQuestion] = useState('');

    const riskBanner = useMemo(
      () =>
        !result?.structuredAudit && displayedMarkdown ? extractRiskBanner(displayedMarkdown) : null,
      [result?.structuredAudit, displayedMarkdown]
    );

    function handleFollowUpSubmit(e: React.FormEvent) {
      e.preventDefault();
      const q = question.trim();
      if (!q || followUpRunning || running) return;
      setQuestion('');
      onSendFollowUp(q);
    }

    return (
      <section className="flex min-h-[calc(100vh-49px)] flex-col bg-[var(--n-bg)] px-6 py-7 sm:px-10">
        {/* Clean Page Header */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[22px] font-bold tracking-tight text-[var(--n-text)]">Analysis</h2>

          {result && (
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--n-muted)]">
              <span className="inline-flex items-center gap-1 rounded-md bg-[var(--n-surface)] px-2 py-0.5 text-[var(--n-text)]">
                {result.inferenceSource === 'ON_DEVICE' ? (
                  <Cpu className="h-3.5 w-3.5 text-[var(--n-accent)]" />
                ) : (
                  <Cloud className="h-3.5 w-3.5 text-[var(--n-accent)]" />
                )}
                {result.inferenceSource === 'ON_DEVICE' ? 'On-device Nano' : 'Cloud Gemini'}
              </span>
              <span className="font-mono">
                Shield {shieldTimeMs < 1 ? '<1ms' : `${shieldTimeMs}ms`} · AI {result.latencyMs}ms
              </span>
              {result.cached && (
                <span className="rounded bg-[var(--n-accent-soft)] px-1.5 py-0.5 text-[var(--n-accent)]">
                  Cached
                </span>
              )}
              {result.fallbackUsed && (
                <span className="rounded bg-[var(--n-warn-soft)] px-1.5 py-0.5 text-[var(--n-warn)]">
                  Lite fallback
                </span>
              )}
            </div>
          )}
        </div>

        {/* Error Callout */}
        {errorMsg && (
          <div className="mb-4 rounded-lg border border-[var(--n-danger-border)] bg-[var(--n-danger-soft)] p-3.5 text-[13.5px] text-[var(--n-danger)]">
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
              <FileWarning className="h-4 w-4" />
              Something went wrong
            </div>
            <p className="leading-relaxed">{errorMsg}</p>
          </div>
        )}

        {/* Mock Nano Notice */}
        {result?.wasMockEcho && (
          <div className="mb-4 rounded-lg border border-[var(--n-warn-border)] bg-[var(--n-warn-soft)] p-3.5 text-[13px] text-[var(--n-warn)]">
            Local Gemini Nano isn&apos;t downloaded in this browser yet. Open{' '}
            <strong>Settings</strong> and choose <strong>Fast Cloud</strong> (or turn off Offline
            mode) for live analysis.
          </div>
        )}

        {/* Notion Callout for Markdown Risk Banner */}
        {riskBanner && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-[var(--n-border)] bg-[var(--n-surface)] px-4 py-3 text-[14px]">
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
        <div className="flex-1 overflow-y-auto">
          {result?.structuredAudit ? (
            <>
              <StructuredAuditView
                report={result.structuredAudit}
                rehydrate={rehydrate}
                vault={vault}
                vaultLookup={vaultLookup}
              />

              {(followUps.length > 0 || followUpStreaming) && (
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
                        markdown={
                          rehydrate ? rehydrateLocally(followUpStreaming, vault) : followUpStreaming
                        }
                        vaultLookup={vaultLookup}
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          ) : displayedMarkdown ? (
            <>
              <RichOutput markdown={displayedMarkdown} vaultLookup={vaultLookup} />
              {running && (
                <span className="mt-2 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-[var(--n-accent)]" />
              )}

              {(followUps.length > 0 || followUpStreaming) && (
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
                        markdown={
                          rehydrate ? rehydrateLocally(followUpStreaming, vault) : followUpStreaming
                        }
                        vaultLookup={vaultLookup}
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          ) : running ? (
            <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2.5 text-center">
              <RefreshCw className="h-5 w-5 animate-spin text-[var(--n-accent)]" />
              <p className="text-[14.5px] font-medium text-[var(--n-text)]">
                Protected {vault.length} private item{vault.length === 1 ? '' : 's'} ({bytesShielded}B) on this device
              </p>
              <p className="text-[13px] text-[var(--n-muted)]">
                Streaming safe AI analysis...
              </p>
            </div>
          ) : (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center text-center">
              <div className="mb-3.5 flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--n-surface)] text-[var(--n-accent)]">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <p className="max-w-sm text-[15px] text-[var(--n-text)]">
                Your private details stay on this device while AI summarizes or audits the safe version.
              </p>
              <button
                type="button"
                onClick={onQuickStart}
                className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-[var(--n-border)] bg-[var(--n-surface)] px-3.5 py-1.5 text-[13.5px] font-medium text-[var(--n-text)] transition hover:bg-[var(--n-hover)]"
              >
                Analyze this sample
                <ArrowRight className="h-3.5 w-3.5 text-[var(--n-muted)]" />
              </button>
            </div>
          )}
        </div>

        {/* Quiet Ghost Action Bar + Notion AI Follow-up Input */}
        {result && (
          <div className="mt-5 space-y-3 border-t border-[var(--n-border)] pt-4">
            {savedNotice && (
              <div className="flex items-center gap-1.5 text-[12.5px] text-[var(--n-accent)]">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {savedNotice}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={onToggleRehydrate}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition ${
                  rehydrate
                    ? 'bg-[var(--n-warn-soft)] text-[var(--n-warn)]'
                    : 'text-[var(--n-text)] hover:bg-[var(--n-hover)]'
                }`}
              >
                {rehydrate ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {rehydrate ? 'Hide real names' : 'Show real names'}
              </button>

              <button
                type="button"
                onClick={onSaveToFirestore}
                disabled={savingHistory}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-[var(--n-muted)] transition hover:bg-[var(--n-hover)] hover:text-[var(--n-text)] disabled:opacity-45"
              >
                <Save className="h-3.5 w-3.5" />
                {savingHistory ? 'Saving...' : 'Save'}
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

              <button
                type="button"
                onClick={onExportMarkdown}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-[var(--n-muted)] transition hover:bg-[var(--n-hover)] hover:text-[var(--n-text)]"
              >
                <Download className="h-3.5 w-3.5" />
                Export
              </button>
            </div>

            {/* Slim Notion AI Follow-up Bar */}
            {!running && (
              <form
                onSubmit={handleFollowUpSubmit}
                className="flex items-center gap-2 rounded-lg border border-[var(--n-border)] bg-[var(--n-surface)] px-3 py-1.5 focus-within:border-[var(--n-accent)]"
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--n-muted)]" />
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  disabled={followUpRunning}
                  placeholder="Ask a follow-up question (private details auto-hidden)..."
                  className="flex-1 bg-transparent py-1 text-[13.5px] text-[var(--n-text)] placeholder:text-[var(--n-muted)] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!question.trim() || followUpRunning}
                  className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12.5px] font-medium text-[var(--n-accent)] transition hover:bg-[var(--n-hover)] disabled:opacity-40"
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
