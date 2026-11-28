import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, PenSquare, RefreshCw, ShieldCheck, X } from 'lucide-react';
import type { VaultEntry } from '../services/piiVault';
import {
  matchPdfTextItemsToVault,
  type ManualPdfBox,
  type PdfTextSpanItem,
} from '../services/fileRedactor';

export type PreviewVisualMode = 'leaks' | 'redacted';

interface PdfPreviewPaneProps {
  file: File;
  vault: VaultEntry[];
  visualMode: PreviewVisualMode;
  manualBoxes: ManualPdfBox[];
  onAddManualBox: (box: ManualPdfBox) => void;
  onRemoveManualBox: (id: string) => void;
  onWhitelistValue?: (value: string) => void;
}

interface OverlayBox {
  id: string;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  token: string;
  original: string;
  source: string;
  category: string;
}

interface RenderedBasePage {
  pageNum: number;
  dataUrl: string;
  width: number;
  height: number;
  items: PdfTextSpanItem[];
  /** Converts PDF-space point (x, y) to normalized 0..100 percent coords on the rendered image */
  toPercentRect: (x: number, y: number, w: number, h: number) => {
    xPct: number;
    yPct: number;
    wPct: number;
    hPct: number;
  };
}

const INITIAL_PREVIEW_PAGES = 4;

export const PdfPreviewPane: React.FC<PdfPreviewPaneProps> = ({
  file,
  vault,
  visualMode,
  manualBoxes,
  onAddManualBox,
  onRemoveManualBox,
  onWhitelistValue,
}) => {
  const [basePages, setBasePages] = useState<RenderedBasePage[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [maxToShow, setMaxToShow] = useState(INITIAL_PREVIEW_PAGES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [selectedLeak, setSelectedLeak] = useState<{
    pageNum: number;
    token: string;
    original: string;
    source: string;
    category: string;
  } | null>(null);

  const [draftBox, setDraftBox] = useState<{
    pageNum: number;
    startX: number;
    startY: number;
    curX: number;
    curY: number;
  } | null>(null);

  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedLeak(null);

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
        const rendered: RenderedBasePage[] = [];

        for (let p = 1; p <= count; p++) {
          if (cancelled) break;
          const page = await pdf.getPage(p);
          const viewport = page.getViewport({ scale: 1.35 });
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

          const vpW = canvas.width;
          const vpH = canvas.height;
          const toPercentRect = (x: number, y: number, w: number, h: number) => {
            const p1 = viewport.convertToViewportPoint(x, y);
            const p2 = viewport.convertToViewportPoint(x + w, y + h);
            const rx = Math.max(0, Math.min(p1[0], p2[0]) - 2);
            const ry = Math.max(0, Math.min(p1[1], p2[1]) - 2);
            const rw = Math.max(16, Math.abs(p2[0] - p1[0]) + 4);
            const rh = Math.max(13, Math.abs(p2[1] - p1[1]) + 4);
            return {
              xPct: (rx / vpW) * 100,
              yPct: (ry / vpH) * 100,
              wPct: Math.min(100 - (rx / vpW) * 100, (rw / vpW) * 100),
              hPct: Math.min(100 - (ry / vpH) * 100, (rh / vpH) * 100),
            };
          };

          rendered.push({
            pageNum: p,
            dataUrl: canvas.toDataURL('image/jpeg', 0.88),
            width: vpW,
            height: vpH,
            items,
            toPercentRect,
          });
        }

        await loadingTask.destroy();
        if (!cancelled) {
          setBasePages(rendered);
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
  }, [file, maxToShow]);

  const vaultByToken = useMemo(() => {
    const map = new Map<string, VaultEntry>();
    for (const v of vault) map.set(v.token, v);
    return map;
  }, [vault]);

  const pageOverlays = useMemo(() => {
    const out = new Map<number, OverlayBox[]>();
    for (const page of basePages) {
      const matched = matchPdfTextItemsToVault(page.items, vault);
      const boxes: OverlayBox[] = matched.map((box, idx) => {
        const rect = page.toPercentRect(box.x, box.y, box.width, box.height);
        const entry = vaultByToken.get(box.token);
        return {
          id: `${page.pageNum}-${box.token}-${idx}`,
          ...rect,
          token: box.token,
          original: entry?.original ?? '',
          source: entry?.source ?? 'regex',
          category: entry?.category ?? 'PII',
        };
      });
      out.set(page.pageNum, boxes);
    }
    return out;
  }, [basePages, vault, vaultByToken]);

  function getRelativePoint(e: React.PointerEvent<HTMLDivElement>): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
    return { x, y };
  }

  function handlePointerDown(pageNum: number, e: React.PointerEvent<HTMLDivElement>) {
    if (!drawMode || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getRelativePoint(e);
    setDraftBox({ pageNum, startX: pt.x, startY: pt.y, curX: pt.x, curY: pt.y });
  }

  function handlePointerMove(pageNum: number, e: React.PointerEvent<HTMLDivElement>) {
    if (!draftBox || draftBox.pageNum !== pageNum) return;
    const pt = getRelativePoint(e);
    setDraftBox((prev) => (prev ? { ...prev, curX: pt.x, curY: pt.y } : null));
  }

  function handlePointerUp(pageNum: number) {
    if (!draftBox || draftBox.pageNum !== pageNum) return;
    const xRatio = Math.min(draftBox.startX, draftBox.curX);
    const yRatio = Math.min(draftBox.startY, draftBox.curY);
    const wRatio = Math.abs(draftBox.curX - draftBox.startX);
    const hRatio = Math.abs(draftBox.curY - draftBox.startY);
    setDraftBox(null);
    if (wRatio >= 0.02 && hRatio >= 0.012) {
      onAddManualBox({
        id: `mb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        pageNum,
        xRatio,
        yRatio,
        wRatio,
        hRatio,
        label: '[MANUAL]',
      });
    }
  }

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
    <div className="space-y-3 py-1 pb-4">
      {/* Page jump strip + Draw manual box toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
        <div className="flex flex-wrap items-center gap-1">
          {basePages.map((p) => {
            const autoCount = pageOverlays.get(p.pageNum)?.length ?? 0;
            const manualCount = manualBoxes.filter((b) => b.pageNum === p.pageNum).length;
            const count = autoCount + manualCount;
            return (
              <button
                key={p.pageNum}
                type="button"
                onClick={() =>
                  pageRefs.current[p.pageNum]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
                className={`rounded px-2 py-0.5 font-mono transition ${
                  count > 0
                    ? 'border border-[var(--n-danger-border)] bg-[var(--n-danger-soft)] text-[var(--n-danger)] hover:opacity-90'
                    : 'border border-[var(--n-border)] bg-[var(--n-surface)] text-[var(--n-muted)] hover:text-[var(--n-text)]'
                }`}
              >
                P{p.pageNum} {count > 0 ? `· ${count}` : '· ok'}
              </button>
            );
          })}
          {totalPages > basePages.length && (
            <span className="px-1 text-[var(--n-muted)]">
              +{totalPages - basePages.length} more
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setDrawMode((v) => !v)}
          title="Drag directly on any PDF page to cover signatures, stamps, or scanned PII"
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11.5px] font-medium transition ${
            drawMode
              ? 'border-[var(--n-accent)] bg-[var(--n-accent-soft)] text-[var(--n-accent)]'
              : 'border-[var(--n-border)] bg-[var(--n-surface)] text-[var(--n-text)] hover:bg-[var(--n-hover)]'
          }`}
        >
          <PenSquare className="h-3 w-3" />
          {drawMode ? 'Drawing mask (drag on page)' : 'Draw mask'}
        </button>
      </div>

      {/* Selected Leak Popover Bar */}
      {selectedLeak && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--n-border)] bg-[var(--n-surface)] px-2.5 py-1.5 text-[12px]">
          <div className="min-w-0">
            <span className="font-mono font-semibold text-[var(--n-danger)]">
              {selectedLeak.token}
            </span>{' '}
            <span className="text-[var(--n-muted)]">
              ({selectedLeak.category} · {selectedLeak.source} · Page {selectedLeak.pageNum}):
            </span>{' '}
            <code className="break-all font-mono text-[var(--n-text)]">{selectedLeak.original}</code>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {onWhitelistValue && selectedLeak.original && (
              <button
                type="button"
                onClick={() => {
                  onWhitelistValue(selectedLeak.original);
                  setSelectedLeak(null);
                }}
                className="inline-flex items-center gap-1 rounded border border-[var(--n-border)] bg-[var(--n-bg)] px-2 py-0.5 text-[11.5px] font-medium text-[var(--n-text)] transition hover:bg-[var(--n-hover)]"
              >
                <Eye className="h-3 w-3 text-[var(--n-accent)]" />
                Keep visible
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedLeak(null)}
              aria-label="Close leak inspector"
              className="rounded p-0.5 text-[var(--n-muted)] hover:bg-[var(--n-hover)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {basePages.map((p) => {
        const overlays = pageOverlays.get(p.pageNum) ?? [];
        const pageManual = manualBoxes.filter((b) => b.pageNum === p.pageNum);
        const totalMasks = overlays.length + pageManual.length;

        return (
          <div
            key={p.pageNum}
            ref={(el) => {
              pageRefs.current[p.pageNum] = el;
            }}
            className="overflow-hidden rounded-lg border border-[var(--n-border)] bg-[var(--n-surface)]"
          >
            <div className="flex items-center justify-between border-b border-[var(--n-border)] px-3 py-1 text-[11.5px] text-[var(--n-muted)]">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3 w-3 text-[var(--n-accent)]" />
                Page {p.pageNum} of {totalPages}
              </span>
              <span className="font-mono">
                {totalMasks > 0
                  ? visualMode === 'leaks'
                    ? `${totalMasks} leak${totalMasks === 1 ? '' : 's'} highlighted`
                    : `${totalMasks} redaction${totalMasks === 1 ? '' : 's'} on export`
                  : 'Clean page'}
              </span>
            </div>

            <div
              onPointerDown={(e) => handlePointerDown(p.pageNum, e)}
              onPointerMove={(e) => handlePointerMove(p.pageNum, e)}
              onPointerUp={() => handlePointerUp(p.pageNum)}
              className={`relative select-none bg-white ${drawMode ? 'cursor-crosshair' : ''}`}
            >
              <img
                src={p.dataUrl}
                alt={`Original PDF page ${p.pageNum}`}
                draggable={false}
                className="block w-full"
              />

              {/* Auto-detected vault boxes (Regex + Nano + Manual text) */}
              {overlays.map((box) => (
                <button
                  key={box.id}
                  type="button"
                  disabled={drawMode}
                  onClick={() =>
                    setSelectedLeak({
                      pageNum: p.pageNum,
                      token: box.token,
                      original: box.original,
                      source: box.source,
                      category: box.category,
                    })
                  }
                  title={
                    visualMode === 'leaks'
                      ? `${box.token} (${box.source}): click to inspect or whitelist`
                      : `${box.token} will be permanently burned into exported PDF`
                  }
                  style={{
                    left: `${box.xPct}%`,
                    top: `${box.yPct}%`,
                    width: `${box.wPct}%`,
                    height: `${box.hPct}%`,
                  }}
                  className={`absolute flex items-center overflow-hidden rounded-[2px] text-left transition ${
                    visualMode === 'leaks'
                      ? 'border border-red-500/90 bg-red-500/20 hover:bg-red-500/30'
                      : 'border border-zinc-950 bg-zinc-950 text-white'
                  }`}
                >
                  {visualMode === 'redacted' && (
                    <span className="truncate px-1 font-mono text-[9px] font-semibold leading-none text-white">
                      {box.token}
                    </span>
                  )}
                </button>
              ))}

              {/* User-drawn manual PDF boxes */}
              {pageManual.map((mb) => (
                <div
                  key={mb.id}
                  style={{
                    left: `${mb.xRatio * 100}%`,
                    top: `${mb.yRatio * 100}%`,
                    width: `${mb.wRatio * 100}%`,
                    height: `${mb.hRatio * 100}%`,
                  }}
                  className={`group absolute flex items-center justify-between rounded-[2px] px-1 ${
                    visualMode === 'leaks'
                      ? 'border-2 border-amber-500 bg-amber-500/25'
                      : 'border border-zinc-950 bg-zinc-950 text-white'
                  }`}
                >
                  <span
                    className={`truncate font-mono text-[9px] font-semibold leading-none ${
                      visualMode === 'leaks' ? 'text-amber-950' : 'text-white'
                    }`}
                  >
                    {mb.label || '[MANUAL]'}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveManualBox(mb.id);
                    }}
                    aria-label="Remove manual redaction box"
                    className="rounded bg-black/70 p-0.5 text-white opacity-80 transition hover:bg-red-600 hover:opacity-100"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}

              {/* Live drag rectangle */}
              {draftBox && draftBox.pageNum === p.pageNum && (
                <div
                  style={{
                    left: `${Math.min(draftBox.startX, draftBox.curX) * 100}%`,
                    top: `${Math.min(draftBox.startY, draftBox.curY) * 100}%`,
                    width: `${Math.abs(draftBox.curX - draftBox.startX) * 100}%`,
                    height: `${Math.abs(draftBox.curY - draftBox.startY) * 100}%`,
                  }}
                  className="pointer-events-none absolute border-2 border-dashed border-[var(--n-accent)] bg-[var(--n-accent)]/20"
                />
              )}
            </div>
          </div>
        );
      })}

      {totalPages > basePages.length && (
        <button
          type="button"
          onClick={() => setMaxToShow((n) => n + 4)}
          className="w-full rounded-md border border-[var(--n-border)] bg-[var(--n-surface)] py-2 text-[12.5px] font-medium text-[var(--n-text)] transition hover:bg-[var(--n-hover)]"
        >
          Load more pages ({totalPages - basePages.length} remaining)
        </button>
      )}
    </div>
  );
};
