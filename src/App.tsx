import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Cloud,
  Code2,
  Copy,
  Cpu,
  Database,
  Download,
  Eye,
  EyeOff,
  FileWarning,
  History,
  Image as ImageIcon,
  KeyRound,
  Lock,
  Play,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Wifi,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import { loadRemoteSettings, RemoteSettings } from './firebase';
import { SAMPLE_DOCUMENTS } from './data/samples';
import {
  CategoryFilter,
  DEFAULT_CATEGORY_FILTER,
  PiiCategory,
  redactLocally,
  rehydrateLocally,
  VaultEntry,
} from './services/piiVault';
import {
  AnalysisTask,
  AttachedImage,
  buildTaskPrompt,
  checkChromeNanoAvailability,
  detectEntitiesOnDevice,
  generateHybridStream,
  HybridResponse,
  ModeKey,
  NanoAvailability,
} from './services/hybridAI';
import {
  deleteSavedAnalysis,
  saveAnonymizedAnalysis,
  SavedAnalysis,
  subscribeRecentAnalyses,
} from './services/historyStore';
import { HighlightedRedactedText, RichOutput } from './components/RichOutput';

const MODE_OPTIONS: { key: ModeKey; label: string; desc: string }[] = [
  { key: 'PREFER_ON_DEVICE', label: 'Prefer On-Device', desc: 'Gemini Nano first → Cloud fallback' },
  { key: 'ONLY_ON_DEVICE', label: 'Only On-Device', desc: 'Strict offline / zero cloud' },
  { key: 'PREFER_IN_CLOUD', label: 'Prefer Cloud', desc: 'Gemini Cloud → Nano fallback' },
  { key: 'ONLY_IN_CLOUD', label: 'Only Cloud', desc: 'Always Gemini Cloud' },
];

const TASK_OPTIONS: { key: AnalysisTask; label: string }[] = [
  { key: 'risk_audit', label: 'Security & Legal Audit' },
  { key: 'executive', label: 'Executive Brief' },
  { key: 'action_plan', label: 'Action Plan' },
  { key: 'quick_offline', label: 'Quick Summary' },
];

const CATEGORY_LABELS: { key: PiiCategory; label: string }[] = [
  { key: 'SECRET', label: 'API Keys' },
  { key: 'CARD', label: 'Cards/IBAN' },
  { key: 'ID', label: 'SSN/IDs' },
  { key: 'EMAIL', label: 'Emails' },
  { key: 'PHONE', label: 'Phones' },
  { key: 'IP', label: 'IPs' },
  { key: 'PERSON', label: 'Names' },
];

export default function App() {
  const [rawText, setRawText] = useState(SAMPLE_DOCUMENTS[0].content);
  const [customTerms, setCustomTerms] = useState('Nguyen Tuan Anh, Sarah Jenkins, David Chen');
  const [categories, setCategories] = useState<CategoryFilter>(DEFAULT_CATEGORY_FILTER);
  const [attachedImage, setAttachedImage] = useState<AttachedImage | null>(null);
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

  const [activeStage, setActiveStage] = useState<0 | 1 | 2 | 3>(0);
  const [aiDiscoveredEntities, setAiDiscoveredEntities] = useState<string[]>([]);
  const [stage1Meta, setStage1Meta] = useState<{ usedOnDeviceAI: boolean; latencyMs: number } | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [result, setResult] = useState<HybridResponse | null>(null);
  const [rehydrate, setRehydrate] = useState(false);
  const [running, setRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPayloadInspector, setShowPayloadInspector] = useState(false);

  const [showDebugModal, setShowDebugModal] = useState(false);
  const [debugTokenInput, setDebugTokenInput] = useState(
    () => (typeof localStorage !== 'undefined' ? localStorage.getItem('privaguard_appcheck_debug') || '' : '')
  );

  const [history, setHistory] = useState<SavedAnalysis[]>([]);
  const [savingHistory, setSavingHistory] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);

  const textFileRef = useRef<HTMLInputElement>(null);
  const imageFileRef = useRef<HTMLInputElement>(null);
  const isLocalhost =
    typeof window !== 'undefined' &&
    (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

  async function refreshRemoteConfig() {
    const cfg = await loadRemoteSettings();
    setRemoteSettings(cfg);
    if (
      cfg.defaultInferenceMode === 'PREFER_ON_DEVICE' ||
      cfg.defaultInferenceMode === 'ONLY_ON_DEVICE' ||
      cfg.defaultInferenceMode === 'PREFER_IN_CLOUD' ||
      cfg.defaultInferenceMode === 'ONLY_IN_CLOUD'
    ) {
      setMode(cfg.defaultInferenceMode);
    }
  }

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    checkChromeNanoAvailability().then(setNanoStatus);
    refreshRemoteConfig();

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

  const redaction = useMemo(
    () => redactLocally(rawText, extraTerms, categories),
    [rawText, extraTerms, categories]
  );

  const outgoingPrompt = useMemo(
    () => buildTaskPrompt(redaction.redactedText, task, Boolean(attachedImage)),
    [redaction.redactedText, task, attachedImage]
  );

  const displayedMarkdown = useMemo(() => {
    const src = result ? result.text : streamingText;
    if (!src) return '';
    return rehydrate ? rehydrateLocally(src, redaction.vault) : src;
  }, [result, streamingText, rehydrate, redaction.vault]);

  function handleTextFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setRawText(String(reader.result || ''));
      setResult(null);
      setStreamingText('');
      setErrorMsg(null);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64Data = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
      setAttachedImage({
        name: file.name,
        mimeType: file.type || 'image/png',
        base64Data,
        previewUrl: dataUrl,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  async function handleRunPipeline() {
    if (!rawText.trim()) return;
    setRunning(true);
    setErrorMsg(null);
    setSavedNotice(null);
    setResult(null);
    setStreamingText('');
    setActiveStage(1);

    try {
      // Stage 1: On-Device Gemini Nano entity detection (strictly local, zero cloud leak)
      const localScan = await detectEntitiesOnDevice(rawText);
      setAiDiscoveredEntities(localScan.entities);
      setStage1Meta({ usedOnDeviceAI: localScan.usedOnDeviceAI, latencyMs: localScan.latencyMs });

      const manual = customTerms
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const merged = Array.from(new Set([...manual, ...localScan.entities]));
      const finalRedaction = redactLocally(rawText, merged, categories);

      // Stage 2: Streaming Hybrid AI Analysis on ONLY the anonymized payload
      setActiveStage(2);
      const effectiveMode: ModeKey = !isOnline ? 'ONLY_ON_DEVICE' : mode;
      const prompt = buildTaskPrompt(finalRedaction.redactedText, task, Boolean(attachedImage));
      const aiRes = await generateHybridStream(
        prompt,
        effectiveMode,
        remoteSettings.cloudModel,
        attachedImage,
        (partial) => setStreamingText(partial)
      );
      setResult(aiRes);
      setActiveStage(3);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setActiveStage(0);
    } finally {
      setRunning(false);
    }
  }

  async function handleCopyReport() {
    if (!displayedMarkdown) return;
    await navigator.clipboard.writeText(displayedMarkdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function handleExportMarkdown() {
    if (!displayedMarkdown) return;
    const blob = new Blob([displayedMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `privaguard-${task}-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
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
        ttftMs: result.ttftMs,
        piiCount: redaction.vault.length,
        bytesShielded: redaction.bytesShielded,
        redactedPreview: redaction.redactedText.slice(0, 180),
        analysisText: result.text, // strictly anonymized — NEVER saves raw PII
      });
      setSavedNotice('Synced anonymized report to Cloud Firestore (0 raw PII stored).');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingHistory(false);
    }
  }

  function saveLocalDebugToken() {
    const trimmed = debugTokenInput.trim();
    if (trimmed) {
      localStorage.setItem('privaguard_appcheck_debug', trimmed);
    } else {
      localStorage.removeItem('privaguard_appcheck_debug');
    }
    window.location.reload();
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      {/* Top Bar */}
      <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
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
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                  v2.0
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Zero-Leak On-Device PII Shield + Streaming Firebase AI Logic
              </p>
            </div>
          </div>

          {/* Live Status Pills */}
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

            <button
              onClick={() => isLocalhost && setShowDebugModal(true)}
              title={isLocalhost ? 'Click to set localhost App Check Debug Token' : 'App Check Enforced via Fraud Defense'}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-800/90 px-3 py-1 font-medium text-slate-300 ring-1 ring-slate-700 transition hover:ring-emerald-500/50"
            >
              <Lock className="h-3.5 w-3.5 text-emerald-400" />
              App Check Enforced
              {isLocalhost && <KeyRound className="h-3 w-3 text-amber-400" />}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-5">
        {/* Visual 3-Stage Hybrid Pipeline Stepper + Zero-Leak Proof */}
        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {[
            {
              step: 1,
              title: 'Stage 1 · Local PII Shield',
              sub: `${redaction.vault.length} secrets shielded · ${redaction.bytesShielded}B kept in RAM`,
              icon: Shield,
            },
            {
              step: 2,
              title: 'Stage 2 · Firebase AI Logic',
              sub: result
                ? `${result.inferenceSource} · TTFT ${result.ttftMs}ms · Total ${result.latencyMs}ms`
                : `Mode: ${mode} (${remoteSettings.cloudModel})`,
              icon: Sparkles,
            },
            {
              step: 3,
              title: 'Stage 3 · Local Re-hydration',
              sub:
                redaction.leaksFound === 0
                  ? 'Zero-Leak Verified (0 raw PII in outgoing payload)'
                  : `${redaction.leaksFound} potential leaks detected`,
              icon: CheckCircle2,
            },
          ].map(({ step, title, sub, icon: Icon }) => {
            const done = activeStage > step || (step === 3 && activeStage === 3);
            const active = activeStage === step && running;
            return (
              <div
                key={step}
                className={`flex items-center gap-3 rounded-2xl border p-3.5 transition ${
                  active
                    ? 'border-emerald-400/70 bg-emerald-500/10 shadow-lg shadow-emerald-500/10'
                    : done
                      ? 'border-emerald-500/35 bg-slate-900/80'
                      : 'border-slate-800 bg-slate-900/60'
                }`}
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ${
                    active || done
                      ? 'bg-emerald-500/20 text-emerald-300 ring-emerald-500/40'
                      : 'bg-slate-800 text-slate-400 ring-slate-700'
                  }`}
                >
                  <Icon className={`h-4 w-4 ${active ? 'animate-pulse' : ''}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white">{title}</p>
                  <p className="truncate text-[11px] text-slate-400">{sub}</p>
                </div>
              </div>
            );
          })}
        </section>

        {/* Sample Presets + Category Shield Filters */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                1-Click Samples:
              </span>
              {SAMPLE_DOCUMENTS.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => {
                    setRawText(doc.content);
                    setResult(null);
                    setStreamingText('');
                    setErrorMsg(null);
                    setActiveStage(0);
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

            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>
                Remote Config:{' '}
                <code className="rounded bg-slate-800 px-1.5 py-0.5 text-emerald-300">
                  {remoteSettings.cloudModel}
                </code>
              </span>
              <button
                onClick={refreshRemoteConfig}
                title="Refresh Firebase Remote Config"
                className="rounded-md border border-slate-700 bg-slate-800 p-1 text-slate-300 hover:border-emerald-500/50 hover:text-white"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* PII Category Toggles */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-800/80 pt-3">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Shield Rules:
            </span>
            {CATEGORY_LABELS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setCategories((prev) => ({ ...prev, [key]: !prev[key] }))}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ring-1 ${
                  categories[key]
                    ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40'
                    : 'bg-slate-800/60 text-slate-500 ring-slate-700 hover:text-slate-300'
                }`}
              >
                {categories[key] ? '✓ ' : ''}
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* 3-Column Hybrid Workspace */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* Column 1: Raw Private Input + File/Image Upload */}
          <section className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-xl">
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                <Lock className="h-4 w-4 text-rose-400" />
                1. Raw Private Input
              </h2>
              <div className="flex items-center gap-1.5">
                <input
                  ref={textFileRef}
                  type="file"
                  accept=".txt,.md,.log,.json,.env,.csv"
                  onChange={handleTextFileUpload}
                  className="hidden"
                />
                <input
                  ref={imageFileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <button
                  onClick={() => textFileRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:border-emerald-500/50 hover:text-white"
                >
                  <Upload className="h-3 w-3" />
                  File
                </button>
                <button
                  onClick={() => imageFileRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:border-indigo-500/50 hover:text-white"
                >
                  <ImageIcon className="h-3 w-3" />
                  Image
                </button>
              </div>
            </div>

            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              rows={9}
              placeholder="Paste confidential notes, contracts, medical records, or upload a log/image..."
              className="w-full flex-1 resize-none rounded-xl border border-slate-700 bg-slate-950/90 p-3 font-mono text-xs leading-relaxed text-slate-200 outline-none focus:border-emerald-500"
            />

            {attachedImage && (
              <div className="mt-2 flex items-center justify-between rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1.5 text-xs">
                <div className="flex items-center gap-2 truncate">
                  <img
                    src={attachedImage.previewUrl}
                    alt={attachedImage.name}
                    className="h-7 w-7 rounded object-cover"
                  />
                  <span className="truncate text-indigo-200">{attachedImage.name}</span>
                </div>
                <button
                  onClick={() => setAttachedImage(null)}
                  className="text-slate-400 hover:text-rose-300"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-400">
                  Extra private names / terms (comma-separated):
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
                    Streaming Hybrid AI...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current" />
                    Shield Locally &amp; Run Hybrid AI
                  </>
                )}
              </button>
            </div>
          </section>

          {/* Column 2: Stage 1 Local Privacy Shield */}
          <section className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-xl">
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                <Shield className="h-4 w-4 text-emerald-400" />
                2. Anonymized Payload
              </h2>
              <div className="flex items-center gap-1.5">
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                  {redaction.vault.length} shielded · {redaction.leaksFound} leaks
                </span>
                <button
                  onClick={() => setShowPayloadInspector((v) => !v)}
                  title="Inspect exact outgoing network payload"
                  className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300 hover:border-emerald-500/50 hover:text-white"
                >
                  <Code2 className="h-3 w-3" />
                  Audit
                </button>
              </div>
            </div>

            <div className="mb-3 max-h-56 flex-1 overflow-y-auto whitespace-pre-wrap rounded-xl border border-emerald-500/20 bg-slate-950/90 p-3 font-mono text-xs leading-relaxed text-slate-200">
              {showPayloadInspector ? (
                <div>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                    Exact Outgoing Prompt Sent to Firebase AI Logic (Zero Raw PII):
                  </p>
                  <HighlightedRedactedText text={outgoingPrompt} />
                </div>
              ) : (
                <HighlightedRedactedText text={redaction.redactedText || 'Redacted preview...'} />
              )}
            </div>

            {/* Local RAM Token Vault */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
              <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <span>Local RAM Vault ({redaction.bytesShielded}B shielded)</span>
                {stage1Meta && (
                  <span className="text-emerald-400">
                    {stage1Meta.usedOnDeviceAI
                      ? `Nano NER: ${stage1Meta.latencyMs}ms`
                      : 'Local Shield OK'}
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
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                <Sparkles className="h-4 w-4 text-indigo-400" />
                3. Hybrid AI Output
              </h2>

              {result && (
                <div className="flex flex-wrap items-center gap-1.5">
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
                    TTFT {result.ttftMs}ms · {result.latencyMs}ms
                  </span>
                </div>
              )}
            </div>

            {errorMsg && (
              <div className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
                <p className="font-semibold">Inference Error:</p>
                <p className="mt-1 break-words opacity-90">{errorMsg}</p>
                {errorMsg.toLowerCase().includes('app check') && isLocalhost && (
                  <button
                    onClick={() => setShowDebugModal(true)}
                    className="mt-2 inline-flex items-center gap-1 rounded-md bg-amber-500/20 px-2.5 py-1 text-[11px] font-semibold text-amber-200 ring-1 ring-amber-500/40 hover:bg-amber-500/30"
                  >
                    <KeyRound className="h-3 w-3" />
                    Configure Localhost App Check Debug Token
                  </button>
                )}
              </div>
            )}

            {result?.wasMockEcho && (
              <div className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                Chromium mock Prompt API detected (no Gemini Nano weights downloaded yet). Switch mode to{' '}
                <strong>Prefer Cloud</strong> or enable Gemini Nano in Chrome flags for real inference.
              </div>
            )}

            <div className="mb-3 min-h-[240px] flex-1 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/90 p-3.5">
              {displayedMarkdown ? (
                <RichOutput markdown={displayedMarkdown} />
              ) : (
                <div className="flex h-full flex-col items-center justify-center text-center text-slate-500">
                  <Sparkles className="mb-2 h-8 w-8 text-slate-700" />
                  <p className="text-xs">Click &ldquo;Shield Locally &amp; Run Hybrid AI&rdquo;</p>
                  <p className="mt-1 text-[11px]">
                    Streams live from Gemini Nano (On-Device) or Gemini Cloud via Firebase AI Logic.
                  </p>
                </div>
              )}
            </div>

            {(result || streamingText) && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setRehydrate((v) => !v)}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${
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
                    disabled={savingHistory || !result}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-3 py-2 text-xs font-medium text-indigo-200 transition hover:bg-indigo-500/25 disabled:opacity-50"
                  >
                    <Database className="h-3.5 w-3.5" />
                    {savingHistory ? 'Saving...' : 'Save to Firestore'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleCopyReport}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-1.5 text-[11px] font-medium text-slate-300 hover:bg-slate-800"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? 'Copied!' : 'Copy Markdown'}
                  </button>
                  <button
                    onClick={handleExportMarkdown}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-1.5 text-[11px] font-medium text-slate-300 hover:bg-slate-800"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export .md
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
              Cloud Firestore — Saved Anonymized Reports (Zero Raw PII)
            </h2>
            <span className="text-xs text-slate-400">{history.length} recent records</span>
          </div>

          {firestoreError && (
            <p className="mb-2 text-xs text-amber-300">Firestore notice: {firestoreError}</p>
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
                      ttftMs: item.ttftMs || item.latencyMs,
                      modelUsed: item.modelUsed,
                    })
                  }
                  className="group relative cursor-pointer rounded-xl border border-slate-800 bg-slate-950/80 p-3 transition hover:border-indigo-500/50"
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSavedAnalysis(item.id).catch(() => {});
                    }}
                    title="Delete record"
                    className="absolute right-2 top-2 rounded p-1 text-slate-600 opacity-0 transition hover:bg-rose-500/20 hover:text-rose-300 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                  <div className="mb-1.5 flex items-center justify-between pr-5 text-[11px]">
                    <span className="font-semibold uppercase text-indigo-300">{item.task}</span>
                    <span className="text-emerald-400">{item.piiCount} PII</span>
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

      {/* Localhost App Check Debug Token Helper Modal */}
      {showDebugModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                <KeyRound className="h-4 w-4 text-amber-400" />
                Localhost App Check Debug Token
              </h3>
              <button onClick={() => setShowDebugModal(false)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-slate-400">
              Because App Check is <strong>Enforced</strong> on Firebase AI Logic, local testing on{' '}
              <code>localhost</code> requires a Debug Token registered in{' '}
              <em>Firebase Console → App Check → Apps → hybrid → ⋮ → Manage debug tokens</em>.
              (Production Hosting on <code>buildhybridai-tuananh.web.app</code> works automatically.)
            </p>
            <input
              type="text"
              value={debugTokenInput}
              onChange={(e) => setDebugTokenInput(e.target.value)}
              placeholder="Paste UUID debug token (leave empty to clear)"
              className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 outline-none focus:border-emerald-500"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDebugModal(false)}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={saveLocalDebugToken}
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
              >
                Save &amp; Reload
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
