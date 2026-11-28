export const MAX_PDF_PAGES = 25;

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'log', 'json', 'env', 'csv']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);

export interface ParsedDocumentResult {
  text: string;
  meta: string;
}

export interface RawPdfTextItem {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
  width?: number;
  height?: number;
}

export function getFileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  if (idx < 0) return '';
  return fileName.slice(idx + 1).toLowerCase();
}

export function classifyDroppedFile(file: {
  name: string;
  type?: string;
}): 'pdf' | 'docx' | 'text' | 'image' | 'unsupported' {
  const ext = getFileExtension(file.name);
  const mime = (file.type || '').toLowerCase();
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (
    ext === 'docx' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }
  if (IMAGE_EXTENSIONS.has(ext) || mime.startsWith('image/')) return 'image';
  if (TEXT_EXTENSIONS.has(ext) || mime.startsWith('text/')) return 'text';
  return 'unsupported';
}

/**
 * Reconstructs clean, layout-aware text from pdfjs-dist `getTextContent().items`,
 * preserving line breaks, headings, lists, and paragraph spacing via Y-coordinate deltas & hasEOL.
 */
export function reconstructPdfPageText(items: RawPdfTextItem[]): string {
  const lines: string[] = [];
  let currentLine = '';
  let prevY: number | null = null;
  let prevRightX: number | null = null;
  let prevFontH = 11;

  for (const item of items) {
    const str = typeof item.str === 'string' ? item.str : '';
    const hasTransform = Array.isArray(item.transform) && item.transform.length >= 6;
    const x = hasTransform ? Number(item.transform![4]) : null;
    const y = hasTransform ? Number(item.transform![5]) : null;
    const fontH = Math.max(
      typeof item.height === 'number' && item.height > 0 ? item.height : 0,
      hasTransform ? Math.hypot(Number(item.transform![2]) || 0, Number(item.transform![3]) || 0) : 0,
      prevFontH,
      9
    );

    if (prevY !== null && y !== null) {
      const deltaY = Math.abs(prevY - y);
      const lineBreakThreshold = Math.max(3, fontH * 0.45);
      if (deltaY > lineBreakThreshold) {
        if (currentLine.trim()) {
          lines.push(currentLine.replace(/[ \t]{2,}/g, ' ').trimEnd());
        }
        // Insert blank line on clear paragraph / heading separation
        if (deltaY > fontH * 1.55 && lines.length > 0 && lines[lines.length - 1] !== '') {
          lines.push('');
        }
        currentLine = '';
        prevRightX = null;
      }
    }

    if (str) {
      if (currentLine.length > 0 && !currentLine.endsWith(' ') && !str.startsWith(' ')) {
        const gap = x !== null && prevRightX !== null ? x - prevRightX : 2;
        if (gap > Math.max(1.2, fontH * 0.12)) {
          currentLine += ' ';
        }
      }
      currentLine += str;
    }

    if (y !== null) prevY = y;
    if (x !== null) {
      const w = typeof item.width === 'number' && item.width > 0 ? item.width : str.length * fontH * 0.5;
      prevRightX = x + w;
    }
    prevFontH = fontH;

    if (item.hasEOL) {
      if (currentLine.trim()) {
        lines.push(currentLine.replace(/[ \t]{2,}/g, ' ').trimEnd());
      }
      currentLine = '';
      prevRightX = null;
    }
  }

  if (currentLine.trim()) {
    lines.push(currentLine.replace(/[ \t]{2,}/g, ' ').trimEnd());
  }

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extracts text 100% locally in browser RAM from PDF, DOCX, or plain text files.
 * Heavy parsers (`pdfjs-dist`, `mammoth`) are dynamically imported ONLY when needed
 * so initial JS bundle size stays untouched.
 */
export async function parseDocumentLocally(file: File): Promise<ParsedDocumentResult> {
  const kind = classifyDroppedFile(file);

  if (kind === 'pdf') {
    const [pdfjsLib, workerMod] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]);
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerMod.default;

    const buffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const pdf = await loadingTask.promise;

    const totalPages = pdf.numPages;
    const pagesToRead = Math.min(totalPages, MAX_PDF_PAGES);
    const pageTexts: string[] = [];

    for (let p = 1; p <= pagesToRead; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const pageBody = reconstructPdfPageText(content.items as RawPdfTextItem[]);
      if (pageBody) {
        pageTexts.push(pagesToRead > 1 ? `--- Page ${p} ---\n${pageBody}` : pageBody);
      }
    }

    await loadingTask.destroy();

    const truncatedNote =
      totalPages > MAX_PDF_PAGES
        ? ` (trimmed at page ${MAX_PDF_PAGES} of ${totalPages})`
        : '';

    return {
      text: pageTexts.join('\n\n'),
      meta: `${file.name} · ${pagesToRead} page${pagesToRead === 1 ? '' : 's'} extracted locally${truncatedNote}`,
    };
  }

  if (kind === 'docx') {
    const mammothMod = await import('mammoth');
    const mammoth = mammothMod.default ?? mammothMod;
    const arrayBuffer = await file.arrayBuffer();
    const { value } = await mammoth.extractRawText({ arrayBuffer });
    const cleaned = value.replace(/\n{3,}/g, '\n\n').trim();
    const wordCount = cleaned ? cleaned.split(/\s+/).length : 0;

    return {
      text: cleaned,
      meta: `${file.name} · ${wordCount.toLocaleString()} words extracted locally`,
    };
  }

  if (kind === 'text') {
    const text = await file.text();
    const kb = Math.max(1, Math.round(file.size / 1024));
    return {
      text,
      meta: `${file.name} · ${kb} KB loaded locally`,
    };
  }

  throw new Error(
    `Unsupported file type "${file.name}". Please drop a PDF, DOCX, TXT/MD/LOG/JSON/CSV, or PNG/JPG/WebP image.`
  );
}
