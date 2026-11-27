import React, {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { KeyRound, ShieldCheck, SlidersHorizontal, Wifi, WifiOff, X } from 'lucide-react';
import { loadRemoteSettings, RemoteSettings } from './firebase';
import { SAMPLE_DOCUMENTS } from './data/samples';
import {
  buildVaultLookup,
  CategoryFilter,
  DEFAULT_CATEGORY_FILTER,
  PiiCategory,
  redactLocally,
  rehydrateLocally,
  VaultEntry,
  verifyZeroLeak,
} from './services/piiVault';
import {
  AnalysisTask,
  AttachedImage,
  buildTaskPrompt,
  checkChromeNanoAvailability,
  detectEntitiesOnDevice,
  FollowUpMessage,
  generateFollowUpStream,
  generateHybridStream,
  HybridResponse,
  ModeKey,
  NanoAvailability,
} from './services/hybridAI';
import type { SavedAnalysis } from './services/historyStore';
import { TechDrawer } from './components/TechDrawer';
import { DocumentInputPanel, InputTabKey } from './components/DocumentInputPanel';
import { AnalysisOutputPanel } from './components/AnalysisOutputPanel';
import { HistoryStrip } from './components/HistoryStrip';

const ImageRedactorModal = lazy(() =>
  import('./components/ImageRedactorModal').then((m) => ({ default: m.ImageRedactorModal }))
);

export default function App() {
  const [rawText, setRawText] = useState(SAMPLE_DOCUMENTS[0].content);
  const deferredRawText = useDeferredValue(rawText);

  const [customTerms, setCustomTerms] = useState('Nguyen Tuan Anh, Sarah Jenkins, David Chen');
  const [categories, setCategories] = useState<CategoryFilter>(DEFAULT_CATEGORY_FILTER);
  const [attachedImage, setAttachedImage] = useState<AttachedImage | null>(null);
  const [imageMaskCount, setImageMaskCount] = useState(0);
  const [showImageRedactor, setShowImageRedactor] = useState(false);

  const [mode, setMode] = useState<ModeKey>('PREFER_ON_DEVICE');
  const [task, setTask] = useState<AnalysisTask>('risk_audit');
  const [inputTab, setInputTab] = useState<InputTabKey>('original');
  const [showTechDrawer, setShowTechDrawer] = useState(false);

  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [simulatedOffline, setSimulatedOffline] = useState(false);
  const [nanoStatus, setNanoStatus] = useState<NanoAvailability>('unavailable');
  const [remoteSettings, setRemoteSettings] = useState<RemoteSettings>({
    defaultInferenceMode: 'PREFER_ON_DEVICE',
    cloudModel: 'gemini-2.5-flash',
    systemPromptStyle: 'concise_executive',
    loadedFromServer: false,
  });

  const [aiDiscoveredEntities, setAiDiscoveredEntities] = useState<string[]>([]);
  const [extraFollowUpVault, setExtraFollowUpVault] = useState<VaultEntry[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [result, setResult] = useState<HybridResponse | null>(null);
  const [rehydrate, setRehydrate] = useState(false);
  const [running, setRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [followUps, setFollowUps] = useState<FollowUpMessage[]>([]);
  const [followUpStreaming, setFollowUpStreaming] = useState('');
  const [followUpRunning, setFollowUpRunning] = useState(false);

  const [showDebugModal, setShowDebugModal] = useState(false);
  const [debugTokenInput, setDebugTokenInput] = useState(
    () => (typeof localStorage !== 'undefined' ? localStorage.getItem('privaguard_appcheck_debug') || '' : '')
  );

  const [history, setHistory] = useState<SavedAnalysis[]>([]);
  const [savingHistory, setSavingHistory] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const rafRef = useRef<number | null>(null);
  const outputContainerRef = useRef<HTMLDivElement>(null);
  const historyModuleRef = useRef<typeof import('./services/historyStore') | null>(null);

  const effectiveOnline = isOnline && !simulatedOffline;
  const isLocalhost =
    typeof window !== 'undefined' &&
    (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

  const loadHistoryStore = useCallback(async () => {
    if (!historyModuleRef.current) {
      historyModuleRef.current = await import('./services/historyStore');
    }
    return historyModuleRef.current;
  }, []);

  const refreshRemoteConfig = useCallback(async () => {
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
  }, []);

  // Lazy-load Firestore + Anonymous Auth after initial paint so vendor-firestore stays out of initial bundle
  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    checkChromeNanoAvailability().then(setNanoStatus);
    refreshRemoteConfig();

    let unsubFirestore: (() => void) | null = null;
    let cancelled = false;

    const initFirestore = () => {
      loadHistoryStore()
        .then((mod) => {
          if (cancelled) return;
          unsubFirestore = mod.subscribeRecentAnalyses(
            (items) => {
              setHistory(items);
              setFirestoreError(null);
            },
            (err) => setFirestoreError(err.message)
          );
        })
        .catch(() => {});
    };

    const idleWin = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleId: number | null = null;
    let timerId: number | null = null;

    if (typeof idleWin.requestIdleCallback === 'function') {
      idleId = idleWin.requestIdleCallback(initFirestore, { timeout: 1200 });
    } else {
      timerId = window.setTimeout(initFirestore, 300);
    }

    return () => {
      cancelled = true;
      abortRef.current?.abort();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (idleId !== null && typeof idleWin.cancelIdleCallback === 'function') {
        idleWin.cancelIdleCallback(idleId);
      }
      if (timerId !== null) window.clearTimeout(timerId);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      unsubFirestore?.();
    };
  }, [refreshRemoteConfig, loadHistoryStore]);

  const extraTerms = useMemo(() => {
    const manual = customTerms
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return Array.from(new Set([...manual, ...aiDiscoveredEntities]));
  }, [customTerms, aiDiscoveredEntities]);

  const redaction = useMemo(
    () => redactLocally(deferredRawText, extraTerms, categories),
    [deferredRawText, extraTerms, categories]
  );

  // Unified vault combining document vault + any new tokens discovered in follow-up Q&A (zero collisions)
  const combinedVault = useMemo(() => {
    if (extraFollowUpVault.length === 0) return redaction.vault;
    const seen = new Set(redaction.vault.map((v) => v.token));
    const extras = extraFollowUpVault.filter((v) => !seen.has(v.token));
    return [...redaction.vault, ...extras];
  }, [redaction.vault, extraFollowUpVault]);

  const vaultLookup = useMemo(() => buildVaultLookup(combinedVault), [combinedVault]);

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
    return rehydrate ? rehydrateLocally(src, combinedVault) : src;
  }, [result, streamingText, rehydrate, combinedVault]);

  const scheduleStreamUpdate = useCallback(
    (setter: React.Dispatch<React.SetStateAction<string>>, text: string) => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        setter(text);
        rafRef.current = null;
      });
    },
    []
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setFollowUpRunning(false);
  }, []);

  const handleSelectSample = useCallback((content: string) => {
    abortRef.current?.abort();
    setRunning(false);
    setRawText(content);
    setResult(null);
    setStreamingText('');
    setFollowUps([]);
    setExtraFollowUpVault([]);
    setFollowUpStreaming('');
    setErrorMsg(null);
    setSavedNotice(null);
  }, []);

  const handleToggleCategory = useCallback((key: PiiCategory) => {
    setCategories((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleTextFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      abortRef.current?.abort();
      setRawText(String(reader.result || ''));
      setResult(null);
      setStreamingText('');
      setFollowUps([]);
      setExtraFollowUpVault([]);
      setFollowUpStreaming('');
      setErrorMsg(null);
      setInputTab('original');
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
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
  }, []);

  const handleRunPipeline = useCallback(async () => {
    if (!rawText.trim()) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setErrorMsg(null);
    setSavedNotice(null);
    setResult(null);
    setStreamingText('');
    setFollowUps([]);
    setExtraFollowUpVault([]);
    setFollowUpStreaming('');

    // Auto smooth-scroll to output panel on mobile screens
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      outputContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    try {
      const effectiveMode: ModeKey = !effectiveOnline ? 'ONLY_ON_DEVICE' : mode;

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
      const useStructuredAudit = task === 'risk_audit' && effectiveMode !== 'ONLY_ON_DEVICE';

      const aiRes = await generateHybridStream(
        prompt,
        effectiveMode,
        remoteSettings.cloudModel,
        attachedImage,
        (partial) => {
          if (!controller.signal.aborted) scheduleStreamUpdate(setStreamingText, partial);
        },
        controller.signal,
        remoteSettings.systemPromptStyle,
        useStructuredAudit
      );

      if (!controller.signal.aborted) {
        setResult(aiRes);
        setStreamingText(aiRes.text);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setRunning(false);
      }
    }
  }, [
    rawText,
    effectiveOnline,
    mode,
    nanoStatus,
    customTerms,
    categories,
    task,
    attachedImage,
    remoteSettings.cloudModel,
    remoteSettings.systemPromptStyle,
    scheduleStreamUpdate,
  ]);

  // Global keyboard shortcuts: Ctrl/Cmd+Enter to run analysis, Esc to close modals/drawer
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!running && rawText.trim()) {
          handleRunPipeline();
        }
      } else if (e.key === 'Escape') {
        if (showDebugModal) setShowDebugModal(false);
        else if (showImageRedactor) setShowImageRedactor(false);
        else if (showTechDrawer) setShowTechDrawer(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [running, rawText, handleRunPipeline, showDebugModal, showImageRedactor, showTechDrawer]);

  // Follow-up Q&A inherits combinedVault so token counters NEVER collide with document tokens
  const handleSendFollowUp = useCallback(
    async (rawQuestion: string) => {
      if (!result) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const followUpRedaction = redactLocally(rawQuestion, extraTerms, categories, combinedVault);
      if (followUpRedaction.vault.length > combinedVault.length) {
        setExtraFollowUpVault(followUpRedaction.vault);
      }
      const redactedQ = followUpRedaction.redactedText;

      const userMsg: FollowUpMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        text: redactedQ,
      };
      const nextHistory = [...followUps, userMsg];
      setFollowUps(nextHistory);
      setFollowUpStreaming('');
      setFollowUpRunning(true);
      setErrorMsg(null);

      try {
        const effectiveMode: ModeKey = !effectiveOnline ? 'ONLY_ON_DEVICE' : mode;
        const aiRes = await generateFollowUpStream(
          redaction.redactedText,
          result.text,
          followUps,
          redactedQ,
          effectiveMode,
          remoteSettings.cloudModel,
          remoteSettings.systemPromptStyle,
          (partial) => {
            if (!controller.signal.aborted) scheduleStreamUpdate(setFollowUpStreaming, partial);
          },
          controller.signal
        );

        if (!controller.signal.aborted) {
          setFollowUps((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: 'assistant',
              text: aiRes.text,
              inferenceSource: aiRes.inferenceSource,
              latencyMs: aiRes.latencyMs,
            },
          ]);
          setFollowUpStreaming('');
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setFollowUpRunning(false);
        }
      }
    },
    [
      result,
      extraTerms,
      categories,
      combinedVault,
      followUps,
      effectiveOnline,
      mode,
      redaction.redactedText,
      remoteSettings.cloudModel,
      remoteSettings.systemPromptStyle,
      scheduleStreamUpdate,
    ]
  );

  const handleCopyReport = useCallback(async () => {
    if (!displayedMarkdown) return;
    await navigator.clipboard.writeText(displayedMarkdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [displayedMarkdown]);

  const handleExportMarkdown = useCallback(() => {
    if (!displayedMarkdown) return;
    const blob = new Blob([displayedMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `privaguard-${task}-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [displayedMarkdown, task]);

  const handleSaveToFirestore = useCallback(async () => {
    if (!result) return;
    setSavingHistory(true);
    setSavedNotice(null);
    try {
      const mod = await loadHistoryStore();
      await mod.saveAnonymizedAnalysis({
        task,
        inferenceSource: result.inferenceSource,
        modelUsed: result.modelUsed,
        latencyMs: result.latencyMs,
        ttftMs: result.ttftMs,
        piiCount: combinedVault.length,
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
  }, [result, task, combinedVault.length, redaction, loadHistoryStore]);

  const handleSelectHistory = useCallback((item: SavedAnalysis) => {
    setResult({
      text: item.analysisText,
      inferenceSource: item.inferenceSource === 'ON_DEVICE' ? 'ON_DEVICE' : 'IN_CLOUD',
      latencyMs: item.latencyMs,
      ttftMs: item.ttftMs || item.latencyMs,
      modelUsed: item.modelUsed,
    });
    setFollowUps([]);
    setFollowUpStreaming('');
  }, []);

  const handleDeleteHistory = useCallback(
    (id: string) => {
      loadHistoryStore()
        .then((mod) => mod.deleteSavedAnalysis(id))
        .catch(() => {});
    },
    [loadHistoryStore]
  );

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
    <div className="min-h-screen bg-[#090C10] text-slate-100">
      {/* Focused Security Workbench Header */}
      <header className="sticky top-0 z-20 border-b border-[#1E2733] bg-[#090C10]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 ring-1 ring-emerald-500/40">
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-white">PrivaGuard AI</h1>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                  v4.0
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Analyze private docs with Hybrid AI — secrets stay 100% on your device
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* 1-Click Simulate Offline Toggle for testing On-Device Gemini Nano without cutting Wi-Fi */}
            <button
              type="button"
              onClick={() => setSimulatedOffline((v) => !v)}
              title="Simulate Offline Mode to test On-Device Gemini Nano without disconnecting Wi-Fi"
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
                effectiveOnline
                  ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30 hover:bg-emerald-500/20'
                  : 'bg-amber-500/15 text-amber-300 ring-amber-500/40 hover:bg-amber-500/25'
              }`}
            >
              {effectiveOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
              {simulatedOffline
                ? 'Offline Sim (On-Device)'
                : isOnline
                  ? nanoStatus === 'available'
                    ? 'Hybrid ready'
                    : 'Protected · Cloud ready'
                  : 'Offline · On-device'}
            </button>

            <button
              type="button"
              onClick={() => setShowTechDrawer((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                showTechDrawer
                  ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200'
                  : 'border-[#1E2733] bg-[#10151C] text-slate-300 hover:border-slate-500 hover:text-white'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Privacy &amp; Tech
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-5 py-6">
        {showTechDrawer && (
          <TechDrawer
            mode={mode}
            onModeChange={setMode}
            nanoStatus={nanoStatus}
            isLocalhost={isLocalhost}
            onOpenDebugModal={() => setShowDebugModal(true)}
            remoteSettings={remoteSettings}
            onRefreshRemoteConfig={refreshRemoteConfig}
            categories={categories}
            onToggleCategory={handleToggleCategory}
            customTerms={customTerms}
            onCustomTermsChange={setCustomTerms}
            redaction={redaction}
            onClose={() => setShowTechDrawer(false)}
          />
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <DocumentInputPanel
            rawText={rawText}
            onRawTextChange={setRawText}
            onSelectSample={handleSelectSample}
            onTextFileUpload={handleTextFileUpload}
            onImageUpload={handleImageUpload}
            inputTab={inputTab}
            onInputTabChange={setInputTab}
            redaction={redaction}
            vaultLookup={vaultLookup}
            leakCheck={leakCheck}
            outgoingPrompt={outgoingPrompt}
            attachedImage={attachedImage}
            imageMaskCount={imageMaskCount}
            onOpenImageRedactor={() => setShowImageRedactor(true)}
            onRemoveImage={() => {
              setAttachedImage(null);
              setImageMaskCount(0);
            }}
            task={task}
            onTaskChange={setTask}
            running={running}
            onRunPipeline={handleRunPipeline}
            onStop={handleStop}
          />

          <div ref={outputContainerRef} className="flex flex-col lg:col-span-7">
            <AnalysisOutputPanel
              result={result}
              displayedMarkdown={displayedMarkdown}
              running={running}
              errorMsg={errorMsg}
              vault={combinedVault}
              vaultLookup={vaultLookup}
              bytesShielded={redaction.bytesShielded}
              shieldTimeMs={redaction.shieldTimeMs}
              rehydrate={rehydrate}
              onToggleRehydrate={() => setRehydrate((r) => !r)}
              savingHistory={savingHistory}
              savedNotice={savedNotice}
              onSaveToFirestore={handleSaveToFirestore}
              copied={copied}
              onCopyReport={handleCopyReport}
              onExportMarkdown={handleExportMarkdown}
              followUps={followUps}
              followUpStreaming={followUpStreaming}
              followUpRunning={followUpRunning}
              onSendFollowUp={handleSendFollowUp}
            />
          </div>
        </div>

        <HistoryStrip
          history={history}
          firestoreError={firestoreError}
          onSelect={handleSelectHistory}
          onDelete={handleDeleteHistory}
        />
      </main>

      {/* Lazy-loaded Local Image Privacy Redactor Modal */}
      {showImageRedactor && attachedImage && (
        <Suspense fallback={null}>
          <ImageRedactorModal
            image={attachedImage}
            onApply={(redactedImg, count) => {
              setAttachedImage(redactedImg);
              setImageMaskCount((prev) => prev + count);
              setShowImageRedactor(false);
            }}
            onClose={() => setShowImageRedactor(false)}
          />
        </Suspense>
      )}

      {/* Localhost App Check Debug Token Helper Modal */}
      {showDebugModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Localhost App Check Debug Token"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#090C10]/85 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-md rounded-2xl border border-[#1E2733] bg-[#10151C] p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                <KeyRound className="h-4 w-4 text-amber-400" />
                Localhost App Check debug token
              </h3>
              <button
                type="button"
                onClick={() => setShowDebugModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-slate-400">
              App Check is <strong>Enforced</strong> on Firebase AI Logic. Local testing on{' '}
              <code>localhost</code> needs a debug token from Firebase Console. Production Hosting
              on <code>buildhybridai-tuananh.web.app</code> works automatically.
            </p>
            <input
              type="text"
              value={debugTokenInput}
              onChange={(e) => setDebugTokenInput(e.target.value)}
              placeholder="Paste UUID debug token (leave empty to clear)"
              className="mb-3 w-full rounded-lg border border-[#1E2733] bg-[#090C10] px-3 py-2 font-mono text-xs text-slate-200 outline-none focus:border-emerald-500"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDebugModal(false)}
                className="rounded-lg border border-[#1E2733] px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveLocalDebugToken}
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
              >
                Save &amp; reload
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
