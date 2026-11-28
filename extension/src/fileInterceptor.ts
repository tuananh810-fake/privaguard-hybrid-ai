import {
  analyzeWithContextGuard,
  type ContextGuardAnalysis,
} from '../../src/services/sensitivityEngine';
import {
  redactCsvTextPreservingStructure,
  redactDocxBuffer,
  redactJsonTextPreservingSyntax,
} from '../../src/services/lightFileRedactor';

export interface PendingFileIntercept {
  originalFile: File;
  sanitizedFile: File | null;
  analysis: ContextGuardAnalysis | null;
  formatPreserved: boolean;
  metadataStripped: boolean;
  processing: boolean;
  isImage: boolean;
  errorMsg: string | null;
  sourceKind: 'input' | 'drop';
  inputEl: HTMLInputElement | null;
  dropTarget: EventTarget | null;
}

const TEXT_EXTS = new Set(['txt', 'md', 'log', 'env', 'csv', 'json']);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp']);

export const bypassedEvents = new WeakSet<Event>();
export const bypassedInputs = new WeakSet<HTMLInputElement>();

export function getExt(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
}

function safeFileName(name: string): string {
  const clean = name.trim() || 'document.txt';
  return clean.toLowerCase().startsWith('safe-') ? clean : `safe-${clean}`;
}

function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function isSupportedInterceptFile(file: File): boolean {
  const ext = getExt(file.name);
  const mime = (file.type || '').toLowerCase();
  return (
    ext === 'docx' ||
    ext === 'pdf' ||
    TEXT_EXTS.has(ext) ||
    IMAGE_EXTS.has(ext) ||
    mime === 'application/pdf' ||
    mime === 'application/json' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime.startsWith('text/') ||
    mime.startsWith('image/')
  );
}

export function downloadBlobFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
}

export function dispatchFileToHost(file: File, pending: PendingFileIntercept): void {
  const dt = new DataTransfer();
  dt.items.add(file);

  if (pending.sourceKind === 'input' && pending.inputEl) {
    const input = pending.inputEl;
    bypassedInputs.add(input);
    input.files = dt.files;
    const changeEvt = new Event('change', { bubbles: true });
    bypassedEvents.add(changeEvt);
    input.dispatchEvent(changeEvt);
    const inputEvt = new Event('input', { bubbles: true });
    bypassedEvents.add(inputEvt);
    input.dispatchEvent(inputEvt);
    window.setTimeout(() => bypassedInputs.delete(input), 50);
    return;
  }

  if (pending.sourceKind === 'drop' && pending.dropTarget) {
    const dropEvt = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
    });
    bypassedEvents.add(dropEvt);
    pending.dropTarget.dispatchEvent(dropEvt);
  }
}

export async function sanitizeInterceptedFile(
  pending: PendingFileIntercept,
  smartContextGuard: boolean,
  onUpdate: () => void,
  onPassthroughUnsupported: () => void
): Promise<void> {
  const file = pending.originalFile;
  const ext = getExt(file.name);
  const mime = (file.type || '').toLowerCase();

  try {
    if (IMAGE_EXTS.has(ext) || mime.startsWith('image/')) {
      pending.processing = false;
      pending.isImage = true;
      onUpdate();
      return;
    }

    if (ext === 'docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const buf = await file.arrayBuffer();
      const res = await redactDocxBuffer(buf, { smartContextGuard });
      const outMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      pending.sanitizedFile = new File([res.bytes.buffer as ArrayBuffer], safeFileName(file.name), {
        type: outMime,
      });
      pending.analysis = res.analysis;
      pending.formatPreserved = true;
      pending.metadataStripped = res.metadataStripped;
      pending.processing = false;
      onUpdate();
      return;
    }

    if (ext === 'pdf' || mime === 'application/pdf') {
      const buf = new Uint8Array(await file.arrayBuffer());
      const b64 = uint8ToBase64(buf);
      const resp = await new Promise<{
        ok?: boolean;
        base64Bytes?: string;
        analysis?: ContextGuardAnalysis;
        metadataStripped?: boolean;
        error?: string;
      }>((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'REDACT_PDF_FILE', base64Bytes: b64, smartContextGuard },
          (r?: unknown) => resolve((r as typeof resp) || { ok: false, error: 'No response from PDF worker' })
        );
      });

      if (!resp.ok || !resp.base64Bytes || !resp.analysis) {
        pending.processing = false;
        pending.errorMsg = resp.error || 'Could not sanitize PDF locally';
        onUpdate();
        return;
      }

      const outBytes = base64ToUint8(resp.base64Bytes);
      pending.sanitizedFile = new File([outBytes.buffer as ArrayBuffer], safeFileName(file.name), {
        type: 'application/pdf',
      });
      pending.analysis = resp.analysis;
      pending.formatPreserved = true;
      pending.metadataStripped = Boolean(resp.metadataStripped);
      pending.processing = false;
      onUpdate();
      return;
    }

    if (ext === 'json' || mime === 'application/json') {
      const raw = await file.text();
      const res = redactJsonTextPreservingSyntax(raw, { smartContextGuard });
      pending.sanitizedFile = new File([res.redactedText], safeFileName(file.name), {
        type: 'application/json',
      });
      pending.analysis = res.analysis;
      pending.formatPreserved = res.validJson;
      pending.metadataStripped = false;
      pending.processing = false;
      onUpdate();
      return;
    }

    if (ext === 'csv' || mime === 'text/csv') {
      const raw = await file.text();
      const res = redactCsvTextPreservingStructure(raw, { smartContextGuard });
      pending.sanitizedFile = new File([res.redactedText], safeFileName(file.name), {
        type: 'text/csv',
      });
      pending.analysis = res.analysis;
      pending.formatPreserved = true;
      pending.metadataStripped = false;
      pending.processing = false;
      onUpdate();
      return;
    }

    if (TEXT_EXTS.has(ext) || mime.startsWith('text/')) {
      const raw = await file.text();
      const analysis = analyzeWithContextGuard(raw, { smartContextGuard });
      const outMime = ext === 'md' ? 'text/markdown' : 'text/plain';
      pending.sanitizedFile = new File([analysis.redactedText], safeFileName(file.name), {
        type: outMime,
      });
      pending.analysis = analysis;
      pending.formatPreserved = true;
      pending.metadataStripped = false;
      pending.processing = false;
      onUpdate();
      return;
    }

    onPassthroughUnsupported();
  } catch (err) {
    pending.processing = false;
    pending.errorMsg = err instanceof Error ? err.message : String(err);
    onUpdate();
  }
}
