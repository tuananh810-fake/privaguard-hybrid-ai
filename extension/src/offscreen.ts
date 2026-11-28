import { redactPdfBuffer } from '../../src/services/fileRedactor';

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const req = message as {
    type?: string;
    base64Bytes?: string;
    smartContextGuard?: boolean;
  };

  if (req.type !== 'OFFSCREEN_REDACT_PDF') return false;

  void (async () => {
    try {
      const inputBytes = base64ToUint8(req.base64Bytes || '');
      const pdfWorkerSrc = chrome.runtime.getURL('pdf.worker.min.mjs');
      const res = await redactPdfBuffer(inputBytes, {
        smartContextGuard: req.smartContextGuard !== false,
        pdfWorkerSrc,
      });

      sendResponse({
        ok: true,
        base64Bytes: uint8ToBase64(res.bytes),
        analysis: res.analysis,
        pagesRedacted: res.pagesRedacted,
        boxesDrawn: res.boxesDrawn,
        metadataStripped: res.metadataStripped,
      });
    } catch (err) {
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  return true;
});
