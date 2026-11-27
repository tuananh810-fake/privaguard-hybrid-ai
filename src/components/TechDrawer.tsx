import React, { memo } from 'react';
import { Cpu, KeyRound, Lock, RefreshCw, Shield, WifiOff, X } from 'lucide-react';
import { RemoteSettings } from '../firebase';
import { HybridResponse, ModeKey, NanoAvailability } from '../services/hybridAI';
import { CategoryFilter, PiiCategory, RedactionResult } from '../services/piiVault';

export const MODE_OPTIONS: { key: ModeKey; label: string; desc: string }[] = [
  { key: 'PREFER_ON_DEVICE', label: 'Auto Hybrid (Recommended)', desc: 'On-device Nano first, Cloud fallback' },
  { key: 'PREFER_IN_CLOUD', label: 'Fast Cloud', desc: 'Gemini Cloud with on-device fallback' },
  { key: 'ONLY_ON_DEVICE', label: 'Strict Offline', desc: '100% on-device only (zero network)' },
  { key: 'ONLY_IN_CLOUD', label: 'Cloud Only', desc: 'Always Gemini Cloud' },
];

export const CATEGORY_LABELS: { key: PiiCategory; label: string }[] = [
  { key: 'SECRET', label: 'API keys & JWT' },
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
  simulatedOffline: boolean;
  onToggleSimulatedOffline: () => void;
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
  lastResult: HybridResponse | null;
  onClose: () => void;
}

export const TechDrawer: React.FC<TechDrawerProps> = memo(
  ({
    mode,
    onModeChange,
    simulatedOffline,
    onToggleSimulatedOffline,
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
    lastResult,
    onClose,
  }) => {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Privacy and technical settings"
        className="fixed inset-0 z-40 flex justify-end bg-[var(--n-overlay)]"
        onClick={onClose}
      >
        <aside
          className="flex h-full w-full max-w-md flex-col overscroll-contain border-l border-[var(--n-border)] bg-[var(--n-bg)]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Slide-over Header */}
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--n-border)] px-5">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-[var(--n-accent)]" />
              <h2 className="text-[14px] font-semibold text-[var(--n-text)]">
                Privacy &amp; settings
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-[var(--n-muted)] transition hover:bg-[var(--n-hover)] hover:text-[var(--n-text)]"
              aria-label="Close settings"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Scrollable Settings Body */}
          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5 text-[13.5px]">
            {/* 1. Protected on this device (Local RAM Vault) */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--n-muted)]">
                  Protected on this device
                </h3>
                <span className="font-mono text-[12px] text-[var(--n-accent)]">
                  {redaction.vault.length} hidden · {redaction.bytesShielded}B
                </span>
              </div>

              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-[var(--n-border)] bg-[var(--n-surface)] p-2.5 font-mono text-[12px]">
                {redaction.vault.length === 0 ? (
                  <p className="font-sans text-[12.5px] text-[var(--n-muted)]">
                    No private items detected in the current document.
                  </p>
                ) : (
                  redaction.vault.map((entry) => (
                    <div
                      key={entry.token}
                      className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-[var(--n-hover)]"
                    >
                      <span className="font-medium text-[var(--n-accent)]">{entry.token}</span>
                      <span className="truncate text-[var(--n-muted)]">{entry.original}</span>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* 2. Auto-hide rules & custom words */}
            <section className="space-y-3 border-t border-[var(--n-border)] pt-5">
              <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--n-muted)]">
                What to hide automatically
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORY_LABELS.map((cat) => {
                  const active = categories[cat.key];
                  return (
                    <button
                      type="button"
                      key={cat.key}
                      onClick={() => onToggleCategory(cat.key)}
                      className={`rounded-md border px-2.5 py-1 text-[12.5px] font-medium transition ${
                        active
                          ? 'border-[var(--n-accent-border)] bg-[var(--n-accent-soft)] text-[var(--n-accent)]'
                          : 'border-[var(--n-border)] bg-[var(--n-bg)] text-[var(--n-muted)] hover:bg-[var(--n-hover)]'
                      }`}
                    >
                      {active ? '✓ ' : '+ '}
                      {cat.label}
                    </button>
                  );
                })}
              </div>

              <div>
                <label
                  htmlFor="custom-terms"
                  className="mb-1.5 block text-[12.5px] text-[var(--n-muted)]"
                >
                  Extra names or words to hide (comma-separated)
                </label>
                <input
                  id="custom-terms"
                  type="text"
                  value={customTerms}
                  onChange={(e) => onCustomTermsChange(e.target.value)}
                  className="w-full rounded-md border border-[var(--n-border)] bg-[var(--n-bg)] px-3 py-1.5 text-[13px] text-[var(--n-text)] focus:border-[var(--n-accent)] focus:outline-none"
                />
              </div>
            </section>

            {/* 3. Hybrid AI & Firebase Telemetry */}
            <section className="space-y-3 border-t border-[var(--n-border)] pt-5">
              <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--n-muted)]">
                Hybrid AI &amp; Firebase
              </h3>

              <div>
                <label
                  htmlFor="inference-mode"
                  className="mb-1.5 block text-[12.5px] text-[var(--n-muted)]"
                >
                  Inference mode
                </label>
                <select
                  id="inference-mode"
                  value={mode}
                  onChange={(e) => onModeChange(e.target.value as ModeKey)}
                  className="w-full rounded-md border border-[var(--n-border)] bg-[var(--n-bg)] px-3 py-1.5 text-[13px] text-[var(--n-text)] focus:border-[var(--n-accent)] focus:outline-none"
                >
                  {MODE_OPTIONS.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-[var(--n-border)] bg-[var(--n-surface)] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <WifiOff className="h-3.5 w-3.5 text-[var(--n-muted)]" />
                  <div>
                    <div className="text-[13px] font-medium text-[var(--n-text)]">
                      Simulate offline mode
                    </div>
                    <div className="text-[11.5px] text-[var(--n-muted)]">
                      Force on-device Gemini Nano without disconnecting Wi-Fi
                    </div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={simulatedOffline}
                  onChange={onToggleSimulatedOffline}
                  className="h-4 w-4 accent-[var(--n-accent)]"
                />
              </label>

              {/* Technical Telemetry Summary */}
              <div className="space-y-2 rounded-lg border border-[var(--n-border)] bg-[var(--n-surface)] p-3 text-[12px]">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-[var(--n-muted)]">
                    <Cpu className="h-3.5 w-3.5" />
                    Gemini Nano
                  </span>
                  <span className="font-mono text-[var(--n-text)]">{nanoStatus}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-[var(--n-muted)]">
                    <Lock className="h-3.5 w-3.5 text-[var(--n-accent)]" />
                    Firebase App Check
                  </span>
                  <button
                    type="button"
                    onClick={() => isLocalhost && onOpenDebugModal()}
                    className={`inline-flex items-center gap-1 font-mono text-[var(--n-accent)] ${
                      isLocalhost ? 'underline hover:opacity-80' : 'cursor-default'
                    }`}
                  >
                    Enforced
                    {isLocalhost && <KeyRound className="h-3 w-3" />}
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[var(--n-muted)]">Remote Config</span>
                  <div className="flex items-center gap-1.5">
                    <code className="text-[var(--n-text)]">{remoteSettings.cloudModel}</code>
                    <button
                      type="button"
                      onClick={onRefreshRemoteConfig}
                      title="Refresh Remote Config"
                      className="rounded p-0.5 text-[var(--n-muted)] hover:bg-[var(--n-hover)] hover:text-[var(--n-text)]"
                    >
                      <RefreshCw className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-[var(--n-border)] pt-2">
                  <span className="text-[var(--n-muted)]">Local shield speed</span>
                  <span className="font-mono text-[var(--n-text)]">
                    {redaction.shieldTimeMs < 1 ? '<1ms' : `${redaction.shieldTimeMs}ms`}
                  </span>
                </div>

                {lastResult && (
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--n-muted)]">Last AI TTFT / Total</span>
                    <span className="font-mono text-[var(--n-text)]">
                      {lastResult.ttftMs}ms / {lastResult.latencyMs}ms
                    </span>
                  </div>
                )}
              </div>
            </section>
          </div>
        </aside>
      </div>
    );
  }
);

TechDrawer.displayName = 'TechDrawer';
