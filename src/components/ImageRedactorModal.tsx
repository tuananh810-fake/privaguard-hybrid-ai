import React, { useEffect, useRef, useState } from 'react';
import { Eraser, RefreshCw, ScanSearch, ShieldCheck, Undo2, X } from 'lucide-react';
import { AttachedImage } from '../services/hybridAI';
import { CategoryFilter, DEFAULT_CATEGORY_FILTER } from '../services/piiVault';
import { CanvasMaskBox, matchPiiBoxesFromOcrLines, OcrLine } from '../services/ocrPiiMatcher';

interface ImageRedactorModalProps {
  image: AttachedImage;
  extraTerms?: string[];
  categories?: CategoryFilter;
  onApply: (redactedImage: AttachedImage, maskCount: number) => void;
  onClose: () => void;
}

/**
 * Extracts normalized OCR lines (with word bounding boxes) from Tesseract.js v5/v6 output.
 */
function extractOcrLines(data: unknown): OcrLine[] {
  if (!data || typeof data !== 'object') return [];
  const d = data as {
    lines?: OcrLine[];
    blocks?: Array<{ paragraphs?: Array<{ lines?: OcrLine[] }> }>;
  };

  if (Array.isArray(d.lines) && d.lines.length > 0) {
    return d.lines;
  }

  const collected: OcrLine[] = [];
  if (Array.isArray(d.blocks)) {
    for (const block of d.blocks) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          collected.push(line);
        }
      }
    }
  }
  return collected;
}

export const ImageRedactorModal: React.FC<ImageRedactorModalProps> = ({
  image,
  extraTerms = [],
  categories = DEFAULT_CATEGORY_FILTER,
  onApply,
  onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [boxes, setBoxes] = useState<CanvasMaskBox[]>([]);
  const [draft, setDraft] = useState<CanvasMaskBox | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanNotice, setScanNotice] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !scanning) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, scanning]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImgLoaded(true);
    };
    img.src = image.previewUrl;
  }, [image.previewUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imgLoaded) return;

    const maxW = 720;
    const scale = img.naturalWidth > maxW ? maxW / img.naturalWidth : 1;
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    for (const box of boxes) {
      ctx.fillStyle = '#191919';
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.strokeStyle = '#0F7B6C';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '500 11px monospace';
      if (Math.abs(box.w) > 58 && Math.abs(box.h) > 16) {
        const rx = box.w < 0 ? box.x + box.w : box.x;
        const ry = box.h < 0 ? box.y + box.h : box.y;
        ctx.fillText('[HIDDEN]', rx + 6, ry + 14);
      }
    }

    if (draft) {
      ctx.fillStyle = 'rgba(15, 123, 108, 0.22)';
      ctx.fillRect(draft.x, draft.y, draft.w, draft.h);
      ctx.strokeStyle = '#0F7B6C';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(draft.x, draft.y, draft.w, draft.h);
      ctx.setLineDash([]);
    }
  }, [imgLoaded, boxes, draft]);

  function getCanvasPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (scanning) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getCanvasPoint(e);
    setDraft({ x: pt.x, y: pt.y, w: 0, h: 0 });
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!draft) return;
    const pt = getCanvasPoint(e);
    setDraft({ ...draft, w: pt.x - draft.x, h: pt.y - draft.y });
  }

  function handlePointerUp() {
    if (!draft) return;
    if (Math.abs(draft.w) > 6 && Math.abs(draft.h) > 6) {
      setBoxes((prev) => [...prev, draft]);
    }
    setDraft(null);
  }

  async function handleAutoDetectPii() {
    const canvas = canvasRef.current;
    if (!canvas || scanning) return;

    setScanning(true);
    setScanProgress(5);
    setScanNotice(null);

    let worker: Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>> | null = null;

    try {
      const tesseract = await import('tesseract.js');
      const createdWorker = await tesseract.createWorker('eng+vie', 1, {
        logger: (m: { status?: string; progress?: number }) => {
          if (typeof m.progress === 'number') {
            setScanProgress(Math.max(5, Math.min(99, Math.round(m.progress * 100))));
          }
        },
      });
      worker = createdWorker;

      const result = await createdWorker.recognize(canvas, {}, { blocks: true });
      const lines = extractOcrLines(result.data);
      const matched = matchPiiBoxesFromOcrLines(lines, extraTerms, categories, {
        padding: 4,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
      });

      if (matched.boxes.length > 0) {
        setBoxes((prev) => [...prev, ...matched.boxes]);
        setScanNotice(
          `Auto-masked ${matched.boxes.length} sensitive area${matched.boxes.length === 1 ? '' : 's'} — you can still undo or draw more.`
        );
      } else {
        setScanNotice(
          'No text PII detected automatically — drag directly on the image to mask manually.'
        );
      }
    } catch (err) {
      setScanNotice(
        `OCR scan could not complete (${err instanceof Error ? err.message : 'unknown error'}). You can still drag to mask manually.`
      );
    } finally {
      if (worker) {
        await worker.terminate().catch(() => {});
      }
      setScanning(false);
      setScanProgress(0);
    }
  }

  function handleApply() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let mimeType = 'image/webp';
    let dataUrl = canvas.toDataURL('image/webp', 0.86);
    if (!dataUrl.startsWith('data:image/webp')) {
      mimeType = 'image/jpeg';
      dataUrl = canvas.toDataURL('image/jpeg', 0.86);
    }
    const base64Data = dataUrl.split(',')[1] || '';
    onApply(
      {
        ...image,
        mimeType,
        base64Data,
        previewUrl: dataUrl,
      },
      boxes.length
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Hide private areas on image"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--n-overlay)] p-4"
    >
      <div className="w-full max-w-3xl rounded-xl border border-[var(--n-border)] bg-[var(--n-bg)] p-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-[var(--n-text)]">
            <ShieldCheck className="h-4 w-4 text-[var(--n-accent)]" />
            Hide private areas on image
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={scanning}
            className="rounded-md p-1 text-[var(--n-muted)] transition hover:bg-[var(--n-hover)] hover:text-[var(--n-text)] disabled:opacity-40"
            aria-label="Close image redactor"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 text-[13px] text-[var(--n-muted)]">
          Click <strong>Auto-detect PII</strong> to scan locally with on-device OCR, or drag over names, faces, IDs, or cards. Everything is flattened in browser RAM.
        </p>

        <div className="flex max-h-[54vh] items-center justify-center overflow-auto rounded-lg border border-[var(--n-border)] bg-[var(--n-surface)] p-2">
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="max-w-full cursor-crosshair rounded touch-none"
          />
        </div>

        {scanNotice && (
          <p
            aria-live="polite"
            className="mt-2.5 text-[12.5px] text-[var(--n-accent)]"
          >
            {scanNotice}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleAutoDetectPii}
              disabled={!imgLoaded || scanning}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--n-accent-border)] bg-[var(--n-accent-soft)] px-3 py-1.5 text-[13px] font-medium text-[var(--n-accent)] transition hover:opacity-90 disabled:opacity-50"
            >
              {scanning ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span className="tabular-nums">Scanning… {scanProgress}%</span>
                </>
              ) : (
                <>
                  <ScanSearch className="h-3.5 w-3.5" />
                  Auto-detect PII
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setBoxes((prev) => prev.slice(0, -1))}
              disabled={boxes.length === 0 || scanning}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--n-border)] bg-[var(--n-bg)] px-3 py-1.5 text-[13px] text-[var(--n-text)] transition hover:bg-[var(--n-hover)] disabled:opacity-40"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Undo ({boxes.length})
            </button>
            <button
              type="button"
              onClick={() => setBoxes([])}
              disabled={boxes.length === 0 || scanning}
              className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[13px] text-[var(--n-muted)] transition hover:bg-[var(--n-hover)] hover:text-[var(--n-danger)] disabled:opacity-40"
            >
              <Eraser className="h-3.5 w-3.5" />
              Clear
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={scanning}
              className="rounded-md px-3 py-1.5 text-[13px] text-[var(--n-muted)] transition hover:bg-[var(--n-hover)] hover:text-[var(--n-text)] disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={scanning || boxes.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--n-accent)] px-4 py-1.5 text-[13px] font-medium text-[var(--n-accent-fg)] transition hover:bg-[var(--n-accent-hover)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Apply mask ({boxes.length})
            </button>
          </div>
        </div>
        <p
          title="Mô hình OCR chỉ tải 1 lần; ảnh của bạn không bao giờ rời khỏi thiết bị"
          className="mt-2 text-[11.5px] text-[var(--n-muted)]"
        >
          OCR model downloads once · your image never leaves this device
        </p>
      </div>
    </div>
  );
};
