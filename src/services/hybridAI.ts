import { getGenerativeModel, InferenceMode, Part } from 'firebase/ai';
import { ai } from '../firebase';

export type ModeKey = 'PREFER_ON_DEVICE' | 'ONLY_ON_DEVICE' | 'PREFER_IN_CLOUD' | 'ONLY_IN_CLOUD';

export type NanoAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

export interface HybridResponse {
  text: string;
  inferenceSource: 'ON_DEVICE' | 'IN_CLOUD' | 'UNKNOWN';
  latencyMs: number;
  ttftMs: number;
  modelUsed: string;
  wasMockEcho?: boolean;
  cached?: boolean;
  fallbackUsed?: boolean;
}

export interface AttachedImage {
  name: string;
  mimeType: string;
  base64Data: string;
  previewUrl: string;
}

const FALLBACK_CLOUD_MODEL = 'gemini-2.5-flash-lite';
const MAX_CACHE_ENTRIES = 20;
const responseCache = new Map<string, HybridResponse>();

function makeCacheKey(
  prompt: string,
  modeKey: ModeKey,
  cloudModel: string,
  image: AttachedImage | null
): string {
  const imgSig = image ? `${image.name}:${image.base64Data.length}` : 'no-img';
  return `${modeKey}|${cloudModel}|${imgSig}|${prompt}`;
}

export function toInferenceMode(key: ModeKey): InferenceMode {
  switch (key) {
    case 'ONLY_ON_DEVICE':
      return InferenceMode.ONLY_ON_DEVICE;
    case 'PREFER_IN_CLOUD':
      return InferenceMode.PREFER_IN_CLOUD;
    case 'ONLY_IN_CLOUD':
      return InferenceMode.ONLY_IN_CLOUD;
    case 'PREFER_ON_DEVICE':
    default:
      return InferenceMode.PREFER_ON_DEVICE;
  }
}

export async function checkChromeNanoAvailability(): Promise<NanoAvailability> {
  try {
    const g = globalThis as unknown as {
      LanguageModel?: { availability?: () => Promise<string> };
      ai?: { languageModel?: { capabilities?: () => Promise<{ available: string }> } };
    };
    if (g.LanguageModel?.availability) {
      const status = (await g.LanguageModel.availability()).toLowerCase();
      if (status === 'available' || status === 'readily') return 'available';
      if (status === 'downloading') return 'downloading';
      if (status === 'downloadable' || status === 'after-download') return 'downloadable';
    }
    if (g.ai?.languageModel?.capabilities) {
      const caps = await g.ai.languageModel.capabilities();
      if (caps.available === 'readily') return 'available';
      if (caps.available === 'after-download') return 'downloadable';
    }
  } catch {
    // Ignore unsupported browser errors
  }
  return 'unavailable';
}

function detectSource(rawSource: string | undefined, modeKey: ModeKey): HybridResponse['inferenceSource'] {
  const up = (rawSource || '').toUpperCase();
  if (up.includes('ON_DEVICE')) return 'ON_DEVICE';
  if (up.includes('IN_CLOUD')) return 'IN_CLOUD';
  return modeKey === 'ONLY_ON_DEVICE' ? 'ON_DEVICE' : 'IN_CLOUD';
}

function isRateLimitOrTransientError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('503') ||
    msg.includes('overloaded')
  );
}

async function runSingleStream(
  parts: Array<string | Part>,
  modeKey: ModeKey,
  cloudModel: string,
  started: number,
  onChunk?: (partialText: string) => void,
  signal?: AbortSignal
): Promise<HybridResponse> {
  let ttftMs = 0;

  const model = getGenerativeModel(ai, {
    model: cloudModel,
    mode: toInferenceMode(modeKey),
  });

  try {
    const streamResult = await model.generateContentStream(parts);
    let accumulated = '';
    for await (const chunk of streamResult.stream) {
      if (signal?.aborted) {
        throw new DOMException('Analysis cancelled by user.', 'AbortError');
      }
      const chunkText = chunk.text();
      if (chunkText) {
        if (ttftMs === 0) ttftMs = Math.round(performance.now() - started);
        accumulated += chunkText;
        onChunk?.(accumulated);
      }
    }
    if (signal?.aborted) {
      throw new DOMException('Analysis cancelled by user.', 'AbortError');
    }
    const finalResp = (await streamResult.response) as unknown as {
      text: () => string;
      inferenceSource?: string;
    };
    const finalText = accumulated || finalResp.text();
    const latencyMs = Math.round(performance.now() - started);
    const inferenceSource = detectSource(finalResp.inferenceSource, modeKey);
    const wasMockEcho = /not available in chromium|echoing back/i.test(finalText);

    return {
      text: finalText,
      inferenceSource,
      latencyMs,
      ttftMs: ttftMs || latencyMs,
      modelUsed: inferenceSource === 'ON_DEVICE' ? 'Gemini Nano (On-Device)' : `${cloudModel} (Cloud)`,
      wasMockEcho,
    };
  } catch (streamErr) {
    if (signal?.aborted || (streamErr instanceof DOMException && streamErr.name === 'AbortError')) {
      throw streamErr;
    }
    if (isRateLimitOrTransientError(streamErr)) {
      throw streamErr;
    }
    // Fallback to non-streaming generateContent if browser on-device stream throws
    const result = await model.generateContent(parts);
    if (signal?.aborted) {
      throw new DOMException('Analysis cancelled by user.', 'AbortError');
    }
    const latencyMs = Math.round(performance.now() - started);
    const response = result.response as unknown as {
      text: () => string;
      inferenceSource?: string;
    };
    const text = response.text();
    const inferenceSource = detectSource(response.inferenceSource, modeKey);
    const wasMockEcho = /not available in chromium|echoing back/i.test(text);
    onChunk?.(text);
    if (!text && streamErr) throw streamErr;
    return {
      text,
      inferenceSource,
      latencyMs,
      ttftMs: latencyMs,
      modelUsed: inferenceSource === 'ON_DEVICE' ? 'Gemini Nano (On-Device)' : `${cloudModel} (Cloud)`,
      wasMockEcho,
    };
  }
}

/**
 * Streaming Hybrid Inference via Firebase AI Logic SDK.
 * Includes in-memory instant cache, AbortSignal cancellation, and automatic
 * rate-limit (HTTP 429 / 503) fallback to gemini-2.5-flash-lite for multi-user resilience.
 */
export async function generateHybridStream(
  prompt: string,
  modeKey: ModeKey,
  cloudModel = 'gemini-2.5-flash',
  image: AttachedImage | null = null,
  onChunk?: (partialText: string) => void,
  signal?: AbortSignal
): Promise<HybridResponse> {
  const cacheKey = makeCacheKey(prompt, modeKey, cloudModel, image);
  const cached = responseCache.get(cacheKey);
  if (cached && !cached.wasMockEcho) {
    onChunk?.(cached.text);
    return { ...cached, latencyMs: 1, ttftMs: 1, cached: true };
  }

  const started = performance.now();
  const parts: Array<string | Part> = [prompt];
  if (image) {
    parts.push({
      type: 'inlineData',
      inlineData: {
        mimeType: image.mimeType,
        data: image.base64Data,
      },
    });
  }

  try {
    const res = await runSingleStream(parts, modeKey, cloudModel, started, onChunk, signal);
    if (!res.wasMockEcho) {
      if (responseCache.size >= MAX_CACHE_ENTRIES) {
        const firstKey = responseCache.keys().next().value;
        if (firstKey) responseCache.delete(firstKey);
      }
      responseCache.set(cacheKey, res);
    }
    return res;
  } catch (err) {
    if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
      throw err;
    }
    // Multi-user resilience: if primary model hits 429 / 503, retry with fast lite model
    if (isRateLimitOrTransientError(err) && cloudModel !== FALLBACK_CLOUD_MODEL && modeKey !== 'ONLY_ON_DEVICE') {
      await new Promise((r) => setTimeout(r, 600));
      if (signal?.aborted) throw new DOMException('Analysis cancelled by user.', 'AbortError');
      const fallbackRes = await runSingleStream(
        parts,
        modeKey,
        FALLBACK_CLOUD_MODEL,
        started,
        onChunk,
        signal
      );
      return { ...fallbackRes, fallbackUsed: true };
    }
    if (isRateLimitOrTransientError(err)) {
      throw new Error(
        'Cloud AI is temporarily busy (free-tier rate limit reached by concurrent users). Please wait a few seconds or switch to Only On-Device mode.'
      );
    }
    throw err;
  }
}

/**
 * Stage 1 (On-Device): Ask Gemini Nano to find person names / company names strictly on-device.
 * Only called when Gemini Nano is actually available on-device (zero wasted delay otherwise).
 */
export async function detectEntitiesOnDevice(rawText: string): Promise<{
  entities: string[];
  usedOnDeviceAI: boolean;
  latencyMs: number;
}> {
  const started = performance.now();
  try {
    const model = getGenerativeModel(ai, {
      model: 'gemini-2.5-flash',
      mode: InferenceMode.ONLY_ON_DEVICE,
    });
    const res = await model.generateContent(
      `Extract ONLY proper names of people, street addresses, and private company names from the text below. Return a plain comma-separated list with no explanation. If none, return NONE.\n\nText:\n${rawText.slice(0, 1500)}`
    );
    const latencyMs = Math.round(performance.now() - started);
    const cleaned = res.response.text().trim();
    if (
      !cleaned ||
      cleaned.toUpperCase() === 'NONE' ||
      /not available|echoing back/i.test(cleaned)
    ) {
      return { entities: [], usedOnDeviceAI: false, latencyMs };
    }
    const entities = cleaned
      .split(/[,\n]+/)
      .map((s) => s.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter((s) => s.length >= 3 && s.length <= 45 && !s.includes(':') && s.split(/\s+/).length <= 4);
    return { entities, usedOnDeviceAI: true, latencyMs };
  } catch {
    return {
      entities: [],
      usedOnDeviceAI: false,
      latencyMs: Math.round(performance.now() - started),
    };
  }
}

export type AnalysisTask = 'executive' | 'risk_audit' | 'action_plan' | 'quick_offline';

export function buildTaskPrompt(redactedText: string, task: AnalysisTask, hasImage = false): string {
  const keepTokensRule =
    'IMPORTANT: Preserve all bracketed placeholders exactly as written (e.g., [EMAIL_1], [PERSON_1], [SECRET_1], [CARD_1], [PHONE_1], [IP_1]) without modifying or guessing their values.';
  const imageHint = hasImage
    ? '\nAlso analyze the attached image and incorporate key findings (do not repeat any raw PII).'
    : '';

  switch (task) {
    case 'quick_offline':
      return `${keepTokensRule}${imageHint}\nGive a crisp 3-bullet summary and 1-sentence tone assessment of the following anonymized note:\n\n${redactedText}`;
    case 'risk_audit':
      return `${keepTokensRule}${imageHint}\nYou are a Senior Security & Legal Auditor. Analyze this anonymized document and output Markdown with:\n### Risk Level\n(Low / Medium / High / Critical + 1-sentence reason)\n### Top 3 Compliance or Security Risks\n- bullet points referencing exact placeholders\n### Immediate Remediation Steps\n1. numbered action steps\n\nDocument:\n${redactedText}`;
    case 'action_plan':
      return `${keepTokensRule}${imageHint}\nExtract a prioritized Action Plan in Markdown from this anonymized document:\n### Urgent Next Steps (24h)\n### Owners & Deliverables\n### Follow-up Checklist\n\nDocument:\n${redactedText}`;
    case 'executive':
    default:
      return `${keepTokensRule}${imageHint}\nProvide a concise Executive Brief in Markdown of this anonymized document:\n### TL;DR\n### Key Facts & Decisions\n### Recommended Next Action\n\nDocument:\n${redactedText}`;
  }
}
