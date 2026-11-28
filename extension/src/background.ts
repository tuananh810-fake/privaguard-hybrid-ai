import { adjudicateAmbiguousWithNano, type ClassifiedEntity } from '../../src/services/sensitivityEngine';

export interface ExtensionSettings {
  enabled: boolean;
  smartContextGuard: boolean;
  shieldedCount: number;
}

interface DiscoveredEntity {
  text: string;
  type: 'PERSON' | 'ORG' | 'ADDRESS' | 'LOCATION';
}

const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: true,
  smartContextGuard: true,
  shieldedCount: 0,
};

const VALID_TYPES = new Set<DiscoveredEntity['type']>(['PERSON', 'ORG', 'ADDRESS', 'LOCATION']);

async function getSettings(): Promise<ExtensionSettings> {
  try {
    const stored = await chrome.storage.local.get(['privaguard_settings']);
    const saved = stored.privaguard_settings as Partial<ExtensionSettings> | undefined;
    return {
      enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : DEFAULT_SETTINGS.enabled,
      smartContextGuard:
        typeof saved?.smartContextGuard === 'boolean'
          ? saved.smartContextGuard
          : DEFAULT_SETTINGS.smartContextGuard,
      shieldedCount: typeof saved?.shieldedCount === 'number' ? saved.shieldedCount : 0,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(patch: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const current = await getSettings();
  const next: ExtensionSettings = { ...current, ...patch };
  try {
    await chrome.storage.local.set({ privaguard_settings: next });
  } catch {
    // ignore storage errors
  }
  return next;
}

type ChromeLanguageModelApi = {
  availability?: (opts?: unknown) => Promise<string>;
  create?: (opts?: unknown) => Promise<{
    prompt: (text: string, opts?: { signal?: AbortSignal }) => Promise<string>;
    destroy?: () => void;
  }>;
};

function getLanguageModelApi(): ChromeLanguageModelApi | null {
  const g = globalThis as unknown as { LanguageModel?: ChromeLanguageModelApi };
  return g.LanguageModel ?? null;
}

async function checkNanoStatus(): Promise<{ available: boolean; status: string }> {
  try {
    const lm = getLanguageModelApi();
    if (!lm?.availability) {
      return { available: false, status: 'unavailable' };
    }
    let status = '';
    try {
      status = (
        await lm.availability({ expectedOutputs: [{ type: 'text', languages: ['en'] }] })
      ).toLowerCase();
    } catch {
      status = (await lm.availability()).toLowerCase();
    }
    return {
      available: status === 'available' || status === 'readily',
      status,
    };
  } catch {
    return { available: false, status: 'unavailable' };
  }
}

function parseDiscoveredEntities(rawOutput: string, sourceText: string, alreadyMasked: string[]): DiscoveredEntity[] {
  const fenced = rawOutput.trim().match(/```(?:json)?\s*([\s\S]*?)```/i);
  let candidate = fenced ? fenced[1].trim() : rawOutput.trim();
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  candidate = candidate.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1');

  try {
    const parsed = JSON.parse(candidate);
    if (!Array.isArray(parsed)) return [];
    const maskedSet = new Set(alreadyMasked.map((s) => s.toLowerCase()));
    const seen = new Set<string>();
    const results: DiscoveredEntity[] = [];

    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as { text?: unknown; type?: unknown };
      if (typeof obj.text !== 'string' || typeof obj.type !== 'string') continue;
      const text = obj.text.trim();
      const type = obj.type.trim().toUpperCase() as DiscoveredEntity['type'];
      if (text.length < 2 || text.length > 80 || !VALID_TYPES.has(type)) continue;
      // Verbatim anti-hallucination guard: must appear verbatim in sourceText
      if (!sourceText.includes(text)) continue;
      const key = text.toLowerCase();
      if (maskedSet.has(key) || seen.has(key)) continue;
      seen.add(key);
      results.push({ text, type });
    }
    return results;
  } catch {
    return [];
  }
}

async function discoverSemanticEntitiesLocal(
  rawText: string,
  alreadyMasked: string[],
  timeoutMs = 12_000
): Promise<{ entities: DiscoveredEntity[]; usedNano: boolean; timedOut: boolean }> {
  const lm = getLanguageModelApi();
  const status = await checkNanoStatus();
  if (!lm?.create || !status.available || !rawText.trim()) {
    return { entities: [], usedNano: false, timedOut: false };
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let session: { prompt: (text: string, opts?: { signal?: AbortSignal }) => Promise<string>; destroy?: () => void } | null = null;
  try {
    session = await lm.create({
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
      initialPrompts: [
        {
          role: 'system',
          content:
            'Extract private PERSON names, private ORG names, and street ADDRESSES from the text. Skip public famous figures, generic placeholders (John Doe, Nguyen Van A), and technical terms. Reply ONLY with a JSON array: [{"text":"exact substring","type":"PERSON|ORG|ADDRESS|LOCATION"}].',
        },
      ],
    });
    const out = await session.prompt(rawText.slice(0, 1800), { signal: controller.signal });
    const entities = parseDiscoveredEntities(out, rawText, alreadyMasked);
    return { entities, usedNano: true, timedOut: false };
  } catch {
    return { entities: [], usedNano: false, timedOut };
  } finally {
    clearTimeout(timer);
    try {
      session?.destroy?.();
    } catch {
      // ignore
    }
  }
}

async function ensureOffscreenDocument(): Promise<void> {
  try {
    const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (existing.length > 0) return;
  } catch {
    // Fallback if getContexts unavailable
  }
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER'],
      justification:
        'Render PDF pages to local Canvas and strip hidden text streams without host-page CSP interference.',
    });
  } catch {
    // Ignore already-created race
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void getSettings().then((s) => saveSettings(s));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const req = message as {
    type?: string;
    patch?: Partial<ExtensionSettings>;
    delta?: number;
    rawText?: string;
    alreadyMasked?: string[];
    entities?: ClassifiedEntity[];
    base64Bytes?: string;
    smartContextGuard?: boolean;
  };

  if (req.type === 'GET_SETTINGS') {
    void getSettings().then((settings) => sendResponse({ ok: true, settings }));
    return true;
  }

  if (req.type === 'SET_SETTINGS') {
    void saveSettings(req.patch || {}).then((settings) => sendResponse({ ok: true, settings }));
    return true;
  }

  if (req.type === 'INCREMENT_SHIELDED') {
    const delta = Math.max(0, Math.min(500, Number(req.delta || 0)));
    void getSettings()
      .then((cur) => saveSettings({ shieldedCount: cur.shieldedCount + delta }))
      .then((settings) => sendResponse({ ok: true, settings }));
    return true;
  }

  if (req.type === 'CHECK_NANO') {
    void checkNanoStatus().then((nano) => sendResponse({ ok: true, nano }));
    return true;
  }

  if (req.type === 'NANO_SCAN') {
    const rawText = typeof req.rawText === 'string' ? req.rawText : '';
    const alreadyMasked = Array.isArray(req.alreadyMasked) ? req.alreadyMasked : [];
    const existingEntities = Array.isArray(req.entities) ? req.entities : [];

    void (async () => {
      try {
        const [semantic, adjudicated] = await Promise.all([
          discoverSemanticEntitiesLocal(rawText, alreadyMasked, 12_000),
          adjudicateAmbiguousWithNano(rawText, existingEntities, { timeoutMs: 6_000 }),
        ]);
        sendResponse({
          ok: true,
          discovered: semantic.entities,
          adjudicated: adjudicated.entities,
          usedNano: semantic.usedNano || adjudicated.usedNano,
          timedOut: semantic.timedOut || adjudicated.timedOut,
        });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return true;
  }

  if (req.type === 'REDACT_PDF_FILE') {
    void (async () => {
      try {
        await ensureOffscreenDocument();
        chrome.runtime.sendMessage(
          {
            type: 'OFFSCREEN_REDACT_PDF',
            base64Bytes: req.base64Bytes,
            smartContextGuard: req.smartContextGuard !== false,
          },
          (resp?: unknown) => {
            sendResponse(resp ?? { ok: false, error: 'Offscreen PDF redactor did not respond' });
          }
        );
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return true;
  }

  return false;
});
