import {
  DEFAULT_CATEGORY_FILTER,
  type CategoryFilter,
  type PiiCategory,
  type TaggedSensitiveTerm,
  type VaultEntry,
} from '../../src/services/piiVault';
import {
  analyzeWithContextGuard,
  type ClassifiedEntity,
  type ContextGuardAnalysis,
} from '../../src/services/sensitivityEngine';
import {
  hasTokensInReplies,
  isPromptEditor,
  readEditorText,
  resolveEditor,
  setRepliesRevealState,
  writeEditorText,
  type EditableTarget,
} from './editorAdapter';
import {
  bypassedEvents,
  bypassedInputs,
  dispatchFileToHost,
  downloadBlobFile,
  isSupportedInterceptFile,
  sanitizeInterceptedFile,
  type PendingFileIntercept,
} from './fileInterceptor';
import { clearShieldBar, renderShieldBar, type ShieldBarCallbacks } from './shieldBar';

interface ExtensionSettings {
  enabled: boolean;
  smartContextGuard: boolean;
  shieldedCount: number;
}

let settings: ExtensionSettings = { enabled: true, smartContextGuard: true, shieldedCount: 0 };
let nanoAvailable = false;
let activeEditor: EditableTarget | null = null;
let lastRawBeforeMask: string | null = null;
let lastAnalysis: ContextGuardAnalysis | null = null;
let activeCategories: CategoryFilter = { ...DEFAULT_CATEGORY_FILTER };
let nanoTerms: TaggedSensitiveTerm[] = [];
let nanoScanning = false;
let dismissedSignature = '';
let pendingFile: PendingFileIntercept | null = null;
let debounceTimer: number | null = null;

// Strictly RAM-only tab vault (cleared on reload/unload, never persisted)
const ramVault = new Map<string, VaultEntry>();
let repliesRevealed = false;

function render(): void {
  renderShieldBar(
    {
      enabled: settings.enabled,
      pendingFile,
      lastAnalysis,
      activeCategories,
      nanoAvailable,
      nanoScanning,
      ramVaultSize: ramVault.size,
      canUndoMask: lastRawBeforeMask !== null,
      hasReplyTokens: hasTokensInReplies(ramVault),
      repliesRevealed,
      dismissedSignature,
    },
    callbacks
  );
}

function runScanNow(editor: EditableTarget): void {
  if (!settings.enabled) {
    clearShieldBar();
    return;
  }
  const text = readEditorText(editor);
  if (!text.trim()) {
    lastAnalysis = null;
    render();
    return;
  }
  const analysis = analyzeWithContextGuard(text, {
    extraSensitiveTerms: nanoTerms,
    enabledCategories: activeCategories,
    smartContextGuard: settings.smartContextGuard,
  });
  if (analysis.contextKind === 'CLEAN') {
    lastAnalysis = null;
  } else {
    lastAnalysis = analysis;
    lastRawBeforeMask = null;
  }
  render();
}

function scheduleScan(editor: EditableTarget, delayMs: number): void {
  activeEditor = editor;
  if (debounceTimer !== null) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null;
    runScanNow(editor);
  }, delayMs);
}

const callbacks: ShieldBarCallbacks = {
  onCancelFile() {
    if (pendingFile?.sourceKind === 'input' && pendingFile.inputEl) {
      pendingFile.inputEl.value = '';
    }
    pendingFile = null;
    render();
  },
  onSendOriginalFile() {
    if (!pendingFile) return;
    const cur = pendingFile;
    pendingFile = null;
    render();
    dispatchFileToHost(cur.originalFile, cur);
  },
  onSendSanitizedFile() {
    if (!pendingFile?.sanitizedFile || !pendingFile.analysis) return;
    const cur = pendingFile;
    const safeFile = cur.sanitizedFile!;
    const activeVault = cur.analysis!.activeVault;
    for (const entry of activeVault) ramVault.set(entry.token, entry);
    try {
      chrome.runtime.sendMessage({ type: 'INCREMENT_SHIELDED', delta: activeVault.length });
    } catch {
      // ignore
    }
    pendingFile = null;
    render();
    dispatchFileToHost(safeFile, cur);
  },
  onDownloadSanitizedFile() {
    if (pendingFile?.sanitizedFile) downloadBlobFile(pendingFile.sanitizedFile);
  },
  onUndoMask() {
    if (!activeEditor || lastRawBeforeMask === null) return;
    writeEditorText(activeEditor, lastRawBeforeMask);
    lastRawBeforeMask = null;
    scheduleScan(activeEditor, 0);
  },
  onToggleRevealReplies() {
    repliesRevealed = setRepliesRevealState(ramVault, !repliesRevealed);
    render();
  },
  onClosePostMask() {
    lastRawBeforeMask = null;
    clearShieldBar();
  },
  onToggleCategory(cat: PiiCategory) {
    activeCategories = { ...activeCategories, [cat]: activeCategories[cat] === false };
    if (activeEditor) runScanNow(activeEditor);
  },
  onMaskEditor(strictAll: boolean) {
    if (!activeEditor) return;
    const raw = readEditorText(activeEditor);
    if (!raw.trim()) return;
    const analysis = analyzeWithContextGuard(raw, {
      extraSensitiveTerms: nanoTerms,
      enabledCategories: activeCategories,
      smartContextGuard: !strictAll && settings.smartContextGuard,
    });
    if (analysis.activeVault.length === 0) return;

    lastRawBeforeMask = raw;
    for (const entry of analysis.activeVault) ramVault.set(entry.token, entry);
    writeEditorText(activeEditor, analysis.redactedText);
    lastAnalysis = null;
    dismissedSignature = '';
    try {
      chrome.runtime.sendMessage({ type: 'INCREMENT_SHIELDED', delta: analysis.activeVault.length });
    } catch {
      // ignore
    }
    render();
  },
  onTriggerNanoScan() {
    if (!activeEditor || nanoScanning) return;
    const raw = readEditorText(activeEditor);
    if (!raw.trim()) return;
    nanoScanning = true;
    render();

    const alreadyMasked = lastAnalysis ? lastAnalysis.entities.map((e) => e.original) : [];
    const entities = lastAnalysis ? lastAnalysis.entities : [];
    try {
      chrome.runtime.sendMessage(
        { type: 'NANO_SCAN', rawText: raw, alreadyMasked, entities },
        (resp?: {
          ok?: boolean;
          discovered?: Array<{ text: string; type: PiiCategory }>;
          adjudicated?: ClassifiedEntity[];
        }) => {
          nanoScanning = false;
          if (resp?.ok && Array.isArray(resp.discovered) && resp.discovered.length > 0) {
            const existing = new Set(nanoTerms.map((t) => t.text.toLowerCase()));
            for (const d of resp.discovered) {
              if (!existing.has(d.text.toLowerCase())) {
                nanoTerms.push({ text: d.text, source: 'nano', category: d.type });
                existing.add(d.text.toLowerCase());
              }
            }
          }
          if (activeEditor) runScanNow(activeEditor);
          else render();
        }
      );
    } catch {
      nanoScanning = false;
      render();
    }
  },
  onDismissAnalysis(sig: string) {
    dismissedSignature = sig;
    clearShieldBar();
  },
};

function startFileIntercept(file: File, sourceKind: 'input' | 'drop', inputEl: HTMLInputElement | null, dropTarget: EventTarget | null) {
  const nextPending: PendingFileIntercept = {
    originalFile: file,
    sanitizedFile: null,
    analysis: null,
    formatPreserved: true,
    metadataStripped: false,
    processing: true,
    isImage: false,
    errorMsg: null,
    sourceKind,
    inputEl,
    dropTarget,
  };
  pendingFile = nextPending;
  render();
  void sanitizeInterceptedFile(
    nextPending,
    settings.smartContextGuard,
    () => render(),
    () => {
      pendingFile = null;
      render();
      dispatchFileToHost(nextPending.originalFile, nextPending);
    }
  );
}

document.addEventListener(
  'paste',
  (e) => {
    if (!isPromptEditor(e.target)) return;
    const editor = resolveEditor(e.target);
    if (editor) {
      dismissedSignature = '';
      scheduleScan(editor, 0);
    }
  },
  true
);

document.addEventListener(
  'input',
  (e) => {
    if (bypassedEvents.has(e) || !isPromptEditor(e.target)) return;
    const editor = resolveEditor(e.target);
    if (editor) scheduleScan(editor, 120);
  },
  true
);

document.addEventListener(
  'change',
  (e) => {
    if (!settings.enabled || bypassedEvents.has(e)) return;
    const target = e.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'file' || bypassedInputs.has(target)) return;
    const file = target.files?.[0];
    if (!file || !isSupportedInterceptFile(file)) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    startFileIntercept(file, 'input', target, null);
  },
  true
);

document.addEventListener(
  'drop',
  (e) => {
    if (!settings.enabled || bypassedEvents.has(e)) return;
    const file = e.dataTransfer?.files?.[0];
    if (!file || !isSupportedInterceptFile(file)) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    startFileIntercept(file, 'drop', null, e.target);
  },
  true
);

const replyObserver = new MutationObserver(() => {
  if (ramVault.size > 0 && !lastAnalysis && !pendingFile && !repliesRevealed && hasTokensInReplies(ramVault)) {
    render();
  }
});
if (document.body) replyObserver.observe(document.body, { childList: true, subtree: true });

try {
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (resp?: { ok?: boolean; settings?: ExtensionSettings }) => {
    if (resp?.ok && resp.settings) settings = resp.settings;
  });
  chrome.runtime.sendMessage({ type: 'CHECK_NANO' }, (resp?: { ok?: boolean; nano?: { available: boolean } }) => {
    nanoAvailable = Boolean(resp?.ok && resp.nano?.available);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.privaguard_settings?.newValue) {
      settings = changes.privaguard_settings.newValue as ExtensionSettings;
      if (!settings.enabled) clearShieldBar();
      else if (activeEditor) runScanNow(activeEditor);
    }
  });
} catch {
  // ignore outside extension context
}
