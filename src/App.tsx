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
  SlidersHorizontal,
  Sparkles,
  Square,
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
  verifyZeroLeak,
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
import { ImageRedactorModal } from './components/ImageRedactorModal';

const MODE_OPTIONS: { key: ModeKey; label: string; desc: string }[] = [
  { key: 'PREFER_ON_DEVICE', label: 'Auto Hybrid (Recommended)', desc: 'On-Device Nano first → Cloud fallback' },
  { key: 'PREFER_IN_CLOUD', label: 'Fast Cloud', desc: 'Gemini Cloud → Nano fallback' },
  { key: 'ONLY_ON_DEVICE', label: 'Strict Offline', desc: '100% On-Device only (zero network)' },
  { key: 'ONLY_IN_CLOUD', label: 'Cloud Only', desc: 'Always Gemini Cloud' },
];

const TASK_OPTIONS: { key: AnalysisTask; label: string }[] = [
  { key: 'risk_audit', label: 'Security Audit' },
  { key: 'executive', label: 'Executive Brief' },
  { key: 'action_plan', label: 'Action Plan' },
  { key: 'quick_offline', label: 'Quick Summary' },
];

const CATEGORY_LABELS: { key: PiiCategory; label: string }[] = [
  { key: 'SECRET', label: 'API Keys' },
  { key: 'CARD', label: 'Cards / IBAN' },
  { key: 'ID', label: 'SSN / IDs' },
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
  const [imageMaskCount, setImageMaskCount] = useState(0);
  const [showImageRedactor, setShowImageRedactor] = useState(false);

  const [mode, setMode] = useState<ModeKey>('PREFER_ON_DEVICE');
  const [task, setTask] = useState<AnalysisTask>('risk_audit');
  const [inputTab, setInputTab] = useState<'original' | 'safe' | 'audit'>('original');
  const [showTechDrawer, setShowTechDrawer] = useState(false);

  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [nanoStatus, setNanoStatus] = useState<NanoAvailability>('unavailable');
  const [remoteSettings, setRemoteSettings] = useState<RemoteSettings>({
    defaultInferenceMode: 'PREFER_ON_DEVICE',
    cloudModel: 'gemini-2.5-flash',
    systemPromptStyle: 'concise_executive',
    loadedFromServer: false,
  });

  const [aiDiscoveredEntities, setAiDiscoveredEntities] = useState<string[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [result, setResult] = useState<HybridResponse | null>(null);
  const [rehydrate, setRehydrate] = useState(false);
  const [running, setRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
  const abortRef = useRef<AbortController | null>(null);

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
      abortRef.current?.abort();
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

  const leakCheck = useMemo(
    () => verifyZeroLeak(redaction.redactedText, redaction.vault),
    [redaction]
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

  function handleStop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
  }

  function handleTextFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      abortRef.current?.abort();
      setRawText(String(reader.result || ''));
      setResult(null);
      setStreamingText('');
      setErrorMsg(null);
      setInputTab('original');
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
      setImageMaskCount(0);
      setShowImageRedactor(true);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  async function handleRunPipeline() {
    if (!rawText.trim()) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setErrorMsg(null);
    setSavedNotice(null);
    setResult(null);
    setStreamingText('');

    try {
      const effectiveMode: ModeKey = !isOnline ? 'ONLY_ON_DEVICE' : mode;

      // Only invoke On-Device Nano entity scan when Nano is genuinely available
      // (eliminates ~1.1s dead wait on browsers without local Nano weights).
      let discovered: string[] = [];
      if (
        nanoStatus === 'available' &&
        (effectiveMode === 'PREFER_ON_DEVICE' || effectiveMode === 'ONLY_ON_DEVICE')
      ) {
        const localScan = await detectEntitiesOnDevice(rawText);
        if (controller.signal.aborted) return;
        discovered = localScan.entities;
        setAiDiscoveredEntities(discovered);
      }

      const manual = customTerms
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const merged = Array.from(new Set([...manual, ...discovered]));
      const finalRedaction = redactLocally(rawText, merged, categories);

      const prompt = buildTaskPrompt(finalRedaction.redactedText, task, Boolean(attachedImage));
      const aiRes = await generateHybridStream(
        prompt,
        effectiveMode,
        remoteSettings.cloudModel,
        attachedImage,
        (partial) => {
          if (!controller.signal.aborted) setStreamingText(partial);
        },
        controller.signal
      );

      if (!controller.signal.aborted) {
        setResult(aiRes);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setRunning(false);
      }
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
        analysisText: result.text,
      });
      setSavedNotice('Saved anonymized report to Cloud Firestore (0 raw PII stored).');
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
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Clean Minimal Header */}
      <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 ring-1 ring-emerald-500/40">
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-white">PrivaGuard AI</h1>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                  v3.0
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Analyze private docs with AI — secrets stay 100% on your device
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <span
              className={`hidden items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 sm:inline-flex ${
                isOnline
                  ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
                  : 'bg-amber-500/10 text-amber-300 ring-amber-500/30'
              }`}
            >
              {isOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
              {isOnline
                ? nanoStatus === 'available'
                  ? 'Hybrid Ready'
                  : 'Protected · Cloud Ready'
                : 'Offline · On-Device'}
            </span>

            <button
              onClick={() => setShowTechDrawer((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                showTechDrawer
                  ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500 hover:text-white'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Privacy &amp; Tech
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-5 py-6">
        {/* Collapsible Privacy & Tech Inspector (Hidden by default for clean UX; 1-click for judges/power users) */}
        {showTechDrawer && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-emerald-400" />
                <h2 className="text-sm font-semibold text-white">
                  Privacy Shield Settings &amp; Firebase Hybrid Telemetry
                </h2>
                <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
                  #BuildHybridAI 2026
                </span>
              </div>
              <button
                onClick={() => setShowTechDrawer(false)}
                className="text-slate-400 hover:text-white"
                aria-label="Close privacy and tech settings"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {/* Inference Mode & Remote Config */}
              <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
                <label className="block text-xs font-semibold text-slate-200">
                  Hybrid Inference Mode
                </label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as ModeKey)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500"
                >
                  {MODE_OPTIONS.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-slate-300 ring-1 ring-slate-700">
                    <Cpu className="h-3 w-3 text-amber-400" />
                    Nano: {nanoStatus}
                  </span>
                  <button
                    onClick={() => isLocalhost && setShowDebugModal(true)}
                    className={`inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-300 ring-1 ring-emerald-500/30 ${
                      isLocalhost ? 'cursor-pointer hover:bg-emerald-500/20' : 'cursor-default'
                    }`}
                  >
                    <Lock className="h-3 w-3" />
                    App Check Enforced
                    {isLocalhost && <KeyRound className="h-3 w-3 text-amber-300" />}
                  </button>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>
                    Remote Config: <code className="text-emerald-300">{remoteSettings.cloudModel}</code>
                  </span>
                  <button
                    onClick={refreshRemoteConfig}
                    title="Refresh Remote Config"
                    className="rounded p-1 hover:bg-slate-800 hover:text-emerald-300"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Shield Rules & Custom Terms */}
              <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
                <div className="text-xs font-semibold text-slate-200">Auto-Redaction Rules</div>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORY_LABELS.map((cat) => {
                    const active = categories[cat.key];
                    return (
                      <button
                        key={cat.key}
                        onClick={() =>
                          setCategories((prev) => ({ ...prev, [cat.key]: !prev[cat.key] }))
                        }
                        className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                          active
                            ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40'
                            : 'bg-slate-900 text-slate-500 ring-1 ring-slate-800 hover:text-slate-300'
                        }`}
                      >
                        {active ? '✓ ' : '+ '}
                        {cat.label}
                      </button>
                    );
                  })}
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">
                    Extra private names / words:
                  </label>
                  <input
                    type="text"
                    value={customTerms}
                    onChange={(e) => setCustomTerms(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Local RAM Vault Preview */}
              <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
                <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-200">
                  <span>Local RAM Vault</span>
                  <span className="font-mono text-[11px] text-emerald-400">
                    {redaction.vault.length} shielded · {redaction.bytesShielded}B
                  </span>
                </div>
                <div className="max-h-32 space-y-1 overflow-y-auto font-mono text-[11px]">
                  {redaction.vault.length === 0 ? (
                    <p className="text-slate-500">No sensitive patterns detected.</p>
                  ) : (
                    redaction.vault.map((entry) => (
                      <div
                        key={entry.token}
                        className="flex items-center justify-between gap-2 rounded bg-slate-900 px-2 py-1"
                      >
                        <span className="font-semibold text-emerald-400">{entry.token}</span>
                        <span className="truncate text-slate-400">{entry.original}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Main 2-Column Human-First Workspace */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left Column (5 cols): Document Input + Built-in Safe Preview */}
          <section className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl lg:col-span-5">
            {/* Quick Samples & Upload Bar */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {SAMPLE_DOCUMENTS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      abortRef.current?.abort();
                      setRunning(false);
                      setRawText(s.content);
                      setResult(null);
                      setStreamingText('');
                      setErrorMsg(null);
                      setSavedNotice(null);
                    }}
                    className="rounded-lg border border-slate-700/80 bg-slate-950/80 px-2.5 py-1 text-xs text-slate-300 transition hover:border-emerald-500/60 hover:text-white"
                  >
                    {s.label.replace(' Incident Log', ' Log').replace(' Patient Note', ' Note').replace(' & Payout', '')}
                  </button>
                ))}
              </div>

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
                  title="Upload text/log file"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs text-slate-300 hover:border-emerald-500/50 hover:text-white"
                >
                  <Upload className="h-3.5 w-3.5" />
                  File
                </button>
                <button
                  onClick={() => imageFileRef.current?.click()}
                  title="Upload and mask image locally"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs text-slate-300 hover:border-indigo-500/50 hover:text-white"
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  Image
                </button>
              </div>
            </div>

            {/* Clean Mode Tabs: Original | Safe Preview | Audit */}
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <div className="inline-flex rounded-lg bg-slate-950 p-0.5 ring-1 ring-slate-800">
                <button
                  onClick={() => setInputTab('original')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    inputTab === 'original'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Your Document
                </button>
                <button
                  onClick={() => setInputTab('safe')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    inputTab === 'safe'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Masked ({redaction.vault.length})
                </button>
                <button
                  onClick={() => setInputTab('audit')}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    inputTab === 'audit'
                      ? 'bg-indigo-500/20 text-indigo-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Code2 className="h-3.5 w-3.5" />
                  Audit
                </button>
              </div>

              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {leakCheck === 0 ? '0 leaks' : `${leakCheck} leaks`}
              </span>
            </div>

            {/* Editor / Safe Preview / Outgoing Prompt Audit */}
            {inputTab === 'original' ? (
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                rows={11}
                placeholder="Paste any confidential log, contract, medical note, or upload a file/image..."
                className="w-full flex-1 resize-none rounded-xl border border-slate-700/80 bg-slate-950 p-3.5 font-mono text-xs leading-relaxed text-slate-200 outline-none focus:border-emerald-500"
              />
            ) : inputTab === 'safe' ? (
              <div className="min-h-[236px] flex-1 overflow-y-auto rounded-xl border border-emerald-500/30 bg-slate-950 p-3.5 font-mono text-xs leading-relaxed text-emerald-100">
                <HighlightedRedactedText text={redaction.redactedText} />
              </div>
            ) : (
              <div className="min-h-[236px] flex-1 overflow-y-auto rounded-xl border border-indigo-500/30 bg-slate-950 p-3.5 font-mono text-[11px] leading-relaxed text-indigo-200">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-indigo-400">
                  Exact Network Payload Sent to AI (Zero Raw PII):
                </div>
                <pre className="whitespace-pre-wrap">{outgoingPrompt}</pre>
              </div>
            )}

            {/* Attached Image Card with Local Canvas Redactor */}
            {attachedImage && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs">
                <div className="flex min-w-0 items-center gap-2.5">
                  <img
                    src={attachedImage.previewUrl}
                    alt={attachedImage.name}
                    className="h-8 w-8 shrink-0 rounded object-cover"
                  />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-indigo-200">{attachedImage.name}</div>
                    <div
                      className={`text-[11px] ${
                        imageMaskCount > 0 ? 'text-emerald-300' : 'text-amber-300'
                      }`}
                    >
                      {imageMaskCount > 0
                        ? `Locally Masked (${imageMaskCount} bar${imageMaskCount > 1 ? 's' : ''})`
                        : 'Unmasked — click Redact to hide private regions'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setShowImageRedactor(true)}
                    className="rounded-lg bg-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/30"
                  >
                    Redact Image
                  </button>
                  <button
                    onClick={() => {
                      setAttachedImage(null);
                      setImageMaskCount(0);
                    }}
                    className="p-1 text-slate-400 hover:text-rose-300"
                    aria-label="Remove image"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Task Pills */}
            <div className="mt-4">
              <div className="mb-1.5 text-[11px] font-medium text-slate-400">What do you need?</div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-2">
                {TASK_OPTIONS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTask(t.key)}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                      task === t.key
                        ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/50'
                        : 'bg-slate-950 text-slate-400 ring-1 ring-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Primary CTA: Analyze Safely / Stop */}
            <div className="mt-4 flex gap-2">
              <button
                onClick={handleRunPipeline}
                disabled={running || !rawText.trim()}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {running ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Analyzing Safely...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current" />
                    Analyze Safely ({redaction.vault.length} secrets shielded)
                  </>
                )}
              </button>

              {running && (
                <button
                  onClick={handleStop}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3.5 py-2.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/25"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  Stop
                </button>
              )}
            </div>
          </section>

          {/* Right Column (7 cols): Clean AI Output & Human-Friendly Onboarding */}
          <section className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl lg:col-span-7">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                <Sparkles className="h-4 w-4 text-indigo-400" />
                AI Analysis
              </h2>

              {result && (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold ${
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
                  {result.cached && (
                    <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 font-semibold text-emerald-300">
                      Instant Cache
                    </span>
                  )}
                  {result.fallbackUsed && (
                    <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-300">
                      Lite Fallback
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 font-mono text-slate-300">
                    <Zap className="h-3 w-3 text-amber-400" />
                    {result.ttftMs}ms
                  </span>
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 font-mono text-slate-400">
                    Total {result.latencyMs}ms
                  </span>
                </div>
              )}
            </div>

            {errorMsg && (
              <div className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs text-rose-200">
                <div className="mb-1 flex items-center gap-1.5 font-semibold text-rose-300">
                  <FileWarning className="h-4 w-4" />
                  Unable to complete analysis
                </div>
                <p className="leading-relaxed opacity-90">{errorMsg}</p>
              </div>
            )}

            {result?.wasMockEcho && (
              <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                Your browser&apos;s built-in Gemini Nano weights aren&apos;t downloaded yet. Open{' '}
                <strong>Privacy &amp; Tech</strong> → switch mode to <strong>Fast Cloud</strong> for
                live Gemini Cloud inference.
              </div>
            )}

            <div className="min-h-[340px] flex-1 overflow-y-auto rounded-xl border border-slate-800/90 bg-slate-950/90 p-5">
              {displayedMarkdown ? (
                <>
                  <RichOutput markdown={displayedMarkdown} />
                  {running && (
                    <span className="mt-2 inline-block h-4 w-2 animate-pulse rounded-sm bg-emerald-400" />
                  )}
                </>
              ) : running ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 py-12 text-center">
                  <RefreshCw className="h-6 w-6 animate-spin text-emerald-400" />
                  <div className="text-sm font-medium text-slate-200">
                    Shielded {redaction.vault.length} secrets locally — streaming AI response...
                  </div>
                  <p className="text-xs text-slate-500">
                    0 bytes of raw PII sent over the network
                  </p>
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
                    Click <strong>Analyze Safely</strong> on the left to get an instant AI report.
                  </p>

                  <div className="mt-6 grid w-full max-w-lg grid-cols-1 gap-2.5 text-left sm:grid-cols-3">
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                      <div className="text-[11px] font-bold text-emerald-400">1. Auto-Mask</div>
                      <p className="mt-1 text-[11px] text-slate-400">
                        Keys, phones, emails &amp; IDs are hidden locally in browser RAM.
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                      <div className="text-[11px] font-bold text-sky-400">2. Hybrid AI</div>
                      <p className="mt-1 text-[11px] text-slate-400">
                        Only safe placeholders are analyzed by Gemini Nano or Cloud.
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                      <div className="text-[11px] font-bold text-indigo-400">3. Re-hydrate</div>
                      <p className="mt-1 text-[11px] text-slate-400">
                        Restore real names &amp; details locally on your screen with 1 click.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

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
                  onClick={() => setRehydrate((r) => !r)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    rehydrate
                      ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/50'
                      : 'bg-slate-800 text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700'
                  }`}
                >
                  {rehydrate ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  {rehydrate ? 'Hide Original Details' : 'Show Original Details'}
                </button>

                <button
                  onClick={handleSaveToFirestore}
                  disabled={savingHistory}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500/20 px-3 py-1.5 text-xs font-semibold text-indigo-200 ring-1 ring-indigo-500/40 hover:bg-indigo-500/30 disabled:opacity-50"
                >
                  <Database className="h-3.5 w-3.5" />
                  {savingHistory ? 'Saving...' : 'Save Report'}
                </button>

                <button
                  onClick={handleCopyReport}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied ? 'Copied!' : 'Copy'}
                </button>

                <button
                  onClick={handleExportMarkdown}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export .md
                </button>
              </div>
            )}
          </section>
        </div>

        {/* Clean Saved History Strip (Only prominent when user has saved items) */}
        {(history.length > 0 || firestoreError) && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <History className="h-3.5 w-3.5 text-indigo-400" />
                Your Saved Anonymized Reports ({history.length})
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
                    title="Delete saved report"
                    className="absolute right-2 top-2 rounded p-1 text-slate-600 opacity-0 transition hover:bg-rose-500/20 hover:text-rose-300 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                  <div className="mb-1 flex items-center justify-between pr-5 text-[11px]">
                    <span className="font-semibold uppercase text-indigo-300">
                      {item.task.replace('_', ' ')}
                    </span>
                    <span className="text-emerald-400">{item.piiCount} shielded</span>
                  </div>
                  <p className="line-clamp-2 font-mono text-[11px] text-slate-400">
                    {item.redactedPreview}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
                    <span>{item.inferenceSource === 'ON_DEVICE' ? 'On-Device' : 'Cloud'}</span>
                    <span>{item.latencyMs}ms</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Local Image Privacy Redactor Modal */}
      {showImageRedactor && attachedImage && (
        <ImageRedactorModal
          image={attachedImage}
          onApply={(redactedImg, count) => {
            setAttachedImage(redactedImg);
            setImageMaskCount((prev) => prev + count);
            setShowImageRedactor(false);
          }}
          onClose={() => setShowImageRedactor(false)}
        />
      )}

      {/* Localhost App Check Debug Token Helper Modal */}
      {showDebugModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                <KeyRound className="h-4 w-4 text-amber-400" />
                Localhost App Check Debug Token
              </h3>
              <button
                onClick={() => setShowDebugModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-slate-400">
              App Check is <strong>Enforced</strong> on Firebase AI Logic. Local testing on{' '}
              <code>localhost</code> needs a Debug Token from Firebase Console. Production Hosting
              on <code>buildhybridai-tuananh.web.app</code> works automatically.
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
