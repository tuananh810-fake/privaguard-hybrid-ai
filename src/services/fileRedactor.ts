import { getFileExtension } from './documentParser.ts';
import type { VaultEntry } from './piiVault.ts';
import {
  analyzeWithContextGuard,
  type ContextGuardAnalysis,
  type ContextGuardOptions,
} from './sensitivityEngine.ts';
import {
  redactDocxBuffer,
  redactJsonTextPreservingSyntax,
  replaceWithVault,
} from './lightFileRedactor.ts';
import { buildCleanPdfBytes, buildNativeDocxBytes } from './reportExporter.ts';

export { redactDocxBuffer, redactJsonTextPreservingSyntax, replaceWithVault };

export type SafeDocumentExportFormat = 'original' | 'pdf' | 'docx' | 'md' | 'txt' | 'json';

export interface RedactedFileResult {
  blob: Blob;
  fileName: string;
  mimeType: string;
  formatPreserved: boolean;
  contextAnalysis: ContextGuardAnalysis;
  metadataStripped: boolean;
  processingMs: number;
}

export interface PdfTextSpanItem {
  str: string;
  transform: number[]; // [a, b, c, d, tx, ty]
  width: number;
  height: number;
}

export interface PdfRedactionBox {
  x: number;
  y: number;
  width: number;
  height: number;
  token: string;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pure helper mapping PDF text items (including multi-item adjacent spans)
 * against activeVault originals to produce exact PDF-space redaction boxes.
 */
export function matchPdfTextItemsToVault(
  items: PdfTextSpanItem[],
  activeVault: VaultEntry[]
): PdfRedactionBox[] {
  if (items.length === 0 || activeVault.length === 0) return [];

  const spans: Array<{ item: PdfTextSpanItem; start: number; end: number }> = [];
  let joined = '';
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.str) continue;
    if (joined.length > 0 && !joined.endsWith(' ') && !item.str.startsWith(' ')) {
      const prev = spans[spans.length - 1]?.item;
      const sameLine = prev && Math.abs((prev.transform[5] || 0) - (item.transform[5] || 0)) < 3;
      const prevRight = prev ? (prev.transform[4] || 0) + (prev.width || 0) : 0;
      const gap = (item.transform[4] || 0) - prevRight;
      if (!sameLine || gap > 1.5) {
        joined += ' ';
      }
    }
    const start = joined.length;
    joined += item.str;
    spans.push({ item, start, end: joined.length });
  }

  const boxes: PdfRedactionBox[] = [];
  const sorted = [...activeVault].sort((a, b) => b.original.length - a.original.length);

  for (const entry of sorted) {
    if (!entry.original || entry.original.length < 2) continue;
    const escaped = escapeRegExp(entry.original);
    const rgx = new RegExp(escaped, entry.source === 'regex' ? 'g' : 'gi');
    let m: RegExpExecArray | null;
    while ((m = rgx.exec(joined)) !== null) {
      const mStart = m.index;
      const mEnd = mStart + m[0].length;
      const matchedSpans = spans.filter((s) => s.end > mStart && s.start < mEnd);
      if (matchedSpans.length === 0) continue;

      const lineGroups: Array<typeof matchedSpans> = [];
      for (const sp of matchedSpans) {
        const y = sp.item.transform[5] || 0;
        const group = lineGroups.find((g) => Math.abs((g[0].item.transform[5] || 0) - y) < 5);
        if (group) group.push(sp);
        else lineGroups.push([sp]);
      }

      for (const group of lineGroups) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const sp of group) {
          const item = sp.item;
          const baseX = item.transform[4] || 0;
          const baseY = item.transform[5] || 0;
          const fontH = Math.max(
            item.height || 0,
            Math.hypot(item.transform[2] || 0, item.transform[3] || 0),
            10
          );
          const itemW = Math.max(item.width || item.str.length * fontH * 0.55, 6);

          const itemLen = Math.max(1, item.str.length);
          const localStart = Math.max(0, mStart - sp.start);
          const localEnd = Math.min(itemLen, mEnd - sp.start);
          const subX = baseX + (localStart / itemLen) * itemW;
          const subW = Math.max(6, ((localEnd - localStart) / itemLen) * itemW);

          minX = Math.min(minX, subX);
          minY = Math.min(minY, baseY - fontH * 0.25);
          maxX = Math.max(maxX, subX + subW);
          maxY = Math.max(maxY, baseY + fontH * 1.05);
        }

        if (Number.isFinite(minX) && maxX > minX && maxY > minY) {
          boxes.push({
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
            token: entry.token,
          });
        }
      }
    }
  }

  return boxes;
}

function canRenderCanvasInEnvironment(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

async function canvasToJpegBytes(canvas: HTMLCanvasElement, quality = 0.9): Promise<Uint8Array> {
  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality)
    );
    if (blob) {
      return new Uint8Array(await blob.arrayBuffer());
    }
  }
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const b64 = dataUrl.split(',')[1] || '';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function redactPdfBuffer(
  buffer: ArrayBuffer | Uint8Array,
  options: ContextGuardOptions & { maxPages?: number; scale?: number; pdfWorkerSrc?: string } = {}
): Promise<{
  bytes: Uint8Array;
  analysis: ContextGuardAnalysis;
  pagesRedacted: number;
  boxesDrawn: number;
  metadataStripped: boolean;
}> {
  const maxPages = options.maxPages ?? 25;
  const scale = options.scale ?? 1.75;
  const isBrowserEnv = typeof window !== 'undefined';
  const legacyPdfjsId = 'pdfjs-dist/legacy/build/pdf.mjs';
  const [{ PDFDocument, StandardFonts, rgb }, pdfjsLib] = await Promise.all([
    import('pdf-lib'),
    isBrowserEnv ? import('pdfjs-dist') : import(/* @vite-ignore */ legacyPdfjsId),
  ]);

  if (options.pdfWorkerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = options.pdfWorkerSrc;
  } else if (isBrowserEnv && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    try {
      const workerMod = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerMod.default;
    } catch {
      // ignore in non-Vite / Node test environments
    }
  }

  const bytesCopy = buffer instanceof Uint8Array ? new Uint8Array(buffer) : new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({ data: bytesCopy, useSystemFonts: true });
  const srcPdf = await loadingTask.promise;

  const pageCount = Math.min(srcPdf.numPages, maxPages);
  const pageItemsList: PdfTextSpanItem[][] = [];
  const pageTexts: string[] = [];

  for (let p = 1; p <= pageCount; p++) {
    const page = await srcPdf.getPage(p);
    const content = await page.getTextContent();
    const items: PdfTextSpanItem[] = [];
    const strings: string[] = [];
    for (const rawItem of content.items) {
      if ('str' in rawItem && rawItem.str) {
        items.push({
          str: rawItem.str,
          transform: Array.isArray(rawItem.transform) ? rawItem.transform : [1, 0, 0, 1, 0, 0],
          width: typeof rawItem.width === 'number' ? rawItem.width : 0,
          height: typeof rawItem.height === 'number' ? rawItem.height : 0,
        });
        strings.push(rawItem.str);
      }
    }
    pageItemsList.push(items);
    pageTexts.push(strings.join(' ').replace(/\s{2,}/g, ' ').trim());
  }

  const fullText = pageTexts.filter(Boolean).join('\n\n');
  const analysis = analyzeWithContextGuard(fullText, options);

  const outPdf = await PDFDocument.create();
  outPdf.setTitle('');
  outPdf.setAuthor('');
  outPdf.setSubject('');
  outPdf.setKeywords([]);
  outPdf.setCreator('PrivaGuard AI');
  outPdf.setProducer('PrivaGuard AI Local Redactor');

  let boxesDrawn = 0;

  if (canRenderCanvasInEnvironment()) {
    for (let p = 1; p <= pageCount; p++) {
      const page = await srcPdf.getPage(p);
      const baseViewport = page.getViewport({ scale: 1 });
      const renderViewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(renderViewport.width));
      canvas.height = Math.max(1, Math.round(renderViewport.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: ctx,
        viewport: renderViewport,
        canvas,
      }).promise;

      const boxes = matchPdfTextItemsToVault(pageItemsList[p - 1], analysis.activeVault);
      for (const box of boxes) {
        const p1 = renderViewport.convertToViewportPoint(box.x, box.y);
        const p2 = renderViewport.convertToViewportPoint(box.x + box.width, box.y + box.height);
        const rx = Math.max(0, Math.min(p1[0], p2[0]) - 3);
        const ry = Math.max(0, Math.min(p1[1], p2[1]) - 2);
        const rw = Math.max(18, Math.abs(p2[0] - p1[0]) + 6);
        const rh = Math.max(14, Math.abs(p2[1] - p1[1]) + 4);

        ctx.fillStyle = '#09090b';
        ctx.fillRect(rx, ry, rw, rh);

        const fontSize = Math.max(9, Math.min(13, Math.round(rh * 0.62)));
        ctx.fillStyle = '#ffffff';
        ctx.font = `600 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.textBaseline = 'middle';
        ctx.fillText(box.token, rx + 4, ry + rh / 2, Math.max(10, rw - 8));
        boxesDrawn += 1;
      }

      const jpgBytes = await canvasToJpegBytes(canvas, 0.9);
      const embedded = await outPdf.embedJpg(jpgBytes);
      const outPage = outPdf.addPage([baseViewport.width, baseViewport.height]);
      outPage.drawImage(embedded, {
        x: 0,
        y: 0,
        width: baseViewport.width,
        height: baseViewport.height,
      });
    }
  } else {
    const font = await outPdf.embedFont(StandardFonts.Helvetica);
    for (let p = 0; p < pageCount; p++) {
      const boxes = matchPdfTextItemsToVault(pageItemsList[p], analysis.activeVault);
      boxesDrawn += boxes.length;
      const sanitizedPageText = replaceWithVault(pageTexts[p] || '', analysis.activeVault);
      const outPage = outPdf.addPage([612, 792]);
      const asciiSafe = sanitizedPageText.replace(/[^\x20-\x7E\n]/g, ' ');
      const lines = asciiSafe.match(/.{1,82}/g) || [''];
      let y = 750;
      for (const line of lines.slice(0, 48)) {
        outPage.drawText(line, { x: 42, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
        y -= 14;
      }
    }
  }

  await loadingTask.destroy();
  const outBytes = await outPdf.save({ useObjectStreams: false });

  return {
    bytes: outBytes,
    analysis,
    pagesRedacted: pageCount,
    boxesDrawn,
    metadataStripped: true,
  };
}

function safeOutputName(originalName: string): string {
  const clean = originalName.trim() || 'document.txt';
  return clean.toLowerCase().startsWith('safe-') ? clean : `safe-${clean}`;
}

export async function redactFileLocally(
  file: File,
  options: ContextGuardOptions & { pdfWorkerSrc?: string } = {}
): Promise<RedactedFileResult> {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const ext = getFileExtension(file.name);
  const mime = (file.type || '').toLowerCase();

  if (
    ext === 'docx' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const buffer = await file.arrayBuffer();
    const res = await redactDocxBuffer(buffer, options);
    const outMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const blob = new Blob([res.bytes.buffer as ArrayBuffer], { type: outMime });
    return {
      blob,
      fileName: safeOutputName(file.name),
      mimeType: outMime,
      formatPreserved: true,
      contextAnalysis: res.analysis,
      metadataStripped: res.metadataStripped,
      processingMs: Number(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started).toFixed(1)),
    };
  }

  if (ext === 'pdf' || mime === 'application/pdf') {
    const buffer = await file.arrayBuffer();
    const res = await redactPdfBuffer(buffer, options);
    const outMime = 'application/pdf';
    const blob = new Blob([res.bytes.buffer as ArrayBuffer], { type: outMime });
    return {
      blob,
      fileName: safeOutputName(file.name),
      mimeType: outMime,
      formatPreserved: true,
      contextAnalysis: res.analysis,
      metadataStripped: res.metadataStripped,
      processingMs: Number(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started).toFixed(1)),
    };
  }

  if (ext === 'json' || mime === 'application/json') {
    const raw = await file.text();
    const res = redactJsonTextPreservingSyntax(raw, options);
    const outMime = 'application/json;charset=utf-8';
    const blob = new Blob([res.redactedText], { type: outMime });
    return {
      blob,
      fileName: safeOutputName(file.name),
      mimeType: outMime,
      formatPreserved: res.validJson,
      contextAnalysis: res.analysis,
      metadataStripped: false,
      processingMs: Number(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started).toFixed(1)),
    };
  }

  const raw = await file.text();
  const analysis = analyzeWithContextGuard(raw, options);
  const outMime =
    ext === 'csv'
      ? 'text/csv;charset=utf-8'
      : ext === 'md'
        ? 'text/markdown;charset=utf-8'
        : 'text/plain;charset=utf-8';
  const blob = new Blob([analysis.redactedText], { type: outMime });

  return {
    blob,
    fileName: safeOutputName(file.name),
    mimeType: outMime,
    formatPreserved: true,
    contextAnalysis: analysis,
    metadataStripped: false,
    processingMs: Number(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started).toFixed(1)),
  };
}

/**
 * Exports the user's sanitized document in any desired format:
 * - 'original': preserves the uploaded file's native format (.docx OpenXML, .pdf visual-redacted, .json, .csv, etc.)
 * - 'pdf' / 'docx' / 'md' / 'txt' / 'json': converts sanitized content cleanly into the requested format in RAM.
 */
export async function exportSanitizedDocumentAs(
  rawText: string,
  originalFile: File | null,
  targetFormat: SafeDocumentExportFormat,
  options: ContextGuardOptions & { pdfWorkerSrc?: string } = {}
): Promise<RedactedFileResult> {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();

  if (targetFormat === 'original' && originalFile) {
    return redactFileLocally(originalFile, options);
  }

  // If user chose the same format as originalFile (.docx or .pdf), preserve exact original layout!
  if (originalFile) {
    const origExt = getFileExtension(originalFile.name);
    if (
      (targetFormat === 'docx' && origExt === 'docx') ||
      (targetFormat === 'pdf' && origExt === 'pdf') ||
      (targetFormat === 'json' && origExt === 'json')
    ) {
      return redactFileLocally(originalFile, options);
    }
  }

  const baseStem = originalFile
    ? originalFile.name.replace(/\.[^.]+$/, '')
    : `privaguard-safe-${Date.now()}`;
  const safeStem = baseStem.toLowerCase().startsWith('safe-') ? baseStem : `safe-${baseStem}`;
  const analysis = analyzeWithContextGuard(rawText, options);

  if (targetFormat === 'docx') {
    const bytes = await buildNativeDocxBytes(safeStem, analysis.redactedText);
    const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    return {
      blob: new Blob([bytes.buffer as ArrayBuffer], { type: mimeType }),
      fileName: `${safeStem}.docx`,
      mimeType,
      formatPreserved: true,
      contextAnalysis: analysis,
      metadataStripped: true,
      processingMs: Number(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started).toFixed(1)),
    };
  }

  if (targetFormat === 'pdf') {
    const bytes = await buildCleanPdfBytes(safeStem, analysis.redactedText);
    const mimeType = 'application/pdf';
    return {
      blob: new Blob([bytes.buffer as ArrayBuffer], { type: mimeType }),
      fileName: `${safeStem}.pdf`,
      mimeType,
      formatPreserved: true,
      contextAnalysis: analysis,
      metadataStripped: true,
      processingMs: Number(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started).toFixed(1)),
    };
  }

  if (targetFormat === 'json') {
    const jsonRes = redactJsonTextPreservingSyntax(rawText, options);
    const outText = jsonRes.validJson
      ? jsonRes.redactedText
      : JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            contextKind: analysis.contextKind,
            maskedCount: analysis.activeVault.length,
            safeText: analysis.redactedText,
          },
          null,
          2
        );
    const mimeType = 'application/json;charset=utf-8';
    return {
      blob: new Blob([outText], { type: mimeType }),
      fileName: `${safeStem}.json`,
      mimeType,
      formatPreserved: true,
      contextAnalysis: analysis,
      metadataStripped: false,
      processingMs: Number(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started).toFixed(1)),
    };
  }

  const isMd = targetFormat === 'md';
  const mimeType = isMd ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
  return {
    blob: new Blob([analysis.redactedText], { type: mimeType }),
    fileName: `${safeStem}.${isMd ? 'md' : 'txt'}`,
    mimeType,
    formatPreserved: true,
    contextAnalysis: analysis,
    metadataStripped: false,
    processingMs: Number(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started).toFixed(1)),
  };
}
