export type NanoEntityType = 'PERSON' | 'ORG' | 'ADDRESS' | 'LOCATION';

export interface NanoDiscoveredEntity {
  text: string;
  type: NanoEntityType;
}

export interface NanoDiscoveryResult {
  entities: NanoDiscoveredEntity[];
  usedNano: boolean;
  latencyMs: number;
}

const VALID_TYPES = new Set<NanoEntityType>(['PERSON', 'ORG', 'ADDRESS', 'LOCATION']);

/**
 * Safely parses JSON array output from Gemini Nano.
 * Handles markdown code fences or prose wrapping a JSON array; never throws.
 */
export function parseNanoEntityResponse(rawOutput: string): NanoDiscoveredEntity[] {
  if (!rawOutput || typeof rawOutput !== 'string') return [];
  const trimmed = rawOutput.trim();
  if (!trimmed || /not available|echoing back/i.test(trimmed)) return [];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let candidate = fenced ? fenced[1].trim() : trimmed;

  if (!candidate.startsWith('[')) {
    const start = candidate.indexOf('[');
    const end = candidate.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) return [];
    candidate = candidate.slice(start, end + 1);
  }

  try {
    const parsed = JSON.parse(candidate);
    if (!Array.isArray(parsed)) return [];
    const results: NanoDiscoveredEntity[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as { text?: unknown; type?: unknown };
      if (typeof obj.text !== 'string' || typeof obj.type !== 'string') continue;
      const normalizedType = obj.type.trim().toUpperCase() as NanoEntityType;
      if (!VALID_TYPES.has(normalizedType)) continue;
      results.push({ text: obj.text.trim(), type: normalizedType });
    }
    return results;
  } catch {
    return [];
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

function buildDiscoveryPrompt(chunk: string): string {
  return [
    'You are a strict local PII extractor. Extract ONLY free-form sensitive entities that regex cannot catch:',
    '- PERSON: full names or personal names (including Vietnamese names with diacritics like "Nguyễn Văn An")',
    '- ORG: private company, client, hospital, or internal team names',
    '- ADDRESS: street addresses, apartment/suite numbers, postal addresses',
    '- LOCATION: specific private offices, clinics, or branch locations',
    'Rules:',
    '1. Return ONLY a JSON array of objects: [{"text": "exact substring", "type": "PERSON"|"ORG"|"ADDRESS"|"LOCATION"}]',
    '2. Every "text" MUST be copied verbatim from the input text.',
    '3. Do NOT include emails, phone numbers, IPs, URLs, API keys, dates, or generic words.',
    '4. If none found, return [].',
    '',
    'Input text:',
    chunk,
  ].join('\n');
}

/**
 * Runs on-device Gemini Nano (InferenceMode.ONLY_ON_DEVICE) to discover semantic PII
 * before anything is sent to the cloud. Dynamically imports firebase/ai to keep initial JS small.
 * Always enforces a 5s timeout and never throws on unavailable/invalid responses.
 */
export async function discoverSemanticEntitiesWithNano(
  rawText: string,
  options: {
    alreadyMaskedByRegex?: string[];
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {}
): Promise<NanoDiscoveryResult> {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const timeoutMs = options.timeoutMs ?? 5000;
  const alreadyMasked = options.alreadyMaskedByRegex ?? [];

  if (!rawText.trim() || options.signal?.aborted) {
    return { entities: [], usedNano: false, latencyMs: 0 };
  }

  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onParentAbort, { once: true });

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { createOnDeviceNanoModel } = await import('./hybridAI');

    if (controller.signal.aborted) {
      return {
        entities: [],
        usedNano: false,
        latencyMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started),
      };
    }

    const model = createOnDeviceNanoModel();

    const chunkSize = 1800;
    const overlap = 120;
    const chunks: string[] = [];
    for (let pos = 0; pos < rawText.length && chunks.length < 3; pos += chunkSize - overlap) {
      chunks.push(rawText.slice(pos, pos + chunkSize));
      if (pos + chunkSize >= rawText.length) break;
    }

    const rawCandidates: NanoDiscoveredEntity[] = [];
    let usedNano = false;

    for (const chunk of chunks) {
      if (controller.signal.aborted) break;

      const abortPromise = new Promise<never>((_, reject) => {
        if (controller.signal.aborted) {
          reject(new DOMException('Nano discovery timed out', 'AbortError'));
          return;
        }
        controller.signal.addEventListener(
          'abort',
          () => reject(new DOMException('Nano discovery timed out', 'AbortError')),
          { once: true }
        );
      });

      const response = await Promise.race([
        model.generateContent(buildDiscoveryPrompt(chunk)),
        abortPromise,
      ]);

      const text = response.response.text().trim();
      if (!text || /not available|echoing back/i.test(text)) {
        continue;
      }

      usedNano = true;
      rawCandidates.push(...parseNanoEntityResponse(text));
    }

    const filtered = filterNanoEntities(rawText, rawCandidates, alreadyMasked);
    const elapsed = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
    return { entities: filtered, usedNano, latencyMs: elapsed };
  } catch {
    const elapsed = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
    return { entities: [], usedNano: false, latencyMs: elapsed };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onParentAbort);
  }
}
