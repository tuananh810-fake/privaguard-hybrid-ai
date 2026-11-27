export const MAX_PDF_PAGES = 25;

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'log', 'json', 'env', 'csv']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);

export interface ParsedDocumentResult {
  text: string;
  meta: string;
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
      const strings = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .filter(Boolean);
      pageTexts.push(strings.join(' ').replace(/\s{2,}/g, ' ').trim());
    }

    await loadingTask.destroy();

    const truncatedNote =
      totalPages > MAX_PDF_PAGES
        ? ` (trimmed at page ${MAX_PDF_PAGES} of ${totalPages})`
        : '';

    return {
      text: pageTexts.filter(Boolean).join('\n\n'),
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
