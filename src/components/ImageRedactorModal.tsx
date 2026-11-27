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

    // Draw committed black redaction bars
    for (const box of boxes) {
      ctx.fillStyle = '#020617';
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.fillStyle = '#34d399';
      ctx.font = 'bold 11px monospace';
      if (Math.abs(box.w) > 58 && Math.abs(box.h) > 16) {
        const rx = box.w < 0 ? box.x + box.w : box.x;
        const ry = box.h < 0 ? box.y + box.h : box.y;
        ctx.fillText('[REDACTED]', rx + 6, ry + 14);
      }
    }

    // Draw active selection box
    if (draft) {
      ctx.fillStyle = 'rgba(16, 185, 129, 0.25)';
      ctx.fillRect(draft.x, draft.y, draft.w, draft.h);
      ctx.strokeStyle = '#34d399';
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
    const dataUrl = canvas.toDataURL('image/png');
    const base64Data = dataUrl.split(',')[1] || '';
    onApply(
      {
        ...image,
        mimeType: 'image/png',
        base64Data,
        previewUrl: dataUrl,
      },
      boxes.length
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            Local Image Privacy Redactor (Zero-Leak Canvas)
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white"
            aria-label="Close image redactor"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 text-xs text-slate-400">
          Click and drag directly on the image to paint permanent black <code className="text-emerald-300">[REDACTED]</code> bars over names, faces, IDs, or card numbers. Pixels are flattened locally in browser RAM before anything is sent to Hybrid AI.
        </p>

        <div className="flex max-h-[55vh] items-center justify-center overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-2">
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="max-w-full cursor-crosshair rounded shadow-md touch-none"
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setBoxes((prev) => prev.slice(0, -1))}
              disabled={boxes.length === 0}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-40"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Undo ({boxes.length})
            </button>
            <button
              onClick={() => setBoxes([])}
              disabled={boxes.length === 0}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:text-rose-300 disabled:opacity-40"
            >
              <Eraser className="h-3.5 w-3.5" />
              Clear Masks
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Apply Local Mask ({boxes.length})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
