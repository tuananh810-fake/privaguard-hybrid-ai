import React, { memo, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Cloud,
  Copy,
  Cpu,
  Database,
  Download,
  Eye,
  EyeOff,
  FileWarning,
  Gauge,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Zap,
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
  followUps: FollowUpMessage[];
  followUpStreaming: string;
  followUpRunning: boolean;
  onSendFollowUp: (question: string) => void;
}

const RISK_STYLES = {
  CRITICAL: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
  HIGH: 'border-orange-500/40 bg-orange-500/10 text-orange-200',
  MEDIUM: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  LOW: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
};

const PRIORITY_STYLES = {
  IMMEDIATE: 'bg-rose-500/20 text-rose-300 ring-rose-500/40',
  SHORT_TERM: 'bg-amber-500/20 text-amber-300 ring-amber-500/40',
  LONG_TERM: 'bg-sky-500/20 text-sky-300 ring-sky-500/40',
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

  const scoreColor =
    report.riskScore >= 80
      ? 'bg-rose-500'
      : report.riskScore >= 60
        ? 'bg-orange-500'
        : report.riskScore >= 35
          ? 'bg-amber-400'
          : 'bg-emerald-400';

  return (
    <div className="space-y-4">
      {/* Risk Score & Compliance Frameworks */}
      <div className={`rounded-xl border p-3.5 ${RISK_STYLES[report.riskLevel]}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-bold">
            <ShieldAlert className="h-4 w-4" />
            <span>STRUCTURED AUDIT · {report.riskLevel}</span>
          </div>
          <span className="font-mono text-xs font-bold">Risk Score: {report.riskScore}/100</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-950/60">
          <div className={`h-full rounded-full ${scoreColor}`} style={{ width: `${report.riskScore}%` }} />
        </div>
        <div className="mt-2 text-xs leading-relaxed">
          <HighlightedRedactedText text={format(report.summary)} vaultLookup={vaultLookup} />
        </div>
        {report.complianceFrameworks.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {report.complianceFrameworks.map((fw) => (
              <span
                key={fw}
                className="rounded-md bg-slate-950/60 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ring-1 ring-white/15"
              >
                {fw}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Structured Findings */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Compliance &amp; Security Findings ({report.findings.length})
        </h3>
        <div className="space-y-2">
          {report.findings.map((f, idx) => (
            <div
              key={idx}
              className="rounded-xl border border-[#1E2733] bg-[#10151C] p-3 text-xs"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-semibold text-white">{format(f.title)}</span>
                <span
                  className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ring-1 ${
                    RISK_STYLES[f.severity]
                  }`}
                >
                  {f.severity}
                </span>
              </div>
              <div className="text-slate-300">
                <HighlightedRedactedText text={format(f.detail)} vaultLookup={vaultLookup} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Interactive Remediation Checklist */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Remediation Checklist
          </h3>
          <span className="font-mono text-[11px] text-emerald-400">
            {completedCount}/{report.remediations.length} done
          </span>
        </div>
        <div className="space-y-1.5">
          {report.remediations.map((r, idx) => {
            const isDone = Boolean(checked[idx]);
            return (
              <label
                key={idx}
                className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 text-xs transition ${
                  isDone
                    ? 'border-emerald-500/30 bg-emerald-500/5 text-slate-400 line-through'
                    : 'border-[#1E2733] bg-[#10151C] text-slate-200 hover:border-slate-600'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isDone}
                  onChange={() => setChecked((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                  className="mt-0.5 h-3.5 w-3.5 rounded accent-emerald-500"
                />
                <div className="flex-1">
                  <span
                    className={`mr-2 inline-block rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ring-1 ${
                      PRIORITY_STYLES[r.priority]
                    }`}
                  >
                    {r.priority.replace('_', ' ')}
                  </span>
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
      <section className="flex flex-1 flex-col rounded-2xl border border-[#1E2733] bg-[#10151C] p-5 shadow-xl">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#1E2733] pb-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Sparkles className="h-4 w-4 text-sky-400" />
            AI analysis
          </h2>

          {result && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-medium ${
                  result.inferenceSource === 'ON_DEVICE'
                    ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40'
                    : 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/40'
                }`}
              >
                {result.inferenceSource === 'ON_DEVICE' ? (
                  <Cpu className="h-3 w-3" />
                ) : (
                  <Cloud className="h-3 w-3" />
                )}
                {result.inferenceSource === 'ON_DEVICE' ? 'On-Device Nano' : 'Cloud Gemini'}
              </span>
              {result.structuredAudit && (
                <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 font-medium text-indigo-300 ring-1 ring-indigo-500/35">
                  Structured JSON
                </span>
              )}
              {result.cached && (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-300">
                  Instant cache
                </span>
              )}
              {result.fallbackUsed && (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-300">
                  Lite fallback
                </span>
              )}
            </div>
          )}
        </div>

        {/* Hybrid Benchmark Telemetry Card */}
        {result && (
          <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl border border-[#1E2733] bg-[#0C1016] p-2.5 sm:grid-cols-4">
            <div className="rounded-lg bg-[#090C10] px-2.5 py-1.5">
              <div className="flex items-center gap-1 text-[10px] text-slate-400">
                <ShieldCheck className="h-3 w-3 text-emerald-400" />
                On-Device Shield
              </div>
              <div className="mt-0.5 font-mono text-xs font-semibold text-emerald-300">
                {shieldTimeMs < 1 ? '<1ms' : `${shieldTimeMs}ms`}
              </div>
            </div>
            <div className="rounded-lg bg-[#090C10] px-2.5 py-1.5">
              <div className="flex items-center gap-1 text-[10px] text-slate-400">
                <Zap className="h-3 w-3 text-amber-400" />
                AI First Token
              </div>
              <div className="mt-0.5 font-mono text-xs font-semibold text-amber-300">
                {result.ttftMs}ms
              </div>
            </div>
            <div className="rounded-lg bg-[#090C10] px-2.5 py-1.5">
              <div className="flex items-center gap-1 text-[10px] text-slate-400">
                <Gauge className="h-3 w-3 text-sky-400" />
                Total Latency
              </div>
              <div className="mt-0.5 font-mono text-xs font-semibold text-sky-300">
                {result.latencyMs}ms
              </div>
            </div>
            <div className="rounded-lg bg-[#090C10] px-2.5 py-1.5">
              <div className="flex items-center gap-1 text-[10px] text-slate-400">
                <ShieldAlert className="h-3 w-3 text-indigo-400" />
                Kept in RAM
              </div>
              <div className="mt-0.5 font-mono text-xs font-semibold text-white">
                {bytesShielded}B <span className="text-[10px] text-emerald-400">(0 leaked)</span>
              </div>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs text-rose-200">
            <div className="mb-1 flex items-center gap-1.5 font-semibold text-rose-300">
              <FileWarning className="h-4 w-4" />
              Analysis interrupted
            </div>
            <p className="leading-relaxed opacity-90">{errorMsg}</p>
          </div>
        )}

        {result?.wasMockEcho && (
          <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
            Local Gemini Nano weights aren&apos;t downloaded yet in this browser. Open{' '}
            <strong>Privacy &amp; Tech</strong> and switch to <strong>Fast Cloud</strong> (or disable{' '}
            <strong>Offline Sim</strong>) for live Gemini Cloud inference.
          </div>
        )}

        {riskBanner && (
          <div
            className={`mb-3 flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs ${RISK_STYLES[riskBanner.level]}`}
          >
            {riskBanner.level === 'CRITICAL' || riskBanner.level === 'HIGH' ? (
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <div>
              <span className="font-semibold">Risk severity: {riskBanner.level}</span>
              {riskBanner.summary && <span className="ml-1.5 opacity-90">{riskBanner.summary}</span>}
            </div>
          </div>
        )}

        <div className="min-h-[340px] flex-1 overflow-y-auto rounded-xl border border-[#1E2733] bg-[#090C10] p-5">
          {result?.structuredAudit ? (
            <>
              <StructuredAuditView
                report={result.structuredAudit}
                rehydrate={rehydrate}
                vault={vault}
                vaultLookup={vaultLookup}
              />

              {/* Follow-up Q&A Thread */}
              {(followUps.length > 0 || followUpStreaming) && (
                <div className="mt-6 space-y-3 border-t border-[#1E2733] pt-4">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                    <MessageSquare className="h-3.5 w-3.5 text-sky-400" />
                    Private follow-up Q&amp;A
                  </div>
                  {followUps.map((msg) => {
                    const text = rehydrate ? rehydrateLocally(msg.text, vault) : msg.text;
                    return (
                      <div
                        key={msg.id}
                        className={`rounded-xl p-3 text-xs ${
                          msg.role === 'user'
                            ? 'ml-6 border border-[#1E2733] bg-[#10151C] text-slate-200'
                            : 'border border-sky-500/20 bg-sky-500/5 text-slate-200'
                        }`}
                      >
                        {msg.role === 'user' ? (
                          <p className="font-medium text-white">{text}</p>
                        ) : (
                          <RichOutput markdown={text} vaultLookup={vaultLookup} />
                        )}
                      </div>
                    );
                  })}
                  {followUpStreaming && (
                    <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3">
                      <RichOutput
                        markdown={
                          rehydrate ? rehydrateLocally(followUpStreaming, vault) : followUpStreaming
                        }
                        vaultLookup={vaultLookup}
                      />
                      <span className="mt-1 inline-block h-3.5 w-2 animate-pulse rounded-sm bg-sky-400" />
                    </div>
                  )}
                </div>
              )}
            </>
          ) : displayedMarkdown ? (
            <>
              <RichOutput markdown={displayedMarkdown} vaultLookup={vaultLookup} />
              {running && (
                <span className="mt-2 inline-block h-4 w-2 animate-pulse rounded-sm bg-emerald-400" />
              )}

              {/* Follow-up Q&A Thread */}
              {(followUps.length > 0 || followUpStreaming) && (
                <div className="mt-6 space-y-3 border-t border-[#1E2733] pt-4">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                    <MessageSquare className="h-3.5 w-3.5 text-sky-400" />
                    Private follow-up Q&amp;A
                  </div>
                  {followUps.map((msg) => {
                    const text = rehydrate ? rehydrateLocally(msg.text, vault) : msg.text;
                    return (
                      <div
                        key={msg.id}
                        className={`rounded-xl p-3 text-xs ${
                          msg.role === 'user'
                            ? 'ml-6 border border-[#1E2733] bg-[#10151C] text-slate-200'
                            : 'border border-sky-500/20 bg-sky-500/5 text-slate-200'
                        }`}
                      >
                        {msg.role === 'user' ? (
                          <p className="font-medium text-white">{text}</p>
                        ) : (
                          <RichOutput markdown={text} vaultLookup={vaultLookup} />
                        )}
                      </div>
                    );
                  })}
                  {followUpStreaming && (
                    <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3">
                      <RichOutput
                        markdown={
                          rehydrate ? rehydrateLocally(followUpStreaming, vault) : followUpStreaming
                        }
                        vaultLookup={vaultLookup}
                      />
                      <span className="mt-1 inline-block h-3.5 w-2 animate-pulse rounded-sm bg-sky-400" />
                    </div>
                  )}
                </div>
              )}
            </>
          ) : running ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 py-12 text-center">
              <RefreshCw className="h-6 w-6 animate-spin text-emerald-400" />
              <div className="text-sm font-medium text-slate-200">
                Shielded {vault.length} secrets locally — streaming AI response...
              </div>
              <p className="text-xs text-slate-500">Zero bytes of raw PII sent over the network</p>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center py-8 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/30">
                <ShieldCheck className="h-6 w-6 text-emerald-400" />
              </div>
              <h3 className="text-sm font-semibold text-white">
                Ready to analyze — zero data leaked
              </h3>
              <p className="mt-1 max-w-md text-xs text-slate-400">
                Select a sample or paste your own text on the left, then click{' '}
                <strong>Analyze safely</strong> (or press <strong>Ctrl+Enter</strong>).
              </p>

              <div className="mt-6 grid w-full max-w-lg grid-cols-1 gap-2.5 text-left sm:grid-cols-3">
                <div className="rounded-xl border border-[#1E2733] bg-[#10151C] p-3">
                  <div className="text-xs font-semibold text-emerald-400">1. Auto-mask</div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Keys, JWTs, cards, phones &amp; IDs stay in local browser RAM.
                  </p>
                </div>
                <div className="rounded-xl border border-[#1E2733] bg-[#10151C] p-3">
                  <div className="text-xs font-semibold text-sky-400">2. Hybrid AI</div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Only safe tokens reach Gemini Nano or Cloud Gemini.
                  </p>
                </div>
                <div className="rounded-xl border border-[#1E2733] bg-[#10151C] p-3">
                  <div className="text-xs font-semibold text-slate-200">3. Re-hydrate</div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Click any token to peek locally or restore all details in 1 click.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Private Follow-up Input (appears once analysis completes) */}
        {result && !running && (
          <form onSubmit={handleFollowUpSubmit} className="mt-3 flex gap-2">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={followUpRunning}
              placeholder="Ask a follow-up (e.g., Email bob@corp.com a Slack alert) — inherits vault cleanly..."
              className="flex-1 rounded-xl border border-[#1E2733] bg-[#090C10] px-3.5 py-2 text-xs text-slate-200 placeholder:text-slate-500 outline-none focus:border-sky-500"
            />
            <button
              type="submit"
              disabled={!question.trim() || followUpRunning}
              className="inline-flex items-center gap-1.5 rounded-xl bg-sky-500/20 px-3.5 py-2 text-xs font-semibold text-sky-300 ring-1 ring-sky-500/40 transition hover:bg-sky-500/30 disabled:opacity-40"
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

        {savedNotice && (
          <div className="mt-2.5 flex items-center gap-1.5 text-xs text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {savedNotice}
          </div>
        )}

        {/* Action Bar */}
        {result && (
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onToggleRehydrate}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                rehydrate
                  ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/50'
                  : 'bg-[#0C1016] text-slate-200 ring-1 ring-[#1E2733] hover:border-slate-600'
              }`}
            >
              {rehydrate ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {rehydrate ? 'Hide original details' : 'Show original details'}
            </button>

            <button
              type="button"
              onClick={onSaveToFirestore}
              disabled={savingHistory}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500/15 px-3 py-1.5 text-xs font-semibold text-sky-200 ring-1 ring-sky-500/35 hover:bg-sky-500/25 disabled:opacity-50"
            >
              <Database className="h-3.5 w-3.5" />
              {savingHistory ? 'Saving...' : 'Save report'}
            </button>

            <button
              type="button"
              onClick={onCopyReport}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0C1016] px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-[#1E2733] hover:bg-slate-800"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? 'Copied' : 'Copy'}
            </button>

            <button
              type="button"
              onClick={onExportMarkdown}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0C1016] px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-[#1E2733] hover:bg-slate-800"
            >
              <Download className="h-3.5 w-3.5" />
              Export .md
            </button>
          </div>
        )}
      </section>
    );
  }
);

AnalysisOutputPanel.displayName = 'AnalysisOutputPanel';
