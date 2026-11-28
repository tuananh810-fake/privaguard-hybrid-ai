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
import { History, KeyRound, Moon, Settings, ShieldCheck, Sun, X } from 'lucide-react';
import { loadRemoteSettings, RemoteSettings } from './firebase';
import { SAMPLE_DOCUMENTS } from './data/samples';
import {
  buildVaultLookup,
  CategoryFilter,
  computeRawPiiBytes,
  DEFAULT_CATEGORY_FILTER,
  findLeakedOriginals,
  PiiCategory,
  redactLocally,
  rehydrateLocally,
  TaggedSensitiveTerm,
  VaultEntry,
  verifyZeroLeak,
} from './services/piiVault';
import {
  AnalysisTask,
  AttachedImage,
  buildTaskPrompt,
  checkChromeNanoAvailability,
  FollowUpMessage,
  generateFollowUpStream,
  generateHybridStream,
  HybridResponse,
  ModeKey,
  NanoAvailability,
} from './services/hybridAI';
import type { NanoDiscoveredEntity, NanoDiscoveryResult } from './services/nanoEntityDiscovery';
import { classifyDroppedFile, parseDocumentLocally } from './services/documentParser';
import type { SavedAnalysis } from './services/historyStore';
import { TechDrawer } from './components/TechDrawer';
import { DocumentInputPanel, InputTabKey } from './components/DocumentInputPanel';
import { AnalysisOutputPanel, RunMetrics } from './components/AnalysisOutputPanel';
import { HistoryDrawer } from './components/HistoryStrip';

const ImageRedactorModal = lazy(() =>
  import('./components/ImageRedactorModal').then((m) => ({ default: m.ImageRedactorModal }))
);

type ThemeMode = 'light' | 'dark';

function formatNanoScanNotice(scan: NanoDiscoveryResult): string {
  const count = scan.entities.length;
  const entityLabel = count === 1 ? 'entity' : 'entities';
  if (scan.timedOut) {
    const secs = Math.max(1, Math.round(scan.latencyMs / 1000));
    return count > 0
      ? `Nano timed out (${secs}s) · kept ${count} partial ${entityLabel}`
      : `Nano timed out (${secs}s) · retry scan or mark names manually`;
  }
  if (!scan.usedNano) {
    return 'Nano unavailable for this scan · mark names manually';
  }
  if (scan.truncated && scan.scannedChars > 0) {
    return `Nano scanned first ${scan.scannedChars.toLocaleString()} of ${scan.totalChars.toLocaleString()} chars · found ${count} ${entityLabel} · mark later names manually`;
  }
  return count > 0
    ? `Nano found ${count} semantic ${entityLabel}`
    : 'Nano scan complete · 0 new entities';
}

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
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);

  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [simulatedOffline, setSimulatedOffline] = useState(false);
  const [nanoStatus, setNanoStatus] = useState<NanoAvailability>('unavailable');
  const [nanoChecked, setNanoChecked] = useState(false);
  const [nanoBannerDismissed, setNanoBannerDismissed] = useState(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem('privaguard_nano_banner_dismissed') === '1';
    } catch {
      return false;
    }
  });
  const [remoteSettings, setRemoteSettings] = useState<RemoteSettings>({
    defaultInferenceMode: 'PREFER_ON_DEVICE',
    cloudModel: 'gemini-3.6-flash',
    systemPromptStyle: 'concise_executive',
    loadedFromServer: false,
  });

  const [aiDiscoveredEntities, setAiDiscoveredEntities] = useState<NanoDiscoveredEntity[]>([]);
  const [scanningNano, setScanningNano] = useState(false);
  const [nanoScanCompleted, setNanoScanCompleted] = useState(false);
  const [nanoScanNotice, setNanoScanNotice] = useState<string | null>(null);
  const [nanoScanTruncated, setNanoScanTruncated] = useState(false);
  const [nanoScanTimedOut, setNanoScanTimedOut] = useState(false);
  const [extraFollowUpVault, setExtraFollowUpVault] = useState<VaultEntry[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [result, setResult] = useState<HybridResponse | null>(null);
  const [runMetrics, setRunMetrics] = useState<RunMetrics | null>(null);
  const [isHistoricalView, setIsHistoricalView] = useState(false);
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
  const nanoScanAbortRef = useRef<AbortController | null>(null);
  const nanoScannedTextRef = useRef<string | null>(null);
  const nanoEntitiesRef = useRef<NanoDiscoveredEntity[]>([]);
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

    checkChromeNanoAvailability()
      .then((status) => {
        setNanoStatus(status);
        setNanoChecked(true);
      })
      .catch(() => {
        setNanoStatus('unavailable');
        setNanoChecked(true);
      });
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
      nanoScanAbortRef.current?.abort();
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

  const manualTermsList = useMemo(
    () =>
      customTerms
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [customTerms]
  );

  const handleAddManualTerm = useCallback((term: string) => {
    const clean = term.trim().replace(/,/g, ' ');
    if (clean.length < 2) return;
    setCustomTerms((prev) => {
      const existing = prev
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (existing.some((t) => t.toLowerCase() === clean.toLowerCase())) {
        return prev;
      }
      return [...existing, clean].join(', ');
    });
  }, []);

  const handleRemoveManualTerm = useCallback((term: string) => {
    const target = term.toLowerCase();
    setCustomTerms((prev) =>
      prev
        .split(',')
        .map((s) => s.trim())
        .filter((t) => t && t.toLowerCase() !== target)
        .join(', ')
    );
  }, []);

  const taggedTerms = useMemo<TaggedSensitiveTerm[]>(() => {
    const manualTerms: TaggedSensitiveTerm[] = manualTermsList.map((text) => ({
      text,
      source: 'manual',
      category: 'CUSTOM',
    }));
    const nanoTerms: TaggedSensitiveTerm[] = aiDiscoveredEntities.map((e) => ({
      text: e.text,
      source: 'nano',
      category: e.type,
    }));
    return [...nanoTerms, ...manualTerms];
  }, [manualTermsList, aiDiscoveredEntities]);

  const extraTerms = useMemo(() => taggedTerms.map((t) => t.text), [taggedTerms]);

  const redaction = useMemo(
    () => redactLocally(deferredRawText, taggedTerms, categories),
    [deferredRawText, taggedTerms, categories]
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
    return rehydrate && !isHistoricalView ? rehydrateLocally(src, combinedVault) : src;
  }, [result, streamingText, rehydrate, isHistoricalView, combinedVault]);

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

  const handleRawTextChange = useCallback((val: string) => {
    nanoScanAbortRef.current?.abort();
    nanoScannedTextRef.current = null;
    if (nanoEntitiesRef.current.length > 0) {
      const remaining = nanoEntitiesRef.current.filter((e) => val.includes(e.text));
      if (remaining.length !== nanoEntitiesRef.current.length) {
        nanoEntitiesRef.current = remaining;
        setAiDiscoveredEntities(remaining);
      }
    }
    setNanoScanCompleted(false);
    setNanoScanNotice(null);
    setNanoScanTruncated(false);
    setNanoScanTimedOut(false);
    setRawText(val);
  }, []);

  const handleSelectSample = useCallback((content: string) => {
    abortRef.current?.abort();
    nanoScanAbortRef.current?.abort();
    nanoScannedTextRef.current = null;
    nanoEntitiesRef.current = [];
    setRunning(false);
    setScanningNano(false);
    setNanoScanCompleted(false);
    setNanoScanNotice(null);
    setNanoScanTruncated(false);
    setNanoScanTimedOut(false);
    setIsHistoricalView(false);
    setRawText(content);
    setFileMeta(null);
    setAiDiscoveredEntities([]);
    setRunMetrics(null);
    setResult(null);
    setStreamingText('');
    setFollowUps([]);
    setExtraFollowUpVault([]);
    setFollowUpStreaming('');
    setErrorMsg(null);
    setSavedNotice(null);
  }, []);

  const handleToggleCategory = useCallback((key: PiiCategory) => {
    nanoScanAbortRef.current?.abort();
    nanoScannedTextRef.current = null;
    setNanoScanCompleted(false);
    setNanoScanNotice(null);
    setNanoScanTruncated(false);
    setNanoScanTimedOut(false);
    setCategories((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleQuickModeChange = useCallback((nextMode: ModeKey) => {
    setMode(nextMode);
    if (nextMode !== 'ONLY_ON_DEVICE') {
      setSimulatedOffline(false);
    }
  }, []);

  const handleCancelNanoScan = useCallback(() => {
    nanoScanAbortRef.current?.abort();
    nanoScanAbortRef.current = null;
    setScanningNano(false);
    setNanoScanTruncated(false);
    setNanoScanTimedOut(false);
    setNanoScanNotice('Nano scan cancelled');
  }, []);

  const handleScanNano = useCallback(async () => {
    if (nanoStatus !== 'available' || !rawText.trim() || scanningNano) return;
    nanoScanAbortRef.current?.abort();
    const controller = new AbortController();
    nanoScanAbortRef.current = controller;

    setScanningNano(true);
    setNanoScanNotice(null);
    setNanoScanTruncated(false);
    setNanoScanTimedOut(false);

    try {
      const regexOnly = redactLocally(rawText, [], categories);
      const { discoverSemanticEntitiesWithNano, NANO_MANUAL_SCAN_TIMEOUT_MS } = await import(
        './services/nanoEntityDiscovery'
      );
      const localScan = await discoverSemanticEntitiesWithNano(rawText, {
        alreadyMaskedByRegex: regexOnly.vault.map((v) => v.original),
        timeoutMs: NANO_MANUAL_SCAN_TIMEOUT_MS,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      const discovered = localScan.entities;
      nanoEntitiesRef.current = discovered;
      const scanDone = !localScan.timedOut && localScan.usedNano;
      nanoScannedTextRef.current = scanDone ? rawText : null;
      setNanoScanCompleted(scanDone);
      setAiDiscoveredEntities(discovered);
      setNanoScanTruncated(localScan.truncated && localScan.scannedChars > 0);
      setNanoScanTimedOut(localScan.timedOut);
      setNanoScanNotice(formatNanoScanNotice(localScan));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setNanoScanTruncated(false);
      setNanoScanTimedOut(false);
      setNanoScanNotice('Nano unavailable for this scan · mark names manually');
    } finally {
      if (nanoScanAbortRef.current === controller) {
        nanoScanAbortRef.current = null;
        setScanningNano(false);
      }
    }
  }, [nanoStatus, rawText, categories, scanningNano]);

  const processDocumentFile = useCallback(async (file: File) => {
    abortRef.current?.abort();
    nanoScanAbortRef.current?.abort();
    nanoScannedTextRef.current = null;
    nanoEntitiesRef.current = [];
    setRunning(false);
    setScanningNano(false);
    setNanoScanCompleted(false);
    setNanoScanNotice(null);
    setNanoScanTruncated(false);
    setNanoScanTimedOut(false);
    setIsHistoricalView(false);
    setExtractingFile(true);
    setErrorMsg(null);
    try {
      const parsed = await parseDocumentLocally(file);
      setRawText(parsed.text);
      setFileMeta(parsed.meta);
      setAiDiscoveredEntities([]);
      setRunMetrics(null);
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
    setIsHistoricalView(false);
    setErrorMsg(null);
    setSavedNotice(null);
    setRunMetrics(null);
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

      nanoScanAbortRef.current?.abort();
      let discovered: NanoDiscoveredEntity[] = [];
      if (nanoStatus === 'available') {
        if (nanoScannedTextRef.current === rawText) {
          discovered = nanoEntitiesRef.current;
        } else {
          const regexOnly = redactLocally(rawText, [], categories);
          const { discoverSemanticEntitiesWithNano, NANO_AUTO_SCAN_TIMEOUT_MS } = await import(
            './services/nanoEntityDiscovery'
          );
          const localScan = await discoverSemanticEntitiesWithNano(rawText, {
            alreadyMaskedByRegex: regexOnly.vault.map((v) => v.original),
            timeoutMs: NANO_AUTO_SCAN_TIMEOUT_MS,
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          discovered = localScan.entities;
          nanoEntitiesRef.current = discovered;
          const scanDone = !localScan.timedOut && localScan.usedNano;
          nanoScannedTextRef.current = scanDone ? rawText : null;
          setNanoScanCompleted(scanDone);
          setAiDiscoveredEntities(discovered);
          setNanoScanTruncated(localScan.truncated && localScan.scannedChars > 0);
          setNanoScanTimedOut(localScan.timedOut);
          setNanoScanNotice(formatNanoScanNotice(localScan));
        }
      }

      const manualTerms: TaggedSensitiveTerm[] = customTerms
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((text) => ({ text, source: 'manual', category: 'CUSTOM' }));
      const nanoTerms: TaggedSensitiveTerm[] = discovered.map((e) => ({
        text: e.text,
        source: 'nano',
        category: e.type,
      }));
      const finalRedaction = redactLocally(rawText, [...nanoTerms, ...manualTerms], categories);

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
        useStructuredAudit,
        nanoStatus === 'available'
      );

      if (!controller.signal.aborted) {
        const promptBytes =
          typeof TextEncoder !== 'undefined'
            ? new TextEncoder().encode(prompt).length
            : prompt.length;
        const imgBytes = attachedImage ? Math.round((attachedImage.base64Data.length * 3) / 4) : 0;
        const isLocalOnlyRun =
          aiRes.inferenceSource === 'ON_DEVICE' ||
          Boolean(aiRes.nanoUnavailable || aiRes.wasMockEcho) ||
          effectiveMode === 'ONLY_ON_DEVICE';
        const bytesSentToCloud = isLocalOnlyRun ? 0 : promptBytes + imgBytes;
        const rawPiiBytesSent = isLocalOnlyRun
          ? 0
          : computeRawPiiBytes(
              findLeakedOriginals(finalRedaction.redactedText, finalRedaction.vault)
            );

        setResult(aiRes);
        setRunMetrics({
          sourceCounts: finalRedaction.sourceCounts,
          bytesSentToCloud,
          rawPiiBytesSent,
          shieldTimeMs: finalRedaction.shieldTimeMs,
          sentPayloadText: finalRedaction.redactedText,
          sentVaultCount: finalRedaction.vault.length,
          sentBytesShielded: finalRedaction.bytesShielded,
          sentLeakCount: finalRedaction.leaksFound,
        });
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
      if (!result || isHistoricalView || result.nanoUnavailable || result.wasMockEcho || !rawQuestion.trim()) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setFollowUpStreaming('');
      setFollowUpRunning(true);
      setErrorMsg(null);

      try {
        let mergedTerms: TaggedSensitiveTerm[] = taggedTerms;
        if (nanoStatus === 'available' && rawQuestion.trim()) {
          try {
            const regexOnly = redactLocally(rawQuestion, [], categories, combinedVault);
            const { discoverSemanticEntitiesWithNano, NANO_FOLLOWUP_SCAN_TIMEOUT_MS } = await import(
              './services/nanoEntityDiscovery'
            );
            const localScan = await discoverSemanticEntitiesWithNano(rawQuestion, {
              alreadyMaskedByRegex: regexOnly.vault.map((v) => v.original),
              timeoutMs: NANO_FOLLOWUP_SCAN_TIMEOUT_MS,
              signal: controller.signal,
            });
            if (controller.signal.aborted) return;
            if (localScan.entities.length > 0) {
              const followUpNanoTerms: TaggedSensitiveTerm[] = localScan.entities.map((e) => ({
                text: e.text,
                source: 'nano',
                category: e.type,
              }));
              mergedTerms = [...followUpNanoTerms, ...taggedTerms];
            }
          } catch {
            // Non-blocking fallback to regex + existing terms on Nano error/timeout
          }
        }

        if (controller.signal.aborted) return;

        const followUpRedaction = redactLocally(rawQuestion, mergedTerms, categories, combinedVault);
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

        const effectiveMode: ModeKey = !effectiveOnline ? 'ONLY_ON_DEVICE' : mode;
        const aiRes = await generateFollowUpStream(
          runMetrics?.sentPayloadText ?? redaction.redactedText,
          result.text,
          followUps,
          redactedQ,
          effectiveMode,
          remoteSettings.cloudModel,
          remoteSettings.systemPromptStyle,
          (partial) => {
            if (!controller.signal.aborted) scheduleStreamUpdate(setFollowUpStreaming, partial);
          },
          controller.signal,
          nanoStatus === 'available'
        );

        if (!controller.signal.aborted) {
          if (aiRes.nanoUnavailable || aiRes.wasMockEcho) {
            setFollowUpStreaming('');
            setErrorMsg(
              "Local Gemini Nano isn't downloaded in this browser yet. Switch to Fast Cloud to ask follow-up questions."
            );
            return;
          }
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
      isHistoricalView,
      nanoStatus,
      taggedTerms,
      categories,
      combinedVault,
      followUps,
      effectiveOnline,
      mode,
      runMetrics?.sentPayloadText,
      redaction.redactedText,
      remoteSettings.cloudModel,
      remoteSettings.systemPromptStyle,
      scheduleStreamUpdate,
    ]
  );

  const handleCopyReport = useCallback(async () => {
    if (!displayedMarkdown || result?.nanoUnavailable || result?.wasMockEcho) return;
    await navigator.clipboard.writeText(displayedMarkdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [displayedMarkdown, result?.nanoUnavailable, result?.wasMockEcho]);

  const handleExportMarkdown = useCallback(async () => {
    if (!displayedMarkdown || result?.nanoUnavailable || result?.wasMockEcho) return;
    const snapshotPayloadText = runMetrics?.sentPayloadText ?? redaction.redactedText;
    const snapshotVaultCount = runMetrics?.sentVaultCount ?? combinedVault.length;
    const snapshotBytesShielded = runMetrics?.sentBytesShielded ?? redaction.bytesShielded;
    const snapshotLeakCount = runMetrics?.sentLeakCount ?? leakCheck;
    const snapshotSourceCounts = runMetrics?.sourceCounts ?? redaction.sourceCounts;

    let payloadHash = 'unavailable';
    if (!isHistoricalView) {
      try {
        if (typeof crypto !== 'undefined' && crypto.subtle) {
          const bytes = new TextEncoder().encode(snapshotPayloadText);
          const digest = await crypto.subtle.digest('SHA-256', bytes);
          payloadHash = Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
        }
      } catch {
        payloadHash = 'unavailable';
      }
    }

    const verificationFooter = isHistoricalView
      ? [
          '\n\n---',
          '### PrivaGuard Anonymized Cloud Snapshot',
          `- **Exported (UTC):** ${new Date().toISOString()}`,
          `- **Inference Engine:** ${result?.inferenceSource === 'ON_DEVICE' ? 'Device (Gemini Nano)' : `Cloud (${result?.modelUsed || 'gemini-3.6-flash'})`}`,
          '- **Vault Persistence:** Original secrets were never persisted (RAM-only vault)',
        ].join('\n')
      : [
          '\n\n---',
          '### PrivaGuard Local Detection & Masking Proof',
          `- **Timestamp (UTC):** ${new Date().toISOString()}`,
          `- **Inference Engine:** ${result?.inferenceSource === 'ON_DEVICE' ? 'Device (Gemini Nano)' : `Cloud (${result?.modelUsed || 'gemini-3.6-flash'})`}`,
          `- **Detected PII Masked Locally:** ${snapshotVaultCount} (regex ${snapshotSourceCounts.regex} / Nano ${snapshotSourceCounts.nano} / manual ${snapshotSourceCounts.manual})`,
          `- **Private Bytes Protected in RAM:** ${snapshotBytesShielded} bytes`,
          `- **Detected PII Sent to Cloud:** ${snapshotLeakCount} (0 detected PII sent to cloud when 0)`,
          `- **Detection Scope:** regex + on-device Nano + manual marks`,
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
  }, [
    displayedMarkdown,
    task,
    isHistoricalView,
    runMetrics,
    redaction.redactedText,
    redaction.bytesShielded,
    redaction.sourceCounts,
    result,
    combinedVault.length,
    leakCheck,
  ]);

  const handleSaveToFirestore = useCallback(async () => {
    if (!result || isHistoricalView || result.nanoUnavailable || result.wasMockEcho) return;
    setSavingHistory(true);
    setSavedNotice(null);
    try {
      const mod = await loadHistoryStore();
      const payload = mod.sanitizeAnalysisPayload({
        task,
        inferenceSource: result.inferenceSource,
        modelUsed: result.modelUsed,
        latencyMs: result.latencyMs,
        ttftMs: result.ttftMs ?? result.latencyMs,
        piiCount: runMetrics?.sentVaultCount ?? combinedVault.length,
        bytesShielded: runMetrics?.sentBytesShielded ?? redaction.bytesShielded,
        redactedPreview: (runMetrics?.sentPayloadText ?? redaction.redactedText).slice(0, 180),
        analysisText: result.text,
      });
      await mod.saveAnonymizedAnalysis(payload);
      setSavedNotice('Saved safely without personal details.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingHistory(false);
    }
  }, [result, isHistoricalView, task, runMetrics, combinedVault.length, redaction, loadHistoryStore]);

  const handleSelectHistory = useCallback((item: SavedAnalysis) => {
    abortRef.current?.abort();
    setRunning(false);
    setFollowUpRunning(false);
    setIsHistoricalView(true);
    setRehydrate(false);
    setSavedNotice(null);
    setErrorMsg(null);
    setResult({
      text: item.analysisText,
      inferenceSource: item.inferenceSource === 'ON_DEVICE' ? 'ON_DEVICE' : 'IN_CLOUD',
      latencyMs: item.latencyMs,
      ttftMs: item.ttftMs || item.latencyMs,
      modelUsed: item.modelUsed,
    });
    setRunMetrics(null);
    setFollowUps([]);
    setFollowUpStreaming('');
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      requestAnimationFrame(() => {
        outputContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
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

  const handleDismissNanoBanner = useCallback(() => {
    setNanoBannerDismissed(true);
    try {
      localStorage.setItem('privaguard_nano_banner_dismissed', '1');
    } catch {
      // ignore storage errors
    }
  }, []);

  return (
    <div className="flex min-h-screen flex-col overflow-x-clip bg-[var(--n-bg)] text-[var(--n-text)] lg:h-screen lg:overflow-hidden">
      {/* Ultra-clean 48px Notion Topbar */}
      <header className="sticky top-0 z-20 h-12 shrink-0 border-b border-[var(--n-border)] bg-[var(--n-bg)]">
        <div className="mx-auto flex h-full max-w-[1680px] items-center justify-between px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <ShieldCheck className="h-[18px] w-[18px] shrink-0 text-[var(--n-accent)]" />
            <h1 className="text-[14.5px] font-semibold tracking-tight text-[var(--n-text)]">
              PrivaGuard
            </h1>
            {nanoStatus === 'available' && (
              <span className="hidden items-center gap-1 rounded bg-[var(--n-accent-soft)] px-2 py-0.5 text-[11.5px] font-medium text-[var(--n-accent)] sm:inline-flex">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--n-accent)]" />
                Gemini Nano
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {/* Quiet Status Dot (click to toggle offline simulation) */}
            <button
              type="button"
              onClick={() => setSimulatedOffline((v) => !v)}
              title="Click to simulate offline on-device mode"
              aria-label={
                simulatedOffline || !effectiveOnline
                  ? 'Offline on-device mode (click to switch)'
                  : nanoStatus === 'available'
                    ? 'Hybrid mode (click to simulate offline)'
                    : 'Cloud mode (click to simulate offline)'
              }
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
                      ? 'Hybrid'
                      : 'Cloud'
                    : 'Offline · On-device'}
              </span>
            </button>

            {/* Saved Reports Slide-Over Trigger */}
            <button
              type="button"
              onClick={() => setShowHistoryDrawer(true)}
              aria-label={`Saved reports (${history.length})`}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-medium text-[var(--n-muted)] transition hover:bg-[var(--n-hover)] hover:text-[var(--n-text)]"
            >
              <History className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">History</span>
              {history.length > 0 && (
                <span className="rounded bg-[var(--n-surface)] px-1.5 py-0.2 font-mono text-[11px] tabular-nums text-[var(--n-text)]">
                  {history.length}
                </span>
              )}
            </button>

            {/* Settings Slide-Over Trigger */}
            <button
              type="button"
              onClick={() => setShowTechDrawer(true)}
              aria-label="Privacy and settings"
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-medium text-[var(--n-muted)] transition hover:bg-[var(--n-hover)] hover:text-[var(--n-text)]"
            >
              <Settings className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Settings</span>
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
        </div>
      </header>

      {/* Dismissible Notion Banner when On-Device Nano is Unavailable */}
      {nanoChecked && nanoStatus !== 'available' && !nanoBannerDismissed && (
        <div
          role="status"
          className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--n-border)] bg-[var(--n-surface)] px-4 py-1.5 text-[12px] text-[var(--n-muted)] sm:px-6"
        >
          <p className="min-w-0 truncate sm:whitespace-normal">
            On-device model unavailable — running Cloud with masked tokens only ·{' '}
            <a
              href="https://developer.chrome.com/docs/ai/built-in"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[var(--n-text)] underline underline-offset-2 hover:text-[var(--n-accent)]"
            >
              How to enable Gemini Nano
            </a>
          </p>
          <button
            type="button"
            onClick={handleDismissNanoBanner}
            aria-label="Dismiss Gemini Nano availability notice"
            className="shrink-0 rounded p-0.5 text-[var(--n-muted)] transition hover:bg-[var(--n-hover)] hover:text-[var(--n-text)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Notion Split-View Workspace */}
      <main className="min-h-0 flex-1">
        <div className="mx-auto grid max-w-[1680px] grid-cols-1 lg:h-full lg:grid-cols-2">
          <DocumentInputPanel
            rawText={rawText}
            onRawTextChange={handleRawTextChange}
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
            manualTerms={manualTermsList}
            onAddManualTerm={handleAddManualTerm}
            onRemoveManualTerm={handleRemoveManualTerm}
            nanoStatus={nanoChecked ? nanoStatus : 'checking'}
            scanningNano={scanningNano}
            nanoScanCompleted={nanoScanCompleted}
            nanoScanNotice={nanoScanNotice}
            nanoScanTruncated={nanoScanTruncated}
            nanoScanTimedOut={nanoScanTimedOut}
            onScanNano={handleScanNano}
            onCancelNanoScan={handleCancelNanoScan}
            onOpenNanoGuide={() => setShowTechDrawer(true)}
            attachedImage={attachedImage}
            imageMaskCount={imageMaskCount}
            onOpenImageRedactor={() => setShowImageRedactor(true)}
            onRemoveImage={() => {
              setAttachedImage(null);
              setImageMaskCount(0);
            }}
            task={task}
            onTaskChange={setTask}
            mode={mode}
            simulatedOffline={simulatedOffline}
            onQuickModeChange={handleQuickModeChange}
            running={running}
            onRunPipeline={handleRunPipeline}
            onStop={handleStop}
          />

          <div ref={outputContainerRef} className="flex min-w-0 flex-col lg:h-full lg:min-h-0">
            <AnalysisOutputPanel
              result={result}
              runMetrics={runMetrics}
              isHistoricalView={isHistoricalView}
              displayedMarkdown={displayedMarkdown}
              running={running}
              errorMsg={errorMsg}
              vault={combinedVault}
              vaultLookup={vaultLookup}
              bytesShielded={redaction.bytesShielded}
              shieldTimeMs={redaction.shieldTimeMs}
              rehydrate={rehydrate}
              onToggleRehydrate={() => {
                if (!isHistoricalView) setRehydrate((r) => !r);
              }}
              savingHistory={savingHistory}
              savedNotice={savedNotice}
              onSaveToFirestore={handleSaveToFirestore}
              copied={copied}
              onCopyReport={handleCopyReport}
              onExportMarkdown={handleExportMarkdown}
              onQuickStart={handleRunPipeline}
              onSwitchToFastCloud={() => handleQuickModeChange('PREFER_IN_CLOUD')}
              followUps={followUps}
              followUpStreaming={followUpStreaming}
              followUpRunning={followUpRunning}
              onSendFollowUp={handleSendFollowUp}
            />
          </div>
        </div>
      </main>

      {/* Slide-Over Saved Reports Drawer */}
      {showHistoryDrawer && (
        <HistoryDrawer
          history={history}
          firestoreError={firestoreError}
          onSelect={handleSelectHistory}
          onDelete={handleDeleteHistory}
          onClose={() => setShowHistoryDrawer(false)}
        />
      )}

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
              id="appcheck-debug-token"
              name="appcheckDebugToken"
              aria-label="Localhost App Check debug token"
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
