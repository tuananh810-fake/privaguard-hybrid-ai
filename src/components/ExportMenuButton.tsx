import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, RefreshCw } from 'lucide-react';

export interface ExportMenuOption {
  id: string;
  label: string;
  hint?: string;
  highlight?: boolean;
}

interface ExportMenuButtonProps {
  label: string;
  options: ExportMenuOption[];
  onSelect: (id: string) => void;
  disabled?: boolean;
  busy?: boolean;
  align?: 'left' | 'right';
  placement?: 'down' | 'up';
  size?: 'xs' | 'sm';
  title?: string;
}

export const ExportMenuButton: React.FC<ExportMenuButtonProps> = ({
  label,
  options,
  onSelect,
  disabled = false,
  busy = false,
  align = 'right',
  placement = 'down',
  size = 'sm',
  title,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const btnClasses =
    size === 'xs'
      ? 'inline-flex items-center gap-1 rounded-md border border-[var(--n-border)] bg-[var(--n-surface)] px-2 py-1 text-[11.5px] font-medium text-[var(--n-text)] transition hover:bg-[var(--n-hover)] disabled:cursor-not-allowed disabled:opacity-40'
      : 'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-[var(--n-muted)] transition hover:bg-[var(--n-hover)] hover:text-[var(--n-text)] disabled:cursor-not-allowed disabled:opacity-45';

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || busy}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        className={btnClasses}
      >
        {busy ? (
          <RefreshCw className={size === 'xs' ? 'h-3 w-3 animate-spin' : 'h-3.5 w-3.5 animate-spin'} />
        ) : (
          <Download className={size === 'xs' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        )}
        <span>{busy ? 'Exporting…' : label}</span>
        <ChevronDown className="h-3 w-3 opacity-70" />
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute z-30 w-64 rounded-lg border border-[var(--n-border)] bg-[var(--n-bg)] p-1 shadow-lg ${
            placement === 'up' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          } ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSelect(opt.id);
              }}
              className={`flex w-full flex-col items-start rounded-md px-2.5 py-1.5 text-left transition hover:bg-[var(--n-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--n-accent)] ${
                opt.highlight ? 'bg-[var(--n-accent-soft)]' : ''
              }`}
            >
              <span
                className={`text-[12.5px] font-medium ${
                  opt.highlight ? 'text-[var(--n-accent)]' : 'text-[var(--n-text)]'
                }`}
              >
                {opt.label}
              </span>
              {opt.hint && <span className="text-[11px] text-[var(--n-muted)]">{opt.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
