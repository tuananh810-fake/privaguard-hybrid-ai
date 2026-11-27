import { useEffect, useMemo, useState } from 'react';
import {
  Cloud,
  Cpu,
  Database,
  Eye,
  EyeOff,
  FileWarning,
  History,
  Lock,
  Play,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sparkles,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import { loadRemoteSettings, RemoteSettings } from './firebase';
import { SAMPLE_DOCUMENTS } from './data/samples';
import { redactLocally, rehydrateLocally, VaultEntry } from './services/piiVault';
import {
  AnalysisTask,
  buildTaskPrompt,
  checkChromeNanoAvailability,
  detectEntitiesOnDevice,
  generateHybrid,
  HybridResponse,
  ModeKey,
  NanoAvailability,
} from './services/hybridAI';
import {
  saveAnonymizedAnalysis,
  SavedAnalysis,
  subscribeRecentAnalyses,
} from './services/historyStore';

const MODE_OPTIONS: { key: ModeKey; label: string; desc: string }[] = [
  { key: 'PREFER_ON_DEVICE', label: 'Prefer On-Device', desc: 'Gemini Nano first → Cloud fallback' },
  { key: 'ONLY_ON_DEVICE', label: 'Only On-Device', desc: 'Strict offline / zero cloud' },
  { key: 'PREFER_IN_CLOUD', label: 'Prefer Cloud', desc: 'Gemini Cloud → Nano fallback' },
  { key: 'ONLY_IN_CLOUD', label: 'Only Cloud', desc: 'Always Gemini Cloud' },
];

const TASK_OPTIONS: { key: AnalysisTask; label: string }[] = [
  { key: 'executive', label: 'Executive Brief' },
  { key: 'risk_audit', label: 'Security & Legal Audit' },
  { key: 'action_plan', label: 'Action Plan' },
  { key: 'quick_offline', label: 'Quick Summary' },
];

export default function App() {
  const [rawText, setRawText] = useState(SAMPLE_DOCUMENTS[0].content);
  const [customTerms, setCustomTerms] = useState('Nguyen Tuan Anh, Sarah Jenkins, David Chen');
  const [mode, setMode] = useState<ModeKey>('PREFER_ON_DEVICE');
  const [task, setTask] = useState<AnalysisTask>('risk_audit');

  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [nanoStatus, setNanoStatus] = useState<NanoAvailability>('unavailable');
  const [remoteSettings, setRemoteSettings] = useState<RemoteSettings>({
    defaultInferenceMode: 'PREFER_ON_DEVICE',
    cloudModel: 'gemini-2.5-flash',
    systemPromptStyle: 'concise_executive',
    loadedFromServer: false,
  });

  const [aiDiscoveredEntities, setAiDiscoveredEntities] = useState<string[]>([]);
  const [stage1Meta, setStage1Meta] = useState<{ usedOnDeviceAI: boolean; latencyMs: number } | null>(null);
  const [result, setResult] = useState<HybridResponse | null>(null);
  const [rehydrate, setRehydrate] = useState(false);
  const [running, setRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [history, setHistory] = useState<SavedAnalysis[]>([]);
  const [savingHistory, setSavingHistory] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    checkChromeNanoAvailability().then(setNanoStatus);
    loadRemoteSettings().then((cfg) => {
      setRemoteSettings(cfg);
      if (
        cfg.defaultInferenceMode === 'PREFER_ON_DEVICE' ||
        cfg.defaultInferenceMode === 'ONLY_ON_DEVICE' ||
        cfg.defaultInferenceMode === 'PREFER_IN_CLOUD' ||
        cfg.defaultInferenceMode === 'ONLY_IN_CLOUD'
      ) {
        setMode(cfg.defaultInferenceMode);
      }
    });

    const unsub = subscribeRecentAnalyses(
      (items) => {
        setHistory(items);
        setFirestoreError(null);
      },
      (err) => setFirestoreError(err.message)
    );

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      unsub();
    };
  }, []);

  const extraTerms = useMemo(() => {
    const manual = customTerms
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return Array.from(new Set([...manual, ...aiDiscoveredEntities]));
  }, [customTerms, aiDiscoveredEntities]);

  const redaction = useMemo(() => redactLocally(rawText, extraTerms), [rawText, extraTerms]);

  const displayedOutput = useMemo(() => {
    if (!result) return '';
    return rehydrate ? rehydrateLocally(result.text, redaction.vault) : result.text;
  }, [result, rehydrate, redaction.vault]);

  async function handleRunPipeline() {
    if (!rawText.trim()) return;
    setRunning(true);
    setErrorMsg(null);
    setSavedNotice(null);

    try {
      // Stage 1: Try On-Device Gemini Nano entity detection (strictly local, never leaks raw PII)
      const localScan = await detectEntitiesOnDevice(rawText);
      setAiDiscoveredEntities(localScan.entities);
      setStage1Meta({ usedOnDeviceAI: localScan.usedOnDeviceAI, latencyMs: localScan.latencyMs });

      // Compute final anonymized text with both regex + Nano-detected entities
      const manual = customTerms
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const merged = Array.from(new Set([...manual, ...localScan.entities]));
      const finalRedaction = redactLocally(rawText, merged);

      // Stage 2: Run Hybrid AI analysis on ONLY the anonymized text via Firebase AI Logic
      const effectiveMode: ModeKey = !isOnline ? 'ONLY_ON_DEVICE' : mode;
      const prompt = buildTaskPrompt(finalRedaction.redactedText, task);
      const aiRes = await generateHybrid(prompt, effectiveMode, remoteSettings.cloudModel);
      setResult(aiRes);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setRunning(false);
    }
  }

  async function handleSaveToFirestore() {
    if (!result) return;
    setSavingHistory(true);
    setSavedNotice(null);
    try {
      await saveAnonymizedAnalysis({
        task,
        inferenceSource: result.inferenceSource,
        modelUsed: result.modelUsed,
        latencyMs: result.latencyMs,
        piiCount: redaction.vault.length,
        bytesShielded: redaction.bytesShielded,
        redactedPreview: redaction.redactedText.slice(0, 180),
        analysisText: result.text, // strictly anonymized — NEVER saves raw PII!
      });
      setSavedNotice('Saved anonymized report to Cloud Firestore (0 raw PII stored).');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingHistory(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      {/* Top Bar */}
      <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 ring-1 ring-emerald-500/40">
              <ShieldCheck className="h-6 w-6 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white">PrivaGuard AI</h1>
                <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[11px] font-semibold text-indigo-300 ring-1 ring-indigo-500/40">
                  #BuildHybridAI 2026
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Local On-Device PII Shield + Firebase AI Logic Hybrid Reasoning
              </p>
            </div>
          </div>

          {/* Live Environment Telemetry Pills */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium ring-1 ${
                nanoStatus === 'available'
                  ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40'
                  : 'bg-amber-500/15 text-amber-300 ring-amber-500/40'
              }`}
            >
              <Cpu className="h-3.5 w-3.5" />
              Gemini Nano: {nanoStatus === 'available' ? 'On-Device Ready' : 'Cloud Fallback'}
            </span>

            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium ring-1 ${
                isOnline
                  ? 'bg-sky-500/15 text-sky-300 ring-sky-500/40'
                  : 'bg-rose-500/15 text-rose-300 ring-rose-500/40'
              }`}
            >
              {isOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
              {isOnline ? 'Online' : 'Offline Mode'}
            </span>

            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800/90 px-3 py-1 font-medium text-slate-300 ring-1 ring-slate-700">
              <Lock className="h-3.5 w-3.5 text-emerald-400" />
              App Check Enforced
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        {/* Sample Presets & Controls */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                1-Click Demo Samples:
              </span>
              {SAMPLE_DOCUMENTS.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => {
                    setRawText(doc.content);
                    setResult(null);
                    setErrorMsg(null);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-emerald-500/60 hover:bg-slate-800"
                >
                  <FileWarning className="h-3.5 w-3.5 text-amber-400" />
                  {doc.label}
                  <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300">
                    {doc.badge}
                  </span>
                </button>
              ))}
            </div>

            <div className="text-xs text-slate-400">
              Cloud fallback model:{' '}
              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-emerald-300">
                {remoteSettings.cloudModel}
              </code>
            </div>
          </div>
        </section>

        {/* 3-Column Hybrid Privacy Pipeline */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* Column 1: Raw Private Input */}
          <section className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                <Lock className="h-4 w-4 text-rose-400" />
                1. Raw Private Input (Stays in Browser)
              </h2>
              <span className="text-xs text-slate-400">{rawText.length} chars</span>
            </div>

            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              rows={9}
              placeholder="Paste confidential notes, contracts, medical records, or incident logs containing secrets/PII..."
              className="w-full flex-1 resize-none rounded-xl border border-slate-700 bg-slate-950/90 p-3 font-mono text-xs leading-relaxed text-slate-200 outline-none focus:border-emerald-500"
            />

            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-400">
                  Extra private names / terms to shield (comma-separated):
                </label>
                <input
                  type="text"
                  value={customTerms}
                  onChange={(e) => setCustomTerms(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-400">
                    Hybrid Inference Mode
                  </label>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as ModeKey)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500"
                  >
                    {MODE_OPTIONS.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-400">
                    Analysis Task
                  </label>
                  <select
                    value={task}
                    onChange={(e) => setTask(e.target.value as AnalysisTask)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500"
                  >
                    {TASK_OPTIONS.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                onClick={handleRunPipeline}
                disabled={running || !rawText.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {running ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Running Hybrid Pipeline...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current" />
                    Shield Locally & Run Hybrid AI
                  </>
                )}
              </button>
            </div>
          </section>

          {/* Column 2: Stage 1 Local Privacy Shield */}
          <section className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                <Shield className="h-4 w-4 text-emerald-400" />
                2. Anonymized Payload (Cloud-Safe)
              </h2>
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                {redaction.vault.length} secrets shielded
              </span>
            </div>

            <div className="mb-3 max-h-56 flex-1 overflow-y-auto whitespace-pre-wrap rounded-xl border border-emerald-500/20 bg-slate-950/90 p-3 font-mono text-xs leading-relaxed text-emerald-100/90">
              {redaction.redactedText || 'Redacted preview will appear here...'}
            </div>

            {/* Local Token Vault */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
              <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <span>Local RAM Vault ({redaction.bytesShielded} bytes never leave device)</span>
                {stage1Meta && (
                  <span className="text-emerald-400">
                    {stage1Meta.usedOnDeviceAI
                      ? `Nano NER: ${stage1Meta.latencyMs}ms`
                      : 'Regex Shield Active'}
                  </span>
                )}
              </div>

              {redaction.vault.length === 0 ? (
                <p className="text-xs text-slate-500">No sensitive patterns detected yet.</p>
              ) : (
                <div className="max-h-36 space-y-1.5 overflow-y-auto pr-1">
                  {redaction.vault.map((entry: VaultEntry) => (
                    <div
                      key={entry.token}
                      className="flex items-center justify-between gap-2 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs"
                    >
                      <span className="font-mono font-semibold text-emerald-400">{entry.token}</span>
                      <span className="truncate font-mono text-slate-400">{entry.original}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Column 3: Stage 2 Hybrid AI Output */}
          <section className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-xl">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                <Sparkles className="h-4 w-4 text-indigo-400" />
                3. Hybrid AI Analysis
              </h2>

              {result && (
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${
                      result.inferenceSource === 'ON_DEVICE'
                        ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40'
                        : 'bg-sky-500/15 text-sky-300 ring-sky-500/40'
                    }`}
                  >
                    {result.inferenceSource === 'ON_DEVICE' ? (
                      <Cpu className="h-3 w-3" />
                    ) : (
                      <Cloud className="h-3 w-3" />
                    )}
                    {result.inferenceSource}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                    <Zap className="h-3 w-3 text-amber-400" />
                    {result.latencyMs}ms
                  </span>
                </div>
              )}
            </div>

            {errorMsg && (
              <div className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
                <p className="font-semibold">Inference Error:</p>
                <p className="mt-1 break-words opacity-90">{errorMsg}</p>
              </div>
            )}

            <div className="mb-3 min-h-[220px] flex-1 overflow-y-auto whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950/90 p-3 text-xs leading-relaxed text-slate-200">
              {result ? (
                displayedOutput
              ) : (
                <div className="flex h-full flex-col items-center justify-center text-center text-slate-500">
                  <Sparkles className="mb-2 h-8 w-8 text-slate-700" />
                  <p>Click &ldquo;Shield Locally &amp; Run Hybrid AI&rdquo; to see live</p>
                  <p className="mt-1 text-[11px]">
                    On-Device (Gemini Nano) ↔ Cloud (Firebase AI Logic) routing.
                  </p>
                </div>
              )}
            </div>

            {result && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setRehydrate((v) => !v)}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                      rehydrate
                        ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
                        : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    {rehydrate ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {rehydrate ? 'Hide Original PII' : 'Re-hydrate Locally'}
                  </button>

                  <button
                    onClick={handleSaveToFirestore}
                    disabled={savingHistory}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-3 py-2 text-xs font-medium text-indigo-200 transition hover:bg-indigo-500/25 disabled:opacity-50"
                  >
                    <Database className="h-3.5 w-3.5" />
                    {savingHistory ? 'Saving...' : 'Save to Firestore'}
                  </button>
                </div>

                {savedNotice && (
                  <p className="text-center text-[11px] text-emerald-400">{savedNotice}</p>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Cloud Firestore Real-time Anonymized History */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <History className="h-4 w-4 text-indigo-400" />
              Cloud Firestore — Saved Anonymized Analyses (Zero Raw PII)
            </h2>
            <span className="text-xs text-slate-400">{history.length} recent records</span>
          </div>

          {firestoreError && (
            <p className="mb-2 text-xs text-amber-300">
              Firestore notice: {firestoreError}
            </p>
          )}

          {history.length === 0 ? (
            <p className="text-xs text-slate-500">
              No saved reports yet. Run an analysis and click &ldquo;Save to Firestore&rdquo; to sync anonymized insights.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
              {history.map((item) => (
                <div
                  key={item.id}
                  onClick={() =>
                    setResult({
                      text: item.analysisText,
                      inferenceSource:
                        item.inferenceSource === 'ON_DEVICE' ? 'ON_DEVICE' : 'IN_CLOUD',
                      latencyMs: item.latencyMs,
                      modelUsed: item.modelUsed,
                    })
                  }
                  className="cursor-pointer rounded-xl border border-slate-800 bg-slate-950/80 p-3 transition hover:border-indigo-500/50"
                >
                  <div className="mb-1.5 flex items-center justify-between text-[11px]">
                    <span className="font-semibold uppercase text-indigo-300">{item.task}</span>
                    <span className="text-emerald-400">{item.piiCount} PII shielded</span>
                  </div>
                  <p className="line-clamp-2 font-mono text-[11px] text-slate-400">
                    {item.redactedPreview}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
                    <span>{item.inferenceSource}</span>
                    <span>{item.latencyMs}ms</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
