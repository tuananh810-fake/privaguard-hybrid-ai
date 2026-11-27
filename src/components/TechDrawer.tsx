import React, { memo } from 'react';
import { Cpu, KeyRound, Lock, RefreshCw, Shield, X } from 'lucide-react';
import { RemoteSettings } from '../firebase';
import { ModeKey, NanoAvailability } from '../services/hybridAI';
import { CategoryFilter, PiiCategory, RedactionResult } from '../services/piiVault';

export const MODE_OPTIONS: { key: ModeKey; label: string; desc: string }[] = [
  { key: 'PREFER_ON_DEVICE', label: 'Auto Hybrid (Recommended)', desc: 'On-Device Nano first → Cloud fallback' },
  { key: 'PREFER_IN_CLOUD', label: 'Fast Cloud', desc: 'Gemini Cloud → Nano fallback' },
  { key: 'ONLY_ON_DEVICE', label: 'Strict Offline', desc: '100% On-Device only (zero network)' },
  { key: 'ONLY_IN_CLOUD', label: 'Cloud Only', desc: 'Always Gemini Cloud' },
];

export const CATEGORY_LABELS: { key: PiiCategory; label: string }[] = [
  { key: 'SECRET', label: 'API Keys & JWT' },
  { key: 'CARD', label: 'Cards / IBAN' },
  { key: 'ID', label: 'SSN / CCCD' },
  { key: 'EMAIL', label: 'Emails' },
  { key: 'PHONE', label: 'Phones' },
  { key: 'IP', label: 'IPs' },
  { key: 'PERSON', label: 'Names' },
];

interface TechDrawerProps {
  mode: ModeKey;
  onModeChange: (mode: ModeKey) => void;
  nanoStatus: NanoAvailability;
  isLocalhost: boolean;
  onOpenDebugModal: () => void;
  remoteSettings: RemoteSettings;
  onRefreshRemoteConfig: () => void;
  categories: CategoryFilter;
  onToggleCategory: (key: PiiCategory) => void;
  customTerms: string;
  onCustomTermsChange: (val: string) => void;
  redaction: RedactionResult;
  onClose: () => void;
}

export const TechDrawer: React.FC<TechDrawerProps> = memo(
  ({
    mode,
    onModeChange,
    nanoStatus,
    isLocalhost,
    onOpenDebugModal,
    remoteSettings,
    onRefreshRemoteConfig,
    categories,
    onToggleCategory,
    customTerms,
    onCustomTermsChange,
    redaction,
    onClose,
  }) => {
    const scoreColor =
      redaction.privacyScore >= 70
        ? 'bg-rose-500'
        : redaction.privacyScore >= 35
          ? 'bg-amber-400'
          : 'bg-emerald-400';

    return (
      <section className="rounded-2xl border border-[#1E2733] bg-[#10151C] p-5 shadow-xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[#1E2733] pb-3">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-white">
              Privacy shield &amp; hybrid telemetry
            </h2>
            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-300 ring-1 ring-sky-500/30">
              Firebase AI Logic
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Close privacy and tech settings"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Inference Mode & Remote Config */}
          <div className="space-y-3 rounded-xl border border-[#1E2733] bg-[#0C1016] p-3.5">
            <label htmlFor="inference-mode" className="block text-xs font-semibold text-slate-200">
              Hybrid inference mode
            </label>
            <select
              id="inference-mode"
              value={mode}
              onChange={(e) => onModeChange(e.target.value as ModeKey)}
              className="w-full rounded-lg border border-[#1E2733] bg-[#10151C] px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500"
            >
              {MODE_OPTIONS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
              <span className="inline-flex items-center gap-1 rounded-md bg-[#10151C] px-2 py-1 text-slate-300 ring-1 ring-[#1E2733]">
                <Cpu className="h-3 w-3 text-amber-400" />
                Nano: {nanoStatus}
              </span>
              <button
                type="button"
                onClick={() => isLocalhost && onOpenDebugModal()}
                className={`inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-300 ring-1 ring-emerald-500/30 ${
                  isLocalhost ? 'cursor-pointer hover:bg-emerald-500/20' : 'cursor-default'
                }`}
              >
                <Lock className="h-3 w-3" />
                App Check enforced
                {isLocalhost && <KeyRound className="h-3 w-3 text-amber-300" />}
              </button>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="truncate">
                Model: <code className="text-emerald-300">{remoteSettings.cloudModel}</code>
                {' · '}
                Style: <code className="text-sky-300">{remoteSettings.systemPromptStyle}</code>
              </span>
              <button
                type="button"
                onClick={onRefreshRemoteConfig}
                title="Refresh Remote Config"
                className="shrink-0 rounded p-1 hover:bg-slate-800 hover:text-emerald-300"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Shield Rules & Custom Terms */}
          <div className="space-y-3 rounded-xl border border-[#1E2733] bg-[#0C1016] p-3.5">
            <div className="text-xs font-semibold text-slate-200">Auto-redaction rules</div>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORY_LABELS.map((cat) => {
                const active = categories[cat.key];
                return (
                  <button
                    type="button"
                    key={cat.key}
                    onClick={() => onToggleCategory(cat.key)}
                    className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                      active
                        ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40'
                        : 'bg-[#10151C] text-slate-500 ring-1 ring-[#1E2733] hover:text-slate-300'
                    }`}
                  >
                    {active ? '✓ ' : '+ '}
                    {cat.label}
                  </button>
                );
              })}
            </div>
            <div>
              <label htmlFor="custom-terms" className="mb-1 block text-[11px] text-slate-400">
                Extra private names or terms (comma-separated):
              </label>
              <input
                id="custom-terms"
                type="text"
                value={customTerms}
                onChange={(e) => onCustomTermsChange(e.target.value)}
                className="w-full rounded-lg border border-[#1E2733] bg-[#10151C] px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Local RAM Vault Preview */}
          <div className="flex flex-col rounded-xl border border-[#1E2733] bg-[#0C1016] p-3.5">
            <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-200">
              <span>Local RAM vault</span>
              <span className="font-mono text-[11px] text-emerald-400">
                {redaction.vault.length} shielded · {redaction.bytesShielded}B
              </span>
            </div>
            <div className="mb-2">
              <div className="mb-1 flex justify-between text-[10px] text-slate-400">
                <span>Raw exposure blocked</span>
                <span className="font-mono text-slate-300">{redaction.privacyScore}/100</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full transition-all ${scoreColor}`}
                  style={{ width: `${redaction.privacyScore}%` }}
                />
              </div>
            </div>
            <div className="max-h-28 space-y-1 overflow-y-auto font-mono text-[11px]">
              {redaction.vault.length === 0 ? (
                <p className="text-slate-500">No sensitive patterns detected.</p>
              ) : (
                redaction.vault.map((entry) => (
                  <div
                    key={entry.token}
                    className="flex items-center justify-between gap-2 rounded bg-[#10151C] px-2 py-1"
                  >
                    <span className="font-semibold text-emerald-400">{entry.token}</span>
                    <span className="truncate text-slate-400">{entry.original}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }
);

TechDrawer.displayName = 'TechDrawer';
