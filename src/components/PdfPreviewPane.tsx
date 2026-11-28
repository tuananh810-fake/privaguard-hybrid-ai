import React, { useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import type { VaultEntry } from '../services/piiVault';
import { matchPdfTextItemsToVault, type PdfTextSpanItem } from '../services/fileRedactor';

interface PdfPreviewPaneProps {
  file: File;
  vault: VaultEntry[];
}

interface RenderedPage {
  pageNum: number;
  dataUrl: string;
  redactionCount: number;
}

const INITIAL_PREVIEW_PAGES = 4;

export const PdfPreviewPane: React.FC<PdfPreviewPaneProps> = ({ file, vault }) => {
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [maxToShow, setMaxToShow] = useState(INITIAL_PREVIEW_PAGES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const [pdfjsLib, workerMod] = await Promise.all([
          import('pdfjs-dist'),
          import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
        ]);
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerMod.default;

        const bytes = new Uint8Array(await file.arrayBuffer());
        const loadingTask = pdfjsLib.getDocument({ data: bytes });
        const pdf = await loadingTask.promise;
        if (cancelled) {
          await loadingTask.destroy();
          return;
        }

        setTotalPages(pdf.numPages);
        const count = Math.min(pdf.numPages, maxToShow);
        const rendered: RenderedPage[] = [];

        for (let p = 1; p <= count; p++) {
          if (cancelled) break;
          const page = await pdf.getPage(p);
          const viewport = page.getViewport({ scale: 1.25 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(viewport.width));
          canvas.height = Math.max(1, Math.round(viewport.height));
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;

          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          await page.render({ canvasContext: ctx, viewport, canvas }).promise;

          const content = await page.getTextContent();
          const items: PdfTextSpanItem[] = [];
          for (const rawItem of content.items) {
            if ('str' in rawItem && rawItem.str) {
              items.push({
                str: rawItem.str,
                transform: Array.isArray(rawItem.transform) ? rawItem.transform : [1, 0, 0, 1, 0, 0],
                width: typeof rawItem.width === 'number' ? rawItem.width : 0,
                height: typeof rawItem.height === 'number' ? rawItem.height : 0,
              });
            }
          }

          const boxes = matchPdfTextItemsToVault(items, vault);
          for (const box of boxes) {
            const p1 = viewport.convertToViewportPoint(box.x, box.y);
            const p2 = viewport.convertToViewportPoint(box.x + box.width, box.y + box.height);
            const rx = Math.max(0, Math.min(p1[0], p2[0]) - 2);
            const ry = Math.max(0, Math.min(p1[1], p2[1]) - 2);
            const rw = Math.max(18, Math.abs(p2[0] - p1[0]) + 4);
            const rh = Math.max(13, Math.abs(p2[1] - p1[1]) + 4);

            ctx.fillStyle = '#09090b';
            ctx.fillRect(rx, ry, rw, rh);
            ctx.fillStyle = '#ffffff';
            ctx.font = `600 ${Math.max(8, Math.min(11, Math.round(rh * 0.62)))}px ui-monospace, monospace`;
            ctx.textBaseline = 'middle';
            ctx.fillText(box.token, rx + 3, ry + rh / 2, Math.max(8, rw - 6));
          }

          rendered.push({
            pageNum: p,
            dataUrl: canvas.toDataURL('image/jpeg', 0.86),
            redactionCount: boxes.length,
          });
        }

        await loadingTask.destroy();
        if (!cancelled) {
          setPages(rendered);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to preview PDF pages.');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file, vault, maxToShow]);

  if (loading) {
    return (
      <div className="flex min-h-[220px] items-center justify-center gap-2 text-[13px] text-[var(--n-muted)]">
        <RefreshCw className="h-4 w-4 animate-spin text-[var(--n-accent)]" />
        Rendering original PDF pages locally…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-[var(--n-danger-border)] bg-[var(--n-danger-soft)] p-3 text-[12.5px] text-[var(--n-danger)]">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4 py-1 pb-4">
      <div className="flex items-center justify-between gap-2 text-[12px] text-[var(--n-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-[var(--n-accent)]" />
          Original PDF layout preview ({pages.length} of {totalPages} page{totalPages === 1 ? '' : 's'})
        </span>
        <span>Black boxes show exact PDF redactions on export</span>
      </div>

      {pages.map((p) => (
        <div
          key={p.pageNum}
          className="overflow-hidden rounded-lg border border-[var(--n-border)] bg-[var(--n-surface)]"
        >
          <div className="flex items-center justify-between border-b border-[var(--n-border)] px-3 py-1 text-[11.5px] text-[var(--n-muted)]">
            <span>Page {p.pageNum}</span>
            <span className="font-mono">
              {p.redactionCount > 0 ? `${p.redactionCount} redacted` : 'Clean page'}
            </span>
          </div>
          <img
            src={p.dataUrl}
            alt={`PDF page ${p.pageNum} visual preview`}
            className="block w-full bg-white"
          />
        </div>
      ))}

      {totalPages > pages.length && (
        <button
          type="button"
          onClick={() => setMaxToShow((n) => n + 4)}
          className="w-full rounded-md border border-[var(--n-border)] bg-[var(--n-surface)] py-2 text-[12.5px] font-medium text-[var(--n-text)] transition hover:bg-[var(--n-hover)]"
        >
          Load more pages ({totalPages - pages.length} remaining)
        </button>
      )}
    </div>
  );
};
