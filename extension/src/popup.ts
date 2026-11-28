interface PopupSettings {
  enabled: boolean;
  smartContextGuard: boolean;
  shieldedCount: number;
}

const dotEl = document.getElementById('status-dot') as HTMLSpanElement | null;
const nanoBadgeEl = document.getElementById('nano-badge') as HTMLSpanElement | null;
const enabledEl = document.getElementById('toggle-enabled') as HTMLInputElement | null;
const smartEl = document.getElementById('toggle-smart') as HTMLInputElement | null;
const countEl = document.getElementById('shielded-count') as HTMLSpanElement | null;

function applySettings(s: PopupSettings) {
  if (enabledEl) enabledEl.checked = s.enabled;
  if (smartEl) smartEl.checked = s.smartContextGuard;
  if (countEl) countEl.textContent = String(s.shieldedCount);
  if (dotEl) {
    dotEl.className = s.enabled ? 'dot' : 'dot off';
  }
}

function init() {
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (resp?: { ok?: boolean; settings?: PopupSettings }) => {
    if (resp?.ok && resp.settings) {
      applySettings(resp.settings);
    }
  });

  chrome.runtime.sendMessage(
    { type: 'CHECK_NANO' },
    (resp?: { ok?: boolean; nano?: { available: boolean; status: string } }) => {
      if (!nanoBadgeEl) return;
      if (resp?.ok && resp.nano?.available) {
        nanoBadgeEl.textContent = 'Gemini Nano Ready';
        nanoBadgeEl.className = 'badge ready';
      } else {
        nanoBadgeEl.textContent = 'Regex + Context Guard';
        nanoBadgeEl.className = 'badge';
      }
    }
  );

  enabledEl?.addEventListener('change', () => {
    chrome.runtime.sendMessage(
      { type: 'SET_SETTINGS', patch: { enabled: enabledEl.checked } },
      (resp?: { ok?: boolean; settings?: PopupSettings }) => {
        if (resp?.ok && resp.settings) applySettings(resp.settings);
      }
    );
  });

  smartEl?.addEventListener('change', () => {
    chrome.runtime.sendMessage(
      { type: 'SET_SETTINGS', patch: { smartContextGuard: smartEl.checked } },
      (resp?: { ok?: boolean; settings?: PopupSettings }) => {
        if (resp?.ok && resp.settings) applySettings(resp.settings);
      }
    );
  });
}

init();
