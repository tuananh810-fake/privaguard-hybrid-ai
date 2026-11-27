import React, { useEffect, useRef, useState } from 'react';
import { Eraser, ShieldCheck, Undo2, X } from 'lucide-react';
import { AttachedImage } from '../services/hybridAI';

interface MaskBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ImageRedactorModalProps {
  image: AttachedImage;
  onApply: (redactedImage: AttachedImage, maskCount: number) => void;
  onClose: () => void;
}

export const ImageRedactorModal: React.FC<ImageRedactorModalProps> = ({
  image,
  onApply,
  onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [boxes, setBoxes] = useState<MaskBox[]>([]);
  const [draft, setDraft] = useState<MaskBox | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

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
            className="rounded-md p-1 text-[var(--n-muted)] transition hover:bg-[var(--n-hover)] hover:text-[var(--n-text)]"
            aria-label="Close image redactor"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 text-[13px] text-[var(--n-muted)]">
          Drag over names, faces, IDs, or card numbers to cover them before analysis. Everything is flattened locally on your device.
        </p>

        <div className="flex max-h-[55vh] items-center justify-center overflow-auto rounded-lg border border-[var(--n-border)] bg-[var(--n-surface)] p-2">
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="max-w-full cursor-crosshair rounded touch-none"
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setBoxes((prev) => prev.slice(0, -1))}
              disabled={boxes.length === 0}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--n-border)] bg-[var(--n-bg)] px-3 py-1.5 text-[13px] text-[var(--n-text)] transition hover:bg-[var(--n-hover)] disabled:opacity-40"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Undo ({boxes.length})
            </button>
            <button
              type="button"
              onClick={() => setBoxes([])}
              disabled={boxes.length === 0}
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
              className="rounded-md px-3 py-1.5 text-[13px] text-[var(--n-muted)] transition hover:bg-[var(--n-hover)] hover:text-[var(--n-text)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--n-accent)] px-4 py-1.5 text-[13px] font-medium text-[var(--n-accent-fg)] transition hover:bg-[var(--n-accent-hover)]"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Apply mask ({boxes.length})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
