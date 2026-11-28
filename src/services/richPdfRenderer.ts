/**
 * Zero-dependency, 100% client-side Rich-Layout A4 PDF Renderer.
 * Paints sanitized HTML/DOCX/Markdown/CSV/Code/Report layouts onto 2x DPI A4 Canvas
 * using native OS Unicode fonts (full Vietnamese diacritics, zero WinAnsi loss,
 * zero tainted-canvas SecurityError) with solid-black [TOKEN_N] redaction pills,
 * then packs into a metadata-stripped pdf-lib PDF with zero hidden text layer.
 */

import { parseCsvRows } from './lightFileRedactor.ts';
import { safeSanitizeDocumentHtml } from './safeHtml.ts';
import { buildCleanPdfBytes } from './reportExporter.ts';

const TOKEN_SPLIT_RE = /(\[[A-Z]+_\d+\])/g;
const TOKEN_EXACT_RE = /^\[[A-Z]+_\d+\]$/;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatInlineMd(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return out;
}

/**
 * Pure converter turning Markdown (headings, tables, lists, code fences, blockquotes, paragraphs)
 * into safe semantic HTML for both native preview and A4 PDF rendering.
 */
export function markdownToSafeHtml(md: string): string {
  if (!md) return '';
  const lines = md.split(/\r?\n/);
  const parts: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Fenced code block
    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      parts.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    // Horizontal rule
    if (/^(?:---+|\*\*\*+|___+)$/.test(trimmed)) {
      parts.push('<hr />');
      i += 1;
      continue;
    }

    // Heading
    const hMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      parts.push(`<h${level}>${formatInlineMd(hMatch[2])}</h${level}>`);
      i += 1;
      continue;
    }

    // Markdown table
    if (
      trimmed.includes('|') &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:-]+\|[\s|:-]+\s*$/.test(lines[i + 1])
    ) {
      const parseRow = (rowLine: string) =>
        rowLine
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());

      const headerCells = parseRow(trimmed);
      i += 2;
      const bodyRows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim().length > 0) {
        bodyRows.push(parseRow(lines[i]));
        i += 1;
      }
      const thead = `<thead><tr>${headerCells.map((c) => `<th>${formatInlineMd(c)}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${bodyRows
        .map((r) => `<tr>${r.map((c) => `<td>${formatInlineMd(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody>`;
      parts.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    // Unordered list
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(`<li>${formatInlineMd(lines[i].replace(/^\s*[-*•]\s+/, ''))}</li>`);
        i += 1;
      }
      parts.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(`<li>${formatInlineMd(lines[i].replace(/^\s*\d+[.)]\s+/, ''))}</li>`);
        i += 1;
      }
      parts.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      parts.push(`<blockquote><p>${formatInlineMd(quoteLines.join(' '))}</p></blockquote>`);
      continue;
    }

    // Paragraph (coalesce contiguous plain lines)
    const paraLines: string[] = [trimmed];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(?:#{1,4}\s+|```|[-*•]\s+|\d+[.)]\s+|>\s?|---+|\*\*\*+)/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i].trim());
      i += 1;
    }
    parts.push(`<p>${formatInlineMd(paraLines.join(' '))}</p>`);
  }

  return safeSanitizeDocumentHtml(parts.join('\n'));
}

export function csvRowsToSafeHtml(rows: string[][]): string {
  if (rows.length === 0) return '<p>(Empty CSV)</p>';
  const header = rows[0];
  const body = rows.slice(1);
  const thead = `<thead><tr>${header.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>`;
  const tbody = `<tbody>${body
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody>`;
  return safeSanitizeDocumentHtml(`<table>${thead}${tbody}</table>`);
}

// ---------------------------------------------------------------------------
// Internal Layout AST & 2x DPI A4 Canvas Paginator
// ---------------------------------------------------------------------------

interface InlineSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  isToken?: boolean;
}

type LayoutBlock =
  | { kind: 'heading'; level: number; spans: InlineSpan[] }
  | { kind: 'paragraph'; spans: InlineSpan[]; quote?: boolean }
  | { kind: 'list_item'; bullet: string; spans: InlineSpan[] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; header: string[][]; rows: string[][] }
  | { kind: 'image'; src: string }
  | { kind: 'hr' };

function splitTokensIntoSpans(text: string, style: Omit<InlineSpan, 'text' | 'isToken'>): InlineSpan[] {
  if (!text) return [];
  const parts = text.split(TOKEN_SPLIT_RE).filter((p) => p.length > 0);
  return parts.map((part) =>
    TOKEN_EXACT_RE.test(part)
      ? { text: part, isToken: true }
      : { text: part, ...style }
  );
}

function collectInlineSpans(
  node: Node,
  style: Omit<InlineSpan, 'text' | 'isToken'> = {}
): InlineSpan[] {
  if (node.nodeType === 3) {
    const raw = (node.textContent || '').replace(/\s+/g, ' ');
    return splitTokensIntoSpans(raw, style);
  }
  if (node.nodeType !== 1) return [];
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === 'br') return [{ text: '\n' }];
  const nextStyle: Omit<InlineSpan, 'text' | 'isToken'> = {
    bold: style.bold || tag === 'strong' || tag === 'b',
    italic: style.italic || tag === 'em' || tag === 'i',
    code: style.code || tag === 'code',
  };
  const spans: InlineSpan[] = [];
  for (const child of Array.from(el.childNodes)) {
    spans.push(...collectInlineSpans(child, nextStyle));
  }
  return spans;
}

function extractLayoutBlocksFromHtml(sanitizedHtml: string): LayoutBlock[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(sanitizedHtml, 'text/html');
  const blocks: LayoutBlock[] = [];

  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      const txt = (node.textContent || '').trim();
      if (txt) blocks.push({ kind: 'paragraph', spans: splitTokensIntoSpans(txt, {}) });
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (/^h[1-6]$/.test(tag)) {
      const spans = collectInlineSpans(el, { bold: true });
      if (spans.length > 0) blocks.push({ kind: 'heading', level: Math.min(4, Number(tag[1])), spans });
      return;
    }
    if (tag === 'hr') {
      blocks.push({ kind: 'hr' });
      return;
    }
    if (tag === 'img') {
      const src = el.getAttribute('src') || '';
      if (src.startsWith('data:image/')) {
        blocks.push({ kind: 'image', src });
      }
      return;
    }
    if (tag === 'pre') {
      const text = (el.textContent || '').replace(/\r\n/g, '\n');
      if (text.trim()) blocks.push({ kind: 'code', text });
      return;
    }
    if (tag === 'blockquote') {
      const spans = collectInlineSpans(el, { italic: true });
      if (spans.length > 0) blocks.push({ kind: 'paragraph', spans, quote: true });
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      let idx = 1;
      for (const child of Array.from(el.children)) {
        if (child.tagName.toLowerCase() === 'li') {
          const spans = collectInlineSpans(child);
          if (spans.length > 0) {
            blocks.push({
              kind: 'list_item',
              bullet: tag === 'ol' ? `${idx}.` : '•',
              spans,
            });
            idx += 1;
          }
        }
      }
      return;
    }
    if (tag === 'table') {
      const header: string[][] = [];
      const rows: string[][] = [];
      const trNodes = Array.from(el.querySelectorAll('tr'));
      trNodes.forEach((tr, rowIdx) => {
        const cells = Array.from(tr.children)
          .filter((c) => c.tagName.toLowerCase() === 'th' || c.tagName.toLowerCase() === 'td')
          .map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim());
        if (cells.length === 0) return;
        const isHeaderRow =
          tr.parentElement?.tagName.toLowerCase() === 'thead' ||
          (rowIdx === 0 && tr.querySelector('th') !== null);
        if (isHeaderRow && header.length === 0) header.push(cells);
        else rows.push(cells);
      });
      if (header.length > 0 || rows.length > 0) {
        blocks.push({ kind: 'table', header, rows });
      }
      return;
    }
    if (tag === 'p') {
      const imgs = Array.from(el.querySelectorAll('img'));
      for (const img of imgs) {
        const src = img.getAttribute('src') || '';
        if (src.startsWith('data:image/')) {
          blocks.push({ kind: 'image', src });
        }
      }
      const spans = collectInlineSpans(el);
      if (spans.some((s) => s.text.trim().length > 0)) {
        blocks.push({ kind: 'paragraph', spans });
      }
      return;
    }
    for (const child of Array.from(el.childNodes)) {
      visit(child);
    }
  };

  for (const child of Array.from(doc.body.childNodes)) {
    visit(child);
  }
  return blocks;
}

const A4_PT_W = 595.28;
const A4_PT_H = 841.89;
const RENDER_SCALE = 2;
const MARGIN_X = 44;
const MARGIN_TOP = 46;
const MARGIN_BOTTOM = 46;
const CONTENT_W = A4_PT_W - MARGIN_X * 2;
const SANS_FAMILY = '"Segoe UI", "Inter", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
const MONO_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

interface WrappedTokenSegment {
  text: string;
  font: string;
  width: number;
  isToken?: boolean;
  isCode?: boolean;
  color: string;
}

function makeFont(size: number, opts: { bold?: boolean; italic?: boolean; mono?: boolean } = {}): string {
  const weight = opts.bold ? '700' : '400';
  const style = opts.italic ? 'italic' : 'normal';
  const family = opts.mono ? MONO_FAMILY : SANS_FAMILY;
  return `${style} ${weight} ${size}px ${family}`;
}

function wrapInlineSpans(
  ctx: CanvasRenderingContext2D,
  spans: InlineSpan[],
  maxWidth: number,
  baseSize: number,
  defaultColor: string
): WrappedTokenSegment[][] {
  const lines: WrappedTokenSegment[][] = [];
  let curLine: WrappedTokenSegment[] = [];
  let curW = 0;

  const pushLine = () => {
    lines.push(curLine);
    curLine = [];
    curW = 0;
  };

  for (const span of spans) {
    if (span.text === '\n') {
      pushLine();
      continue;
    }
    if (span.isToken) {
      const font = makeFont(Math.max(8.5, baseSize - 1), { bold: true, mono: true });
      ctx.font = font;
      const w = ctx.measureText(span.text).width + 10;
      if (curW > 0 && curW + w > maxWidth) pushLine();
      curLine.push({ text: span.text, font, width: w, isToken: true, color: '#ffffff' });
      curW += w + 2;
      continue;
    }

    const font = makeFont(span.code ? Math.max(8.5, baseSize - 0.8) : baseSize, {
      bold: span.bold,
      italic: span.italic,
      mono: span.code,
    });
    ctx.font = font;

    // Split keeping spaces so wrapping preserves Vietnamese words naturally
    const words = span.text.match(/\S+|\s+/g) || [];
    for (const word of words) {
      if (curW === 0 && /^\s+$/.test(word)) continue;
      let w = ctx.measureText(word).width;
      if (span.code && !/^\s+$/.test(word)) w += 4;

      if (curW > 0 && curW + w > maxWidth && !/^\s+$/.test(word)) {
        pushLine();
      }

      // Break extraordinarily long unbreakable strings (URLs/hashes)
      if (w > maxWidth && word.length > 8) {
        let rem = word;
        while (rem.length > 0) {
          let take = rem.length;
          while (take > 1 && ctx.measureText(rem.slice(0, take)).width > maxWidth - curW) {
            take -= 1;
          }
          const piece = rem.slice(0, Math.max(1, take));
          const pw = ctx.measureText(piece).width;
          curLine.push({
            text: piece,
            font,
            width: pw,
            isCode: span.code,
            color: defaultColor,
          });
          curW += pw;
          rem = rem.slice(Math.max(1, take));
          if (rem.length > 0) pushLine();
        }
      } else {
        curLine.push({
          text: word,
          font,
          width: w,
          isCode: span.code && !/^\s+$/.test(word),
          color: defaultColor,
        });
        curW += w;
      }
    }
  }

  if (curLine.length > 0 || lines.length === 0) {
    lines.push(curLine);
  }
  return lines;
}

function drawWrappedLine(
  ctx: CanvasRenderingContext2D,
  line: WrappedTokenSegment[],
  x: number,
  y: number,
  lineHeight: number
) {
  let cx = x;
  const midY = y + lineHeight * 0.52;
  ctx.textBaseline = 'middle';

  for (const seg of line) {
    if (seg.isToken) {
      const pillH = Math.max(13, lineHeight - 2);
      const pillY = midY - pillH / 2;
      const r = 3;
      ctx.fillStyle = '#09090b';
      ctx.beginPath();
      ctx.moveTo(cx + r, pillY);
      ctx.lineTo(cx + seg.width - r, pillY);
      ctx.quadraticCurveTo(cx + seg.width, pillY, cx + seg.width, pillY + r);
      ctx.lineTo(cx + seg.width, pillY + pillH - r);
      ctx.quadraticCurveTo(cx + seg.width, pillY + pillH, cx + seg.width - r, pillY + pillH);
      ctx.lineTo(cx + r, pillY + pillH);
      ctx.quadraticCurveTo(cx, pillY + pillH, cx, pillY + pillH - r);
      ctx.lineTo(cx, pillY + r);
      ctx.quadraticCurveTo(cx, pillY, cx + r, pillY);
      ctx.closePath();
      ctx.fill();

      ctx.font = seg.font;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(seg.text, cx + 5, midY);
      cx += seg.width + 2;
      continue;
    }

    if (seg.isCode) {
      const codeH = Math.max(12, lineHeight - 3);
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(cx, midY - codeH / 2, seg.width, codeH);
      ctx.font = seg.font;
      ctx.fillStyle = '#0f172a';
      ctx.fillText(seg.text, cx + 2, midY);
      cx += seg.width;
      continue;
    }

    ctx.font = seg.font;
    ctx.fillStyle = seg.color;
    ctx.fillText(seg.text, cx, midY);
    cx += seg.width;
  }
}

function loadDataImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function canvasToJpegBytes(canvas: HTMLCanvasElement, quality = 0.91): Promise<Uint8Array> {
  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality)
    );
    if (blob) return new Uint8Array(await blob.arrayBuffer());
  }
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const b64 = dataUrl.split(',')[1] || '';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function renderRedactedHtmlToPdfBytes(
  title: string,
  html: string,
  opts: {
    subtitle?: string;
    redactionCount?: number;
    maxPages?: number;
    includeHeaderFooter?: boolean;
  } = {}
): Promise<Uint8Array> {
  const sanitized = safeSanitizeDocumentHtml(html);
  const includeHeaderFooter = opts.includeHeaderFooter ?? false;

  // Headless Node fallback for automated tests
  if (typeof document === 'undefined' || typeof DOMParser === 'undefined') {
    const plain = sanitized.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
    return buildCleanPdfBytes(title, plain, includeHeaderFooter);
  }

  const blocks = extractLayoutBlocksFromHtml(sanitized);
  const maxPages = opts.maxPages ?? 30;
  const pages: HTMLCanvasElement[] = [];

  const createPage = (): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(A4_PT_W * RENDER_SCALE);
    canvas.height = Math.round(A4_PT_H * RENDER_SCALE);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(RENDER_SCALE, RENDER_SCALE);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, A4_PT_W, A4_PT_H);
    pages.push(canvas);
    return { canvas, ctx };
  };

  let current = createPage();
  let y = MARGIN_TOP;

  const nextPage = () => {
    if (pages.length >= maxPages) return false;
    current = createPage();
    y = MARGIN_TOP;
    return true;
  };

  const ensureSpace = (needed: number): boolean => {
    if (y + needed <= A4_PT_H - MARGIN_BOTTOM) return true;
    return nextPage();
  };

  // Optional Report Top Banner (omitted for pure user document exports)
  if (includeHeaderFooter) {
    current.ctx.fillStyle = '#0f766e';
    current.ctx.fillRect(MARGIN_X, y, 4, 24);
    current.ctx.font = makeFont(14, { bold: true });
    current.ctx.fillStyle = '#111827';
    current.ctx.textBaseline = 'top';
    current.ctx.fillText(title.slice(0, 72), MARGIN_X + 12, y + 1, CONTENT_W - 16);

    const subParts = [
      opts.subtitle || 'Redacted Document',
      typeof opts.redactionCount === 'number'
        ? `${opts.redactionCount} redaction${opts.redactionCount === 1 ? '' : 's'} applied`
        : null,
      '0 hidden text · metadata stripped',
    ].filter(Boolean);
    current.ctx.font = makeFont(8.5);
    current.ctx.fillStyle = '#6b7280';
    current.ctx.fillText(subParts.join(' · '), MARGIN_X + 12, y + 18, CONTENT_W - 16);
    y += 36;
    current.ctx.strokeStyle = '#e5e7eb';
    current.ctx.lineWidth = 0.8;
    current.ctx.beginPath();
    current.ctx.moveTo(MARGIN_X, y);
    current.ctx.lineTo(MARGIN_X + CONTENT_W, y);
    current.ctx.stroke();
    y += 14;
  }

  for (const block of blocks) {
    if (pages.length > maxPages) break;

    if (block.kind === 'hr') {
      if (!ensureSpace(14)) break;
      y += 4;
      current.ctx.strokeStyle = '#e5e7eb';
      current.ctx.lineWidth = 0.8;
      current.ctx.beginPath();
      current.ctx.moveTo(MARGIN_X, y);
      current.ctx.lineTo(MARGIN_X + CONTENT_W, y);
      current.ctx.stroke();
      y += 10;
      continue;
    }

    if (block.kind === 'heading') {
      const size = block.level === 1 ? 14 : block.level === 2 ? 12 : 10.5;
      const lh = size + 6;
      const lines = wrapInlineSpans(current.ctx, block.spans, CONTENT_W, size, '#111827');
      if (!ensureSpace(lines.length * lh + 16)) break;
      y += 6;
      for (const line of lines) {
        drawWrappedLine(current.ctx, line, MARGIN_X, y, lh);
        y += lh;
      }
      y += 4;
      continue;
    }

    if (block.kind === 'paragraph') {
      const lh = 15.5;
      const indent = block.quote ? 14 : 0;
      const lines = wrapInlineSpans(
        current.ctx,
        block.spans,
        CONTENT_W - indent,
        10,
        block.quote ? '#4b5563' : '#1f2937'
      );
      for (const line of lines) {
        if (!ensureSpace(lh)) break;
        if (block.quote) {
          current.ctx.fillStyle = '#0f766e';
          current.ctx.fillRect(MARGIN_X + 2, y, 2.5, lh);
        }
        drawWrappedLine(current.ctx, line, MARGIN_X + indent, y, lh);
        y += lh;
      }
      y += 6;
      continue;
    }

    if (block.kind === 'list_item') {
      const lh = 15;
      const indent = 18;
      const lines = wrapInlineSpans(current.ctx, block.spans, CONTENT_W - indent, 10, '#1f2937');
      lines.forEach((line, idx) => {
        if (!ensureSpace(lh)) return;
        if (idx === 0) {
          current.ctx.font = makeFont(10, { bold: true });
          current.ctx.fillStyle = '#0f766e';
          current.ctx.textBaseline = 'middle';
          current.ctx.fillText(block.bullet, MARGIN_X + 4, y + lh * 0.52);
        }
        drawWrappedLine(current.ctx, line, MARGIN_X + indent, y, lh);
        y += lh;
      });
      y += 3;
      continue;
    }

    if (block.kind === 'code') {
      const lh = 13.5;
      const rawLines = block.text.split('\n');
      for (const rawLine of rawLines) {
        const spans = splitTokensIntoSpans(rawLine || ' ', { code: true });
        const wrapped = wrapInlineSpans(current.ctx, spans, CONTENT_W - 16, 8.8, '#0f172a');
        for (const wl of wrapped) {
          if (!ensureSpace(lh + 2)) break;
          current.ctx.fillStyle = '#f8fafc';
          current.ctx.fillRect(MARGIN_X, y, CONTENT_W, lh + 1);
          current.ctx.fillStyle = '#cbd5e1';
          current.ctx.fillRect(MARGIN_X, y, 2, lh + 1);
          drawWrappedLine(current.ctx, wl, MARGIN_X + 8, y, lh);
          y += lh;
        }
      }
      y += 8;
      continue;
    }

    if (block.kind === 'table') {
      const allRows = [...block.header, ...block.rows];
      const colCount = Math.max(1, ...allRows.map((r) => r.length));
      const colW = CONTENT_W / colCount;
      const cellPadX = 6;
      const cellPadY = 4;
      const cellLh = 13.5;

      const drawTableRow = (cells: string[], isHeader: boolean): boolean => {
        const wrappedCells = Array.from({ length: colCount }, (_, cIdx) => {
          const txt = cells[cIdx] ?? '';
          const spans = splitTokensIntoSpans(txt, { bold: isHeader });
          return wrapInlineSpans(
            current.ctx,
            spans,
            Math.max(24, colW - cellPadX * 2),
            isHeader ? 9 : 8.8,
            isHeader ? '#111827' : '#1f2937'
          );
        });
        const maxLines = Math.max(1, ...wrappedCells.map((wc) => wc.length));
        const rowH = maxLines * cellLh + cellPadY * 2;

        if (y + rowH > A4_PT_H - MARGIN_BOTTOM) {
          if (!nextPage()) return false;
          if (!isHeader && block.header.length > 0) {
            drawTableRow(block.header[0], true);
          }
        }

        if (isHeader) {
          current.ctx.fillStyle = '#f3f4f6';
          current.ctx.fillRect(MARGIN_X, y, CONTENT_W, rowH);
        }
        current.ctx.strokeStyle = '#d1d5db';
        current.ctx.lineWidth = 0.7;
        current.ctx.strokeRect(MARGIN_X, y, CONTENT_W, rowH);

        for (let c = 0; c < colCount; c++) {
          const cx = MARGIN_X + c * colW;
          if (c > 0) {
            current.ctx.beginPath();
            current.ctx.moveTo(cx, y);
            current.ctx.lineTo(cx, y + rowH);
            current.ctx.stroke();
          }
          const cellLines = wrappedCells[c];
          cellLines.forEach((cl, lIdx) => {
            drawWrappedLine(current.ctx, cl, cx + cellPadX, y + cellPadY + lIdx * cellLh, cellLh);
          });
        }
        y += rowH;
        return true;
      };

      if (block.header.length > 0) {
        drawTableRow(block.header[0], true);
      }
      for (const r of block.rows) {
        if (!drawTableRow(r, false)) break;
      }
      y += 10;
      continue;
    }

    if (block.kind === 'image') {
      const img = await loadDataImage(block.src);
      if (!img || !img.naturalWidth || !img.naturalHeight) continue;
      const maxH = 260;
      const ratio = Math.min(1, CONTENT_W / img.naturalWidth, maxH / img.naturalHeight);
      const drawW = img.naturalWidth * ratio;
      const drawH = img.naturalHeight * ratio;
      if (!ensureSpace(drawH + 12)) break;
      current.ctx.drawImage(img, MARGIN_X, y, drawW, drawH);
      y += drawH + 10;
    }
  }

  // Optional page footer (omitted for pure user document exports so original layout stays clean)
  if (includeHeaderFooter) {
    const totalPages = pages.length;
    pages.forEach((canvas, idx) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const footerY = A4_PT_H - 28;
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(MARGIN_X, footerY - 6);
      ctx.lineTo(MARGIN_X + CONTENT_W, footerY - 6);
      ctx.stroke();

      ctx.font = makeFont(8);
      ctx.fillStyle = '#6b7280';
      ctx.textBaseline = 'top';
      ctx.fillText('Redacted locally in browser RAM · PrivaGuard AI', MARGIN_X, footerY);
      const pageLabel = `Page ${idx + 1} / ${totalPages}`;
      const labelW = ctx.measureText(pageLabel).width;
      ctx.fillText(pageLabel, MARGIN_X + CONTENT_W - labelW, footerY);
    });
  }

  // Pack pages into a metadata-stripped, zero-hidden-text PDF via pdf-lib
  const { PDFDocument } = await import('pdf-lib');
  const outPdf = await PDFDocument.create();
  outPdf.setTitle('');
  outPdf.setAuthor('');
  outPdf.setSubject('');
  outPdf.setKeywords([]);
  outPdf.setCreator('');
  outPdf.setProducer('');

  for (const canvas of pages) {
    const jpgBytes = await canvasToJpegBytes(canvas, 0.91);
    const embedded = await outPdf.embedJpg(jpgBytes);
    const page = outPdf.addPage([A4_PT_W, A4_PT_H]);
    page.drawImage(embedded, { x: 0, y: 0, width: A4_PT_W, height: A4_PT_H });
  }

  return outPdf.save({ useObjectStreams: false });
}

export async function renderRedactedDocxToPdfBytes(
  redactedDocxBytes: Uint8Array,
  title: string,
  redactionCount: number,
  includeHeaderFooter = false
): Promise<Uint8Array> {
  const mammothMod = await import('mammoth');
  const mammoth = mammothMod.default ?? mammothMod;
  const copy = new Uint8Array(redactedDocxBytes);
  const mammothInput =
    typeof window === 'undefined' && typeof Buffer !== 'undefined'
      ? ({ buffer: Buffer.from(copy) } as unknown as { arrayBuffer: ArrayBuffer })
      : { arrayBuffer: copy.buffer };
  const res = await mammoth.convertToHtml(mammothInput);
  const html = res.value || '<p>(Empty document)</p>';
  return renderRedactedHtmlToPdfBytes(title, html, {
    subtitle: 'Converted from Word (.docx) · layout preserved',
    redactionCount,
    includeHeaderFooter,
  });
}

export async function renderStructuredTextToPdfBytes(
  kind: 'md' | 'csv' | 'json' | 'txt',
  redactedText: string,
  title: string,
  redactionCount: number,
  includeHeaderFooter = false
): Promise<Uint8Array> {
  if (kind === 'csv') {
    const { rows } = parseCsvRows(redactedText);
    return renderRedactedHtmlToPdfBytes(title, csvRowsToSafeHtml(rows), {
      subtitle: 'Converted from CSV table · cell-level redaction',
      redactionCount,
      includeHeaderFooter,
    });
  }
  if (kind === 'json') {
    const html = `<pre><code>${escapeHtml(redactedText)}</code></pre>`;
    return renderRedactedHtmlToPdfBytes(title, html, {
      subtitle: 'Converted from JSON · syntax preserved',
      redactionCount,
      includeHeaderFooter,
    });
  }
  if (kind === 'md') {
    return renderRedactedHtmlToPdfBytes(title, markdownToSafeHtml(redactedText), {
      subtitle: 'Converted from Markdown',
      redactionCount,
      includeHeaderFooter,
    });
  }
  // Plain text / logs / env
  const html = markdownToSafeHtml(redactedText);
  return renderRedactedHtmlToPdfBytes(title, html, {
    subtitle: 'Sanitized Document',
    redactionCount,
    includeHeaderFooter,
  });
}
