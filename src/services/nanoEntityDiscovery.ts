import { isMockNanoEcho } from './hybridHelpers.ts';

export type NanoEntityType = 'PERSON' | 'ORG' | 'ADDRESS' | 'LOCATION';

export interface NanoDiscoveredEntity {
  text: string;
  type: NanoEntityType;
}

export interface NanoDiscoveryResult {
  entities: NanoDiscoveredEntity[];
  usedNano: boolean;
  timedOut: boolean;
  latencyMs: number;
  scannedChars: number;
  totalChars: number;
  truncated: boolean;
}

export const NANO_CHUNK_SIZE = 1800;
export const NANO_CHUNK_OVERLAP = 120;
export const NANO_MAX_CHUNKS = 3;
export const NANO_MANUAL_SCAN_TIMEOUT_MS = 30_000;
export const NANO_AUTO_SCAN_TIMEOUT_MS = 12_000;
export const NANO_FOLLOWUP_SCAN_TIMEOUT_MS = 5_000;

export interface NanoChunkSlice {
  text: string;
  start: number;
  end: number;
}

export interface NanoChunkPlan {
  chunks: NanoChunkSlice[];
  scannedChars: number;
  totalChars: number;
  truncated: boolean;
}

/**
 * Computes bounded overlapping slices for on-device Gemini Nano discovery
 * and reports honest character coverage / truncation metadata.
 */
export function buildNanoChunkPlan(
  rawText: string,
  options: { chunkSize?: number; overlap?: number; maxChunks?: number } = {}
): NanoChunkPlan {
  const chunkSize = options.chunkSize ?? NANO_CHUNK_SIZE;
  const overlap = options.overlap ?? NANO_CHUNK_OVERLAP;
  const maxChunks = options.maxChunks ?? NANO_MAX_CHUNKS;
  const totalChars = rawText.length;

  if (totalChars === 0) {
    return { chunks: [], scannedChars: 0, totalChars: 0, truncated: false };
  }

  const step = Math.max(1, chunkSize - overlap);
  const chunks: NanoChunkSlice[] = [];
  let maxEnd = 0;

  for (let pos = 0; pos < totalChars && chunks.length < maxChunks; pos += step) {
    const end = Math.min(totalChars, pos + chunkSize);
    chunks.push({ text: rawText.slice(pos, end), start: pos, end });
    if (end > maxEnd) maxEnd = end;
    if (end >= totalChars) break;
  }

  return {
    chunks,
    scannedChars: Math.min(totalChars, maxEnd),
    totalChars,
    truncated: maxEnd < totalChars,
  };
}

const VALID_TYPES = new Set<NanoEntityType>(['PERSON', 'ORG', 'ADDRESS', 'LOCATION']);

function extractEntityObjectsFallback(raw: string): NanoDiscoveredEntity[] {
  const results: NanoDiscoveredEntity[] = [];
  const objPattern =
    /\{\s*"text"\s*:\s*"((?:\\.|[^"\\])+)"\s*,\s*"type"\s*:\s*"(PERSON|ORG|ADDRESS|LOCATION)"\s*\}|\{\s*"type"\s*:\s*"(PERSON|ORG|ADDRESS|LOCATION)"\s*,\s*"text"\s*:\s*"((?:\\.|[^"\\])+)"\s*\}/gi;
  let match: RegExpExecArray | null;
  while ((match = objPattern.exec(raw)) !== null) {
    const rawText = match[1] ?? match[4];
    const rawType = (match[2] ?? match[3] ?? '').trim().toUpperCase() as NanoEntityType;
    if (!rawText || !VALID_TYPES.has(rawType)) continue;
    try {
      const decoded = JSON.parse(`"${rawText}"`);
      if (typeof decoded === 'string' && decoded.trim()) {
        results.push({ text: decoded.trim(), type: rawType });
      }
    } catch {
      results.push({ text: rawText.trim(), type: rawType });
    }
  }
  return results;
}

/**
 * Safely parses JSON array output from Gemini Nano.
 * Handles markdown code fences, object wrappers, trailing commas, or truncated arrays; never throws.
 */
export function parseNanoEntityResponse(rawOutput: string): NanoDiscoveredEntity[] {
  if (!rawOutput || typeof rawOutput !== 'string') return [];
  const trimmed = rawOutput.trim();
  if (!trimmed || isMockNanoEcho(trimmed)) return [];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let candidate = fenced ? fenced[1].trim() : trimmed;

  if (!candidate.startsWith('[')) {
    const start = candidate.indexOf('[');
    const end = candidate.lastIndexOf(']');
    if (start !== -1 && end > start) {
      candidate = candidate.slice(start, end + 1);
    } else {
      return extractEntityObjectsFallback(candidate);
    }
  }

  try {
    const cleaned = candidate.replace(/,\s*([}\]])/g, '$1');
    const parsed = JSON.parse(cleaned);
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { entities?: unknown }).entities)
        ? (parsed as { entities: unknown[] }).entities
        : null;
    if (!list) return [];
    const results: NanoDiscoveredEntity[] = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as { text?: unknown; type?: unknown };
      if (typeof obj.text !== 'string' || typeof obj.type !== 'string') continue;
      const normalizedType = obj.type.trim().toUpperCase() as NanoEntityType;
      if (!VALID_TYPES.has(normalizedType)) continue;
      results.push({ text: obj.text.trim(), type: normalizedType });
    }
    return results;
  } catch {
    return extractEntityObjectsFallback(candidate);
  }
}

interface TextSpan {
  start: number;
  end: number;
}

function findAllSpans(haystack: string, needle: string): TextSpan[] {
  const spans: TextSpan[] = [];
  if (!needle) return spans;
  let pos = 0;
  while (pos < haystack.length) {
    const idx = haystack.indexOf(needle, pos);
    if (idx === -1) break;
    spans.push({ start: idx, end: idx + needle.length });
    pos = idx + needle.length;
  }
  return spans;
}

function spansOverlap(a: TextSpan, b: TextSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Anti-hallucination filter for Gemini Nano semantic entity discovery:
 * - Keeps only entities whose text appears VERBATIM in rawText
 * - Minimum length >= 2 chars (and <= 80 chars, never bracketed tokens)
 * - Drops entities whose occurrences all overlap spans already masked by regex
 * - Deduplicates case-insensitively
 */
export function filterNanoEntities(
  rawText: string,
  candidates: NanoDiscoveredEntity[],
  alreadyMaskedByRegex: string[] = []
): NanoDiscoveredEntity[] {
  if (!rawText || candidates.length === 0) return [];

  const regexSpans: TextSpan[] = [];
  for (const masked of alreadyMaskedByRegex) {
    const m = masked.trim();
    if (!m) continue;
    regexSpans.push(...findAllSpans(rawText, m));
  }

  const seenLower = new Set<string>();
  const kept: NanoDiscoveredEntity[] = [];

  for (const cand of candidates) {
    const text = cand.text.trim();
    if (text.length < 2 || text.length > 80) continue;
    if (!VALID_TYPES.has(cand.type)) continue;
    if (text.startsWith('[') && text.endsWith(']')) continue;

    // Verbatim presence check — rejects hallucinated names/entities
    const entitySpans = findAllSpans(rawText, text);
    if (entitySpans.length === 0) continue;

    // Reject if every occurrence overlaps a span already caught by regex
    const hasUncoveredSpan = entitySpans.some(
      (es) => !regexSpans.some((rs) => spansOverlap(es, rs))
    );
    if (!hasUncoveredSpan) continue;

    const lowerKey = text.toLowerCase();
    if (seenLower.has(lowerKey)) continue;
    seenLower.add(lowerKey);

    kept.push({ text, type: cand.type });
  }

  return kept;
}

export function buildDiscoveryPrompt(chunk: string): string {
  return [
    'Extract sensitive PERSON, ORG, and ADDRESS substrings verbatim from the text (English and Vietnamese with diacritics).',
    'Exclude emails, phones, IDs, IPs, URLs, keys, dates, and generic terms.',
    'Return ONLY JSON: [{"text":"exact substring","type":"PERSON"|"ORG"|"ADDRESS"}] or [].',
    'Text:',
    chunk,
  ].join('\n');
}

export interface DiscoverNanoOptions {
  alreadyMaskedByRegex?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Optional chunk generator override for deterministic unit tests. */
  generateChunkText?: (prompt: string) => Promise<string>;
}

/**
 * Runs on-device Gemini Nano (InferenceMode.ONLY_ON_DEVICE) to discover semantic PII
 * before anything is sent to the cloud. Dynamically imports firebase/ai to keep initial JS small.
 * Supports configurable timeouts (20s manual scan / 12s auto-scan) and AbortController cancellation.
 */
export async function discoverSemanticEntitiesWithNano(
  rawText: string,
  options: DiscoverNanoOptions = {}
): Promise<NanoDiscoveryResult> {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const timeoutMs = options.timeoutMs ?? NANO_AUTO_SCAN_TIMEOUT_MS;
  const alreadyMasked = options.alreadyMaskedByRegex ?? [];
  const totalChars = rawText.length;

  if (!rawText.trim() || options.signal?.aborted) {
    return {
      entities: [],
      usedNano: false,
      timedOut: false,
      latencyMs: 0,
      scannedChars: 0,
      totalChars,
      truncated: totalChars > 0,
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  const onParentAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onParentAbort, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const rawCandidates: NanoDiscoveredEntity[] = [];
  let usedNano = false;
  let scannedChars = 0;

  try {
    let runChunk: (prompt: string) => Promise<string>;
    if (options.generateChunkText) {
      runChunk = options.generateChunkText;
    } else {
      const { createOnDeviceNanoModel } = await import('./hybridAI');
      if (controller.signal.aborted) {
        const elapsed = Math.round(
          (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started
        );
        return {
          entities: [],
          usedNano: false,
          timedOut,
          latencyMs: elapsed,
          scannedChars: 0,
          totalChars,
          truncated: totalChars > 0,
        };
      }
      const model = createOnDeviceNanoModel();
      runChunk = async (prompt: string) => {
        const response = await model.generateContent(prompt);
        return response.response.text();
      };
    }

    const plan = buildNanoChunkPlan(rawText);

    for (const chunk of plan.chunks) {
      if (controller.signal.aborted) break;

      const chunkPromise = new Promise<string>((resolve, reject) => {
        if (controller.signal.aborted) {
          reject(new DOMException(timedOut ? 'Nano discovery timed out' : 'Nano discovery cancelled', 'AbortError'));
          return;
        }
        const onAbort = () => {
          reject(new DOMException(timedOut ? 'Nano discovery timed out' : 'Nano discovery cancelled', 'AbortError'));
        };
        controller.signal.addEventListener('abort', onAbort, { once: true });
        runChunk(buildDiscoveryPrompt(chunk.text)).then(
          (val) => {
            controller.signal.removeEventListener('abort', onAbort);
            resolve(val);
          },
          (err) => {
            controller.signal.removeEventListener('abort', onAbort);
            reject(err);
          }
        );
      });

      const text = (await chunkPromise).trim();
      if (!text || isMockNanoEcho(text)) {
        continue;
      }

      usedNano = true;
      scannedChars = Math.min(totalChars, Math.max(scannedChars, chunk.end));
      rawCandidates.push(...parseNanoEntityResponse(text));
    }

    const filtered = filterNanoEntities(rawText, rawCandidates, alreadyMasked);
    const elapsed = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started
    );
    return {
      entities: filtered,
      usedNano,
      timedOut,
      latencyMs: elapsed,
      scannedChars,
      totalChars,
      truncated: scannedChars < totalChars,
    };
  } catch {
    const filtered = filterNanoEntities(rawText, rawCandidates, alreadyMasked);
    const elapsed = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started
    );
    return {
      entities: filtered,
      usedNano,
      timedOut,
      latencyMs: elapsed,
      scannedChars,
      totalChars,
      truncated: scannedChars < totalChars,
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onParentAbort);
  }
}
