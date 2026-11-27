import { type CategoryFilter, DEFAULT_CATEGORY_FILTER, redactLocally } from './piiVault.ts';

export interface OcrBBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  bbox: OcrBBox;
}

export interface OcrLine {
  text: string;
  bbox: OcrBBox;
  words?: OcrWord[];
}

export interface CanvasMaskBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function normalizeToken(str: string): string {
  return str.replace(/\s+/g, ' ').trim().toLowerCase();
}

function padAndClamp(bbox: OcrBBox, padding: number, maxW?: number, maxH?: number): CanvasMaskBox {
  const x0 = Math.max(0, bbox.x0 - padding);
  const y0 = Math.max(0, bbox.y0 - padding);
  const x1 = maxW !== undefined ? Math.min(maxW, bbox.x1 + padding) : bbox.x1 + padding;
  const y1 = maxH !== undefined ? Math.min(maxH, bbox.y1 + padding) : bbox.y1 + padding;
  return {
    x: Math.round(x0),
    y: Math.round(y0),
    w: Math.max(8, Math.round(x1 - x0)),
    h: Math.max(8, Math.round(y1 - y0)),
  };
}

/**
 * Pure helper: runs PrivaGuard's local PII vault over OCR lines and maps detected
 * secrets/PII back to padded word-level bounding boxes on the image canvas.
 */
export function matchPiiBoxesFromOcrLines(
  lines: OcrLine[],
  extraTerms: string[] = [],
  categories: CategoryFilter = DEFAULT_CATEGORY_FILTER,
  options: { padding?: number; canvasWidth?: number; canvasHeight?: number } = {}
): { boxes: CanvasMaskBox[]; matchedTokens: string[] } {
  const padding = options.padding ?? 4;
  const boxes: CanvasMaskBox[] = [];
  const matchedTokens: string[] = [];
  const seenKeys = new Set<string>();

  const pushBox = (bbox: OcrBBox, token: string) => {
    const padded = padAndClamp(bbox, padding, options.canvasWidth, options.canvasHeight);
    const key = `${padded.x}:${padded.y}:${padded.w}:${padded.h}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      boxes.push(padded);
      matchedTokens.push(token);
    }
  };

  for (const line of lines) {
    const lineText = (line.text || '').trim();
    if (!lineText) continue;

    const redaction = redactLocally(lineText, extraTerms, categories);
    if (redaction.vault.length === 0) continue;

    const words = (line.words || []).filter((w) => w.text && w.text.trim().length > 0);

    for (const entry of redaction.vault) {
      const targetNorm = normalizeToken(entry.original);
      const targetCompact = targetNorm.replace(/\s+/g, '');
      let foundWordMatch = false;

      if (words.length > 0) {
        // Search shortest word spans first (len = 1..8) so we always get the tightest exact bbox
        const maxLen = Math.min(8, words.length);
        for (let len = 1; len <= maxLen && !foundWordMatch; len++) {
          for (let start = 0; start <= words.length - len; start++) {
            let joined = '';
            let minX0 = Infinity;
            let minY0 = Infinity;
            let maxX1 = -Infinity;
            let maxY1 = -Infinity;

            for (let k = start; k < start + len; k++) {
              const w = words[k];
              joined = joined ? `${joined} ${w.text}` : w.text;
              minX0 = Math.min(minX0, w.bbox.x0);
              minY0 = Math.min(minY0, w.bbox.y0);
              maxX1 = Math.max(maxX1, w.bbox.x1);
              maxY1 = Math.max(maxY1, w.bbox.y1);
            }

            const joinedNorm = normalizeToken(joined);
            const joinedCompact = joinedNorm.replace(/\s+/g, '');

            if (joinedNorm.includes(targetNorm) || joinedCompact.includes(targetCompact)) {
              pushBox({ x0: minX0, y0: minY0, x1: maxX1, y1: maxY1 }, entry.token);
              foundWordMatch = true;
              break;
            }
          }
        }
      }

      // Safe fallback: if OCR punctuation splitting prevented a word-level match, mask the line bbox
      if (!foundWordMatch && line.bbox) {
        pushBox(line.bbox, entry.token);
      }
    }
  }

  return { boxes, matchedTokens };
}
