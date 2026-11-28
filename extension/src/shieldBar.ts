import type { CategoryFilter, PiiCategory } from '../../src/services/piiVault';
import type { ContextGuardAnalysis } from '../../src/services/sensitivityEngine';
import { getExt, type PendingFileIntercept } from './fileInterceptor';

const WORKSPACE_URL = 'https://buildhybridai-tuananh.web.app';

const CATEGORY_LABELS: Partial<Record<PiiCategory, string>> = {
  SECRET: 'Secrets',
  CARD: 'Cards',
  ID: 'IDs',
  EMAIL: 'Emails',
  PHONE: 'Phones',
  IP: 'IPs',
  PERSON: 'Names',
  ORG: 'Orgs',
  ADDRESS: 'Addresses',
  LOCATION: 'Locations',
  CUSTOM: 'Custom',
};

export interface ShieldBarViewModel {
  enabled: boolean;
  pendingFile: PendingFileIntercept | null;
  lastAnalysis: ContextGuardAnalysis | null;
  activeCategories: CategoryFilter;
  nanoAvailable: boolean;
  nanoScanning: boolean;
  ramVaultSize: number;
  canUndoMask: boolean;
  hasReplyTokens: boolean;
  repliesRevealed: boolean;
  dismissedSignature: string;
}

export interface ShieldBarCallbacks {
  onCancelFile: () => void;
  onSendOriginalFile: () => void;
  onSendSanitizedFile: () => void;
  onDownloadSanitizedFile: () => void;
  onUndoMask: () => void;
  onToggleRevealReplies: () => void;
  onClosePostMask: () => void;
  onToggleCategory: (cat: PiiCategory) => void;
  onMaskEditor: (strictAll: boolean) => void;
  onTriggerNanoScan: () => void;
  onDismissAnalysis: (sig: string) => void;
}

let shadowHost: HTMLDivElement | null = null;
let barContainer: HTMLDivElement | null = null;

function ensureShadowUi(): HTMLDivElement {
  if (barContainer && shadowHost?.isConnected) return barContainer;

  shadowHost = document.createElement('div');
  shadowHost.id = 'privaguard-ext-root';
  shadowHost.style.position = 'fixed';
  shadowHost.style.right = '18px';
  shadowHost.style.bottom = '18px';
  shadowHost.style.zIndex = '2147483647';
  shadowHost.style.maxWidth = '450px';
  shadowHost.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    .pg-bar {
      background: #ffffff; color: #1f1f1c; border: 1px solid #d9d9d2; border-radius: 12px;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.14); padding: 10px 12px; font-size: 12.5px;
      line-height: 1.45; display: flex; flex-direction: column; gap: 8px;
    }
    .pg-bar.edu { border-color: #93c5fd; background: #f8fbff; }
    .pg-bar.mixed, .pg-bar.sens { border-color: #f59e0b; background: #fffdf7; }
    .pg-bar.done { border-color: #10b981; background: #f2fdf8; }
    .pg-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .pg-title { font-weight: 600; font-size: 12.5px; color: #111827; }
    .pg-sub { font-size: 11.5px; color: #52525b; margin-top: 2px; }
    .pg-badge {
      display: inline-block; font-size: 10.5px; font-weight: 600; padding: 1px 6px;
      border-radius: 5px; background: #e0f2fe; color: #0369a1; margin-left: 6px; vertical-align: middle;
    }
    .pg-chips { display: flex; flex-wrap: wrap; gap: 5px; }
    .pg-chip {
      border: 1px solid #d4d4d8; background: #f4f4f5; color: #27272a; border-radius: 999px;
      padding: 2px 8px; font-size: 11px; cursor: pointer; font-weight: 500;
    }
    .pg-chip.on { background: #ecfdf5; border-color: #0f766e; color: #0f766e; }
    .pg-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .pg-btn {
      border-radius: 7px; border: 1px solid #d4d4d8; background: #ffffff; color: #1f1f1c;
      font-size: 11.5px; font-weight: 600; padding: 5px 10px; cursor: pointer; text-decoration: none;
    }
    .pg-btn:hover { background: #f4f4f5; }
    .pg-btn.primary { background: #0f766e; border-color: #0f766e; color: #ffffff; }
    .pg-btn.primary:hover { background: #0d5e58; }
    .pg-btn.ghost { border-color: transparent; background: transparent; color: #6b7280; font-weight: 500; padding: 4px 6px; }
    .pg-btn.ghost:hover { color: #111827; background: #f4f4f5; }
    .pg-btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .pg-close { border: none; background: transparent; color: #71717a; cursor: pointer; font-size: 14px; line-height: 1; padding: 2px 4px; }
    .pg-close:hover { color: #111827; }
    @media (prefers-color-scheme: dark) {
      .pg-bar { background: #1e1e1c; color: #f4f4f0; border-color: #3a3a35; }
      .pg-bar.edu { background: #172130; border-color: #2563eb; }
      .pg-bar.mixed, .pg-bar.sens { background: #262116; border-color: #d97706; }
      .pg-bar.done { background: #132822; border-color: #059669; }
      .pg-title { color: #f8fafc; }
      .pg-sub { color: #cbd5e1; }
      .pg-badge { background: #1e3a5f; color: #93c5fd; }
      .pg-chip { background: #2c2c28; border-color: #44443f; color: #e4e4e7; }
      .pg-chip.on { background: #134e4a; border-color: #2dd4bf; color: #99f6e4; }
      .pg-btn { background: #2a2a26; border-color: #44443f; color: #f4f4f0; }
      .pg-btn:hover { background: #353530; }
      .pg-btn.ghost { background: transparent; color: #a1a1aa; }
      .pg-btn.ghost:hover { color: #ffffff; background: #2a2a26; }
    }
  `;

  barContainer = document.createElement('div');
  shadowRoot.appendChild(style);
  shadowRoot.appendChild(barContainer);
  document.documentElement.appendChild(shadowHost);
  return barContainer;
}

function makeButton(label: string, className: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  btn.disabled = disabled;
  btn.addEventListener('click', onClick);
  return btn;
}

export function clearShieldBar(): void {
  if (barContainer) barContainer.textContent = '';
}

function renderFileCard(root: HTMLDivElement, pending: PendingFileIntercept, cb: ShieldBarCallbacks): void {
  const card = document.createElement('div');
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');

  const extLabel = (getExt(pending.originalFile.name) || 'FILE').toUpperCase();
  const head = document.createElement('div');
  head.className = 'pg-head';
  const titleWrap = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'pg-title';
  const badge = document.createElement('span');
  badge.className = 'pg-badge';
  badge.textContent = `.${extLabel}`;
  const closeBtn = makeButton('×', 'pg-close', cb.onCancelFile);

  if (pending.processing) {
    card.className = 'pg-bar edu';
    title.textContent = `PrivaGuard · Scanning ${pending.originalFile.name} locally…`;
    title.appendChild(badge);
    const sub = document.createElement('div');
    sub.className = 'pg-sub';
    sub.textContent = 'Upload paused (0 B sent). Running format-preserving shield in RAM…';
    titleWrap.append(title, sub);
    head.append(titleWrap, closeBtn);
    card.appendChild(head);
    root.appendChild(card);
    return;
  }

  if (pending.isImage) {
    card.className = 'pg-bar sens';
    title.textContent = `PrivaGuard · Image upload paused (${pending.originalFile.name})`;
    title.appendChild(badge);
    const sub = document.createElement('div');
    sub.className = 'pg-sub';
    sub.textContent =
      'Images may contain visible IDs, cards, or phone numbers. Auto-redact with local OCR in PrivaGuard Workspace first, or continue.';
    titleWrap.append(title, sub);
    head.append(titleWrap, closeBtn);

    const actions = document.createElement('div');
    actions.className = 'pg-actions';
    const link = document.createElement('a');
    link.className = 'pg-btn primary';
    link.href = WORKSPACE_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Auto-OCR redact in Workspace →';
    actions.appendChild(link);
    actions.appendChild(makeButton('Send original anyway', 'pg-btn', cb.onSendOriginalFile));
    actions.appendChild(makeButton('Cancel', 'pg-btn ghost', cb.onCancelFile));
    card.append(head, actions);
    root.appendChild(card);
    return;
  }

  if (pending.errorMsg || !pending.analysis || !pending.sanitizedFile) {
    card.className = 'pg-bar sens';
    title.textContent = `PrivaGuard · Could not sanitize ${pending.originalFile.name}`;
    title.appendChild(badge);
    const sub = document.createElement('div');
    sub.className = 'pg-sub';
    sub.textContent = pending.errorMsg || 'Unexpected local redaction error.';
    titleWrap.append(title, sub);
    head.append(titleWrap, closeBtn);
    const actions = document.createElement('div');
    actions.className = 'pg-actions';
    actions.appendChild(makeButton('Send original anyway', 'pg-btn', cb.onSendOriginalFile));
    actions.appendChild(makeButton('Cancel', 'pg-btn ghost', cb.onCancelFile));
    card.append(head, actions);
    root.appendChild(card);
    return;
  }

  const { contextKind, maskedByDefault, summaryLabel } = pending.analysis;
  const formatNote = pending.formatPreserved
    ? pending.metadataStripped
      ? 'Original layout preserved · hidden metadata stripped'
      : 'Original format preserved'
    : 'Sanitized safely';

  if (contextKind === 'CLEAN' || contextKind === 'EDUCATIONAL_SYNTHETIC') {
    card.className = 'pg-bar edu';
    title.textContent =
      contextKind === 'CLEAN'
        ? `PrivaGuard · ${pending.originalFile.name} looks clean`
        : `PrivaGuard · Homework/sample file (${pending.originalFile.name})`;
    title.appendChild(badge);
    const sub = document.createElement('div');
    sub.className = 'pg-sub';
    sub.textContent = `${summaryLabel} · 0 live secrets detected.`;
    titleWrap.append(title, sub);
    head.append(titleWrap, closeBtn);

    const actions = document.createElement('div');
    actions.className = 'pg-actions';
    actions.appendChild(makeButton(`Send ${pending.originalFile.name}`, 'pg-btn primary', cb.onSendOriginalFile));
    actions.appendChild(makeButton('Cancel', 'pg-btn ghost', cb.onCancelFile));
    card.append(head, actions);
    root.appendChild(card);
    return;
  }

  card.className = contextKind === 'MIXED_HYBRID' ? 'pg-bar mixed' : 'pg-bar sens';
  title.textContent = `PrivaGuard · Upload paused (${maskedByDefault.length} secret${maskedByDefault.length === 1 ? '' : 's'} found)`;
  title.appendChild(badge);
  const sub = document.createElement('div');
  sub.className = 'pg-sub';
  sub.textContent = `${summaryLabel} · ${formatNote}.`;
  titleWrap.append(title, sub);
  head.append(titleWrap, closeBtn);

  const actions = document.createElement('div');
  actions.className = 'pg-actions';
  actions.appendChild(makeButton(`Send ${pending.sanitizedFile.name}`, 'pg-btn primary', cb.onSendSanitizedFile));
  actions.appendChild(makeButton('Download safe copy', 'pg-btn', cb.onDownloadSanitizedFile));
  actions.appendChild(makeButton('Send original', 'pg-btn ghost', cb.onSendOriginalFile));
  actions.appendChild(makeButton('Cancel', 'pg-btn ghost', cb.onCancelFile));
  card.append(head, actions);
  root.appendChild(card);
}

export function renderShieldBar(vm: ShieldBarViewModel, cb: ShieldBarCallbacks): void {
  if (!vm.enabled) {
    clearShieldBar();
    return;
  }

  const showRevealPill = vm.ramVaultSize > 0 && (vm.canUndoMask || vm.hasReplyTokens);
  if (!vm.pendingFile && !vm.lastAnalysis && !showRevealPill) {
    clearShieldBar();
    return;
  }

  const root = ensureShadowUi();
  root.textContent = '';

  if (vm.pendingFile) {
    renderFileCard(root, vm.pendingFile, cb);
    return;
  }

  const card = document.createElement('div');
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');

  if (!vm.lastAnalysis && showRevealPill) {
    card.className = 'pg-bar done';
    const head = document.createElement('div');
    head.className = 'pg-head';
    const title = document.createElement('div');
    title.className = 'pg-title';
    title.textContent = `PrivaGuard · ${vm.ramVaultSize} secret${vm.ramVaultSize === 1 ? '' : 's'} shielded in RAM (0 B leaked)`;
    head.append(title, makeButton('×', 'pg-close', cb.onClosePostMask));

    const actions = document.createElement('div');
    actions.className = 'pg-actions';
    if (vm.canUndoMask) actions.appendChild(makeButton('Undo mask', 'pg-btn', cb.onUndoMask));
    if (vm.hasReplyTokens || vm.repliesRevealed) {
      actions.appendChild(
        makeButton(
          vm.repliesRevealed ? 'Hide real values in replies' : 'Reveal real values in replies',
          'pg-btn primary',
          cb.onToggleRevealReplies
        )
      );
    }
    card.append(head, actions);
    root.appendChild(card);
    return;
  }

  if (!vm.lastAnalysis) return;

  const { contextKind, maskedByDefault, keptSafeByContext, summaryLabel, entities } = vm.lastAnalysis;
  const sig = `${contextKind}:${maskedByDefault.length}:${keptSafeByContext.length}`;
  if (vm.dismissedSignature === sig) {
    clearShieldBar();
    return;
  }

  card.className =
    contextKind === 'EDUCATIONAL_SYNTHETIC'
      ? 'pg-bar edu'
      : contextKind === 'MIXED_HYBRID'
        ? 'pg-bar mixed'
        : 'pg-bar sens';

  const head = document.createElement('div');
  head.className = 'pg-head';
  const titleWrap = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'pg-title';
  title.textContent =
    contextKind === 'EDUCATIONAL_SYNTHETIC'
      ? 'PrivaGuard · Homework / sample context detected'
      : contextKind === 'MIXED_HYBRID'
        ? 'PrivaGuard · Lab items kept · Real secrets found'
        : `PrivaGuard · ${maskedByDefault.length} sensitive item${maskedByDefault.length === 1 ? '' : 's'} detected`;

  const sub = document.createElement('div');
  sub.className = 'pg-sub';
  sub.textContent =
    contextKind === 'EDUCATIONAL_SYNTHETIC'
      ? `${summaryLabel} — left untouched so AI can solve it.`
      : `${summaryLabel} · 0 B sent to cloud.`;

  titleWrap.append(title, sub);
  head.append(titleWrap, makeButton('×', 'pg-close', () => cb.onDismissAnalysis(sig)));
  card.appendChild(head);

  if (contextKind !== 'EDUCATIONAL_SYNTHETIC') {
    const presentCats = Array.from(new Set(entities.map((e) => e.category)));
    if (presentCats.length > 0) {
      const chips = document.createElement('div');
      chips.className = 'pg-chips';
      for (const cat of presentCats) {
        const count = entities.filter((e) => e.category === cat).length;
        const on = vm.activeCategories[cat] !== false;
        chips.appendChild(
          makeButton(
            `${on ? '✓' : '○'} ${CATEGORY_LABELS[cat] || cat} (${count})`,
            `pg-chip ${on ? 'on' : ''}`,
            () => cb.onToggleCategory(cat)
          )
        );
      }
      card.appendChild(chips);
    }
  }

  const actions = document.createElement('div');
  actions.className = 'pg-actions';

  if (contextKind === 'EDUCATIONAL_SYNTHETIC') {
    actions.appendChild(makeButton('Mask all anyway', 'pg-btn', () => cb.onMaskEditor(true)));
    actions.appendChild(makeButton('Keep intact', 'pg-btn ghost', () => cb.onDismissAnalysis(sig)));
  } else if (contextKind === 'MIXED_HYBRID') {
    actions.appendChild(
      makeButton(
        `Mask ${maskedByDefault.length} real secret${maskedByDefault.length === 1 ? '' : 's'}`,
        'pg-btn primary',
        () => cb.onMaskEditor(false)
      )
    );
    actions.appendChild(makeButton('Mask all', 'pg-btn', () => cb.onMaskEditor(true)));
    if (vm.nanoAvailable) {
      actions.appendChild(
        makeButton(
          vm.nanoScanning ? 'Scanning Nano…' : '+ Scan names (Nano)',
          'pg-btn',
          cb.onTriggerNanoScan,
          vm.nanoScanning
        )
      );
    }
    actions.appendChild(makeButton('Ignore', 'pg-btn ghost', () => cb.onDismissAnalysis(sig)));
  } else {
    actions.appendChild(makeButton('Mask in chat', 'pg-btn primary', () => cb.onMaskEditor(false)));
    if (vm.nanoAvailable) {
      actions.appendChild(
        makeButton(
          vm.nanoScanning ? 'Scanning Nano…' : '+ Scan names (Nano)',
          'pg-btn',
          cb.onTriggerNanoScan,
          vm.nanoScanning
        )
      );
    }
    actions.appendChild(makeButton('Ignore', 'pg-btn ghost', () => cb.onDismissAnalysis(sig)));
  }

  card.appendChild(actions);
  root.appendChild(card);
}
