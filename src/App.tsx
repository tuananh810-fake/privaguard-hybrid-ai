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
import { KeyRound, Moon, Settings, ShieldCheck, Sun, X } from 'lucide-react';
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
import { classifyDroppedFile, parseDocumentLocally } from './services/documentParser';
import type { SavedAnalysis } from './services/historyStore';
import { TechDrawer } from './components/TechDrawer';
import { DocumentInputPanel, InputTabKey } from './components/DocumentInputPanel';
import { AnalysisOutputPanel } from './components/AnalysisOutputPanel';
import { HistoryStrip } from './components/HistoryStrip';

const ImageRedactorModal = lazy(() =>
  import('./components/ImageRedactorModal').then((m) => ({ default: m.ImageRedactorModal }))
);

type ThemeMode = 'light' | 'dark';

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof localStorage === 'undefined') return 'light';
    return localStorage.getItem('privaguard_theme') === 'dark' ? 'dark' : 'light';
  });

  const [rawText, setRawText] = useState(SAMPLE_DOCUMENTS[0].content);
  const deferredRawText = useDeferredValue(rawText);

  const [customTerms, setCustomTerms] = useState('Nguyen Tuan Anh, Sarah Jenkins, David Chen');
  const [categories, setCategories] = useState<CategoryFilter>(DEFAULT_CATEGORY_FILTER);
  const [attachedImage, setAttachedImage] = useState<AttachedImage | null>(null);
  const [imageMaskCount, setImageMaskCount] = useState(0);
  const [showImageRedactor, setShowImageRedactor] = useState(false);
  const [extractingFile, setExtractingFile] = useState(false);
  const [fileMeta, setFileMeta] = useState<string | null>(null);

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

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute('content', theme === 'dark' ? '#191919' : '#ffffff');
    }
    try {
      localStorage.setItem('privaguard_theme', theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

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
    setFileMeta(null);
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

  const processDocumentFile = useCallback(async (file: File) => {
    abortRef.current?.abort();
    setRunning(false);
    setExtractingFile(true);
    setErrorMsg(null);
    try {
      const parsed = await parseDocumentLocally(file);
      setRawText(parsed.text);
      setFileMeta(parsed.meta);
      setResult(null);
      setStreamingText('');
      setFollowUps([]);
      setExtraFollowUpVault([]);
      setFollowUpStreaming('');
      setSavedNotice(null);
      setInputTab('original');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setExtractingFile(false);
    }
  }, []);

  const processImageFile = useCallback((file: File) => {
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
  }, []);

  const handleTextFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        processDocumentFile(file);
      }
      e.target.value = '';
    },
    [processDocumentFile]
  );

  const handleImageUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        processImageFile(file);
      }
      e.target.value = '';
    },
    [processImageFile]
  );

  const handleFileDrop = useCallback(
    (file: File) => {
      const kind = classifyDroppedFile(file);
      if (kind === 'image') {
        processImageFile(file);
      } else {
        processDocumentFile(file);
      }
    },
    [processDocumentFile, processImageFile]
  );

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
      setFollowUps((prev) => [...prev, userMsg]);
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

  const handleExportMarkdown = useCallback(async () => {
    if (!displayedMarkdown) return;
    let payloadHash = 'unavailable';
    try {
      if (typeof crypto !== 'undefined' && crypto.subtle) {
        const bytes = new TextEncoder().encode(redaction.redactedText);
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        payloadHash = Array.from(new Uint8Array(digest))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      }
    } catch {
      payloadHash = 'unavailable';
    }

    const verificationFooter = [
      '\n\n---',
      '### PrivaGuard Zero-Leak Verification',
      `- **Timestamp (UTC):** ${new Date().toISOString()}`,
      `- **Inference Source:** ${result?.inferenceSource === 'ON_DEVICE' ? 'On-Device Gemini Nano' : result?.modelUsed || 'Firebase AI Logic'}`,
      `- **PII Items Shielded Locally:** ${combinedVault.length}`,
      `- **Private Bytes Protected in RAM:** ${redaction.bytesShielded} bytes`,
      `- **Raw PII Leaked:** ${leakCheck} bytes`,
      `- **Sanitized Payload SHA-256:** \`${payloadHash}\``,
    ].join('\n');

    const blob = new Blob([displayedMarkdown + verificationFooter], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `privaguard-${task}-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [displayedMarkdown, task, redaction.redactedText, redaction.bytesShielded, result, combinedVault.length, leakCheck]);

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
      setSavedNotice('Saved safely without personal details.');
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
    <div className="min-h-screen bg-[var(--n-bg)] text-[var(--n-text)]">
      {/* Ultra-clean 48px Notion Topbar */}
      <header className="sticky top-0 z-20 flex h-12 items-center justify-between border-b border-[var(--n-border)] bg-[var(--n-bg)] px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-[18px] w-[18px] text-[var(--n-accent)]" />
          <h1 className="text-[14.5px] font-semibold tracking-tight text-[var(--n-text)]">
            PrivaGuard
          </h1>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Quiet Status Dot (click to toggle offline simulation) */}
          <button
            type="button"
            onClick={() => setSimulatedOffline((v) => !v)}
            title="Click to simulate offline on-device mode"
            className="inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-[12.5px] text-[var(--n-muted)] transition hover:bg-[var(--n-hover)] hover:text-[var(--n-text)]"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                effectiveOnline ? 'bg-[var(--n-accent)]' : 'bg-[var(--n-warn)]'
              }`}
            />
            <span className="hidden sm:inline">
              {simulatedOffline
                ? 'Offline · On-device'
                : effectiveOnline
                  ? nanoStatus === 'available'
                    ? 'Hybrid · Nano ready'
                    : 'Protected · Cloud'
                  : 'Offline · On-device'}
            </span>
          </button>

          {/* Settings Slide-Over Trigger */}
          <button
            type="button"
            onClick={() => setShowTechDrawer(true)}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-medium text-[var(--n-muted)] transition hover:bg-[var(--n-hover)] hover:text-[var(--n-text)]"
          >
            <Settings className="h-3.5 w-3.5" />
            Settings
          </button>

          {/* Subtle Light / Dark Mode Toggle */}
          <button
            type="button"
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            className="rounded-md p-1.5 text-[var(--n-muted)] transition hover:bg-[var(--n-hover)] hover:text-[var(--n-text)]"
          >
            {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Notion Split-View Workspace */}
      <main>
        <div className="grid grid-cols-1 lg:grid-cols-2">
          <DocumentInputPanel
            rawText={rawText}
            onRawTextChange={setRawText}
            onSelectSample={handleSelectSample}
            onTextFileUpload={handleTextFileUpload}
            onImageUpload={handleImageUpload}
            onFileDrop={handleFileDrop}
            extractingFile={extractingFile}
            fileMeta={fileMeta}
            onClearFileMeta={() => setFileMeta(null)}
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

          <div ref={outputContainerRef} className="flex flex-col">
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
              onQuickStart={handleRunPipeline}
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

      {/* Slide-Over Privacy & Technical Settings */}
      {showTechDrawer && (
        <TechDrawer
          mode={mode}
          onModeChange={setMode}
          simulatedOffline={simulatedOffline}
          onToggleSimulatedOffline={() => setSimulatedOffline((v) => !v)}
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
          lastResult={result}
          onClose={() => setShowTechDrawer(false)}
        />
      )}

      {/* Lazy-loaded Image Redactor Modal */}
      {showImageRedactor && attachedImage && (
        <Suspense fallback={null}>
          <ImageRedactorModal
            image={attachedImage}
            extraTerms={extraTerms}
            categories={categories}
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--n-overlay)] p-4"
        >
          <div className="w-full max-w-md rounded-xl border border-[var(--n-border)] bg-[var(--n-bg)] p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-[14.5px] font-semibold text-[var(--n-text)]">
                <KeyRound className="h-4 w-4 text-[var(--n-warn)]" />
                Localhost App Check debug token
              </h3>
              <button
                type="button"
                onClick={() => setShowDebugModal(false)}
                className="rounded-md p-1 text-[var(--n-muted)] hover:bg-[var(--n-hover)] hover:text-[var(--n-text)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 text-[13px] leading-relaxed text-[var(--n-muted)]">
              App Check is enforced on Firebase AI Logic. Local testing on <code>localhost</code>{' '}
              needs a debug token from Firebase Console. Production Hosting works automatically.
            </p>
            <input
              type="text"
              value={debugTokenInput}
              onChange={(e) => setDebugTokenInput(e.target.value)}
              placeholder="Paste UUID debug token (leave empty to clear)"
              className="mb-3 w-full rounded-md border border-[var(--n-border)] bg-[var(--n-surface)] px-3 py-2 font-mono text-[12.5px] text-[var(--n-text)] focus:border-[var(--n-accent)] focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDebugModal(false)}
                className="rounded-md px-3 py-1.5 text-[13px] text-[var(--n-muted)] hover:bg-[var(--n-hover)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveLocalDebugToken}
                className="rounded-md bg-[var(--n-accent)] px-3 py-1.5 text-[13px] font-medium text-[var(--n-accent-fg)] hover:bg-[var(--n-accent-hover)]"
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
