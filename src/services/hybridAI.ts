import { getGenerativeModel, InferenceMode, OnDeviceParams, Part, Schema } from 'firebase/ai';
import { ai } from '../firebase';
import {
  AnalysisTask,
  buildResponseCacheKey,
  buildTaskPrompt,
  clearStalledCloudModel,
  CLOUD_TTFT_TIMEOUT_MS,
  extractRiskBanner,
  isMockNanoEcho,
  markCloudModelStalled,
  ParsedRiskBanner,
  parseStructuredAudit,
  resolveEffectiveCloudModel,
  sanitizeNanoResult,
  shouldApplyCloudTtftTimeout,
  shouldCacheHybridResponse,
  shouldEmitStreamChunk,
  StructuredAuditReport,
  StructuredFinding,
  StructuredRemediation,
  structuredAuditToMarkdown,
} from './hybridHelpers';

export type {
  AnalysisTask,
  ParsedRiskBanner,
  StructuredAuditReport,
  StructuredFinding,
  StructuredRemediation,
};
export { buildTaskPrompt, extractRiskBanner, parseStructuredAudit, structuredAuditToMarkdown };

export type ModeKey = 'PREFER_ON_DEVICE' | 'ONLY_ON_DEVICE' | 'PREFER_IN_CLOUD' | 'ONLY_IN_CLOUD';

export type CloudModelPreference = 'auto' | 'gemini-3.6-flash' | 'gemini-3.5-flash-lite';

export type NanoAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

export type FallbackReason = 'rate_limit' | 'ttft_timeout' | 'cooldown_bypass';

export interface HybridResponse {
  text: string;
  inferenceSource: 'ON_DEVICE' | 'IN_CLOUD' | 'UNKNOWN';
  latencyMs: number;
  ttftMs: number;
  modelUsed: string;
  wasMockEcho?: boolean;
  nanoUnavailable?: boolean;
  cached?: boolean;
  fallbackUsed?: boolean;
  fallbackReason?: FallbackReason | null;
  structuredAudit?: StructuredAuditReport | null;
}

export interface AttachedImage {
  name: string;
  mimeType: string;
  base64Data: string;
  previewUrl: string;
}

export interface FollowUpMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  inferenceSource?: 'ON_DEVICE' | 'IN_CLOUD' | 'UNKNOWN';
  latencyMs?: number;
}

const FALLBACK_CLOUD_MODEL = 'gemini-3.5-flash-lite';
const NANO_OUTPUT_LANG_OPTIONS = {
  expectedOutputs: [{ type: 'text' as const, languages: ['en'] }],
};
const MAX_CACHE_ENTRIES = 24;
const responseCache = new Map<string, HybridResponse>();
const stalledCloudModels = new Map<string, number>();

const SECURITY_AUDIT_SCHEMA = Schema.object({
  properties: {
    riskLevel: Schema.enumString({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] }),
    riskScore: Schema.integer({ description: 'Overall risk score from 0 (safe) to 100 (critical)' }),
    summary: Schema.string({
      description: 'Concise 1-sentence executive risk summary preserving all [TOKEN_N] placeholders',
    }),
    complianceFrameworks: Schema.array({
      items: Schema.string(),
      description: 'Relevant frameworks impacted, e.g. SOC2, GDPR, HIPAA, PCI-DSS, OWASP',
    }),
    findings: Schema.array({
      items: Schema.object({
        properties: {
          title: Schema.string(),
          severity: Schema.enumString({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] }),
          detail: Schema.string(),
        },
        required: ['title', 'severity', 'detail'],
      }),
    }),
    remediations: Schema.array({
      items: Schema.object({
        properties: {
          step: Schema.string(),
          priority: Schema.enumString({ enum: ['IMMEDIATE', 'SHORT_TERM', 'LONG_TERM'] }),
        },
        required: ['step', 'priority'],
      }),
    }),
  },
  required: ['riskLevel', 'riskScore', 'summary', 'complianceFrameworks', 'findings', 'remediations'],
});

function makeCacheKey(
  prompt: string,
  modeKey: ModeKey,
  effectiveCloudModel: string,
  style: string,
  useStructured: boolean,
  image: AttachedImage | null
): string {
  const imgSig = image
    ? `${image.name}:${image.base64Data.length}:${image.base64Data.slice(0, 24)}:${image.base64Data.slice(-24)}`
    : 'no-img';
  return buildResponseCacheKey(prompt, modeKey, effectiveCloudModel, style, useStructured, imgSig);
}

export function clearCloudModelCooldown(model?: string): void {
  clearStalledCloudModel(stalledCloudModels, model);
}

function getSystemInstruction(style = 'concise_executive'): string {
  const base =
    'You are PrivaGuard AI, a privacy-first security & document intelligence analyst. ' +
    'ALWAYS preserve bracketed privacy tokens (such as [SECRET_1], [EMAIL_1], [PERSON_1], [ORG_1], [ADDRESS_1], [CARD_1], [ID_1], [PHONE_1], [IP_1]) verbatim. ' +
    'Never attempt to guess, decode, or alter placeholders.';

  if (style === 'detailed_auditor') {
    return `${base} Be thorough, cite exact token references, and prioritize compliance frameworks (SOC2, HIPAA, GDPR, PCI-DSS, OWASP).`;
  }
  if (style === 'developer_actionable') {
    return `${base} Optimize for engineers: include concrete remediation commands, rotation checklists, and root-cause triage.`;
  }
  return `${base} Be crisp, executive-ready, and high-signal with zero filler.`;
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
      LanguageModel?: { availability?: (opts?: unknown) => Promise<string> };
      ai?: { languageModel?: { capabilities?: () => Promise<{ available: string }> } };
    };
    if (g.LanguageModel?.availability) {
      let rawStatus: string;
      try {
        rawStatus = await g.LanguageModel.availability(NANO_OUTPUT_LANG_OPTIONS);
      } catch {
        rawStatus = await g.LanguageModel.availability();
      }
      const status = rawStatus.toLowerCase();
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
    msg.includes('overloaded') ||
    msg.includes('404') ||
    msg.includes('not found') ||
    msg.includes('not supported') ||
    msg.includes('cloud_ttft_timeout') ||
    msg.includes('timed out')
  );
}

function isOnDeviceInputTooLargeError(err: unknown): boolean {
  const name = err instanceof DOMException ? err.name : '';
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return name === 'QuotaExceededError' || msg.includes('input is too large') || msg.includes('quotaexceeded');
}

function buildOnDeviceParams(systemInstruction: string): OnDeviceParams {
  return {
    createOptions: {
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
      initialPrompts: [
        {
          role: 'system',
          content: [{ type: 'text', value: systemInstruction }],
        },
      ],
    } as OnDeviceParams['createOptions'],
  };
}

function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal, timeoutMs?: number): Promise<T> {
  if (!signal && !timeoutMs) return promise;
  if (signal?.aborted) {
    promise.catch(() => {});
    return Promise.reject(new DOMException('Analysis cancelled by user.', 'AbortError'));
  }
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Analysis cancelled by user.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`CLOUD_TTFT_TIMEOUT: Cloud model did not respond within ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
    }
    promise.then(
      (val) => {
        cleanup();
        resolve(val);
      },
      (err) => {
        cleanup();
        reject(err);
      }
    );
  });
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Analysis cancelled by user.', 'AbortError'));
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Analysis cancelled by user.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function runSingleStream(
  parts: Array<string | Part>,
  modeKey: ModeKey,
  cloudModel: string,
  systemPromptStyle: string,
  started: number,
  useStructuredAudit: boolean,
  nanoAvailable: boolean,
  onChunk?: (partialText: string) => void,
  signal?: AbortSignal
): Promise<HybridResponse> {
  let ttftMs = 0;
  const systemInstruction = getSystemInstruction(systemPromptStyle);

  const model = getGenerativeModel(ai, {
    mode: toInferenceMode(modeKey),
    onDeviceParams: buildOnDeviceParams(systemInstruction),
    inCloudParams: {
      model: cloudModel,
      systemInstruction,
      ...(useStructuredAudit && modeKey !== 'ONLY_ON_DEVICE'
        ? {
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: SECURITY_AUDIT_SCHEMA,
            },
          }
        : {}),
    },
  });

  const primaryCloudTimeoutMs = shouldApplyCloudTtftTimeout(
    modeKey,
    cloudModel,
    FALLBACK_CLOUD_MODEL,
    nanoAvailable
  )
    ? CLOUD_TTFT_TIMEOUT_MS
    : undefined;

  try {
    const streamResult = await raceWithAbort(
      model.generateContentStream(parts),
      signal,
      primaryCloudTimeoutMs
    );
    let accumulated = '';
    let detectedMockEcho = false;
    const iterator = streamResult.stream[Symbol.asyncIterator]();
    while (true) {
      const remainingTtftMs =
        ttftMs === 0 && primaryCloudTimeoutMs
          ? Math.max(500, primaryCloudTimeoutMs - (performance.now() - started))
          : undefined;
      const next = await raceWithAbort(iterator.next(), signal, remainingTtftMs);
      if (next.done) break;
      const chunkText = next.value.text();
      if (chunkText) {
        if (ttftMs === 0) ttftMs = Math.round(performance.now() - started);
        accumulated += chunkText;
        if (!detectedMockEcho && isMockNanoEcho(accumulated)) {
          detectedMockEcho = true;
          onChunk?.('');
        }
        if (!detectedMockEcho && shouldEmitStreamChunk(accumulated, useStructuredAudit)) {
          onChunk?.(accumulated);
        }
      }
    }
    if (signal?.aborted) {
      throw new DOMException('Analysis cancelled by user.', 'AbortError');
    }
    const finalResp = (await raceWithAbort(streamResult.response, signal)) as unknown as {
      text: () => string;
      inferenceSource?: string;
    };
    const rawText = accumulated || finalResp.text();
    const latencyMs = Math.round(performance.now() - started);
    const inferenceSource = detectSource(finalResp.inferenceSource, modeKey);
    const wasMockEcho = detectedMockEcho || isMockNanoEcho(rawText);

    const structuredAudit =
      useStructuredAudit && !wasMockEcho ? parseStructuredAudit(rawText) : null;
    const finalText = structuredAudit ? structuredAuditToMarkdown(structuredAudit) : rawText;

    const sanitized = sanitizeNanoResult({
      text: finalText,
      inferenceSource,
      latencyMs,
      ttftMs: ttftMs || latencyMs,
      modelUsed: inferenceSource === 'ON_DEVICE' ? 'Gemini Nano (On-Device)' : `${cloudModel} (Cloud)`,
      wasMockEcho,
      structuredAudit,
    });
    onChunk?.(sanitized.text);
    return sanitized;
  } catch (streamErr) {
    if (signal?.aborted || (streamErr instanceof DOMException && streamErr.name === 'AbortError')) {
      throw streamErr;
    }
    if (isRateLimitOrTransientError(streamErr) || isOnDeviceInputTooLargeError(streamErr)) {
      throw streamErr;
    }
    const fallbackModel = getGenerativeModel(ai, {
      mode: toInferenceMode(modeKey),
      onDeviceParams: buildOnDeviceParams(systemInstruction),
      inCloudParams: {
        model: cloudModel,
        systemInstruction,
      },
    });
    const result = await raceWithAbort(fallbackModel.generateContent(parts), signal);
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
    const wasMockEcho = isMockNanoEcho(text);
    if (!text && streamErr) throw streamErr;
    const sanitized = sanitizeNanoResult({
      text,
      inferenceSource,
      latencyMs,
      ttftMs: latencyMs,
      modelUsed: inferenceSource === 'ON_DEVICE' ? 'Gemini Nano (On-Device)' : `${cloudModel} (Cloud)`,
      wasMockEcho,
      structuredAudit: null,
    });
    onChunk?.(sanitized.text);
    return sanitized;
  }
}

export async function generateHybridStream(
  prompt: string,
  modeKey: ModeKey,
  cloudModel = 'gemini-3.6-flash',
  image: AttachedImage | null = null,
  onChunk?: (partialText: string) => void,
  signal?: AbortSignal,
  systemPromptStyle = 'concise_executive',
  useStructuredAudit = false,
  nanoAvailable = false
): Promise<HybridResponse> {
  const { model: activeCloudModel, bypassedToFallback } = resolveEffectiveCloudModel(
    cloudModel,
    FALLBACK_CLOUD_MODEL,
    modeKey,
    stalledCloudModels
  );

  const cacheKey = makeCacheKey(
    prompt,
    modeKey,
    activeCloudModel,
    systemPromptStyle,
    useStructuredAudit,
    image
  );
  const cached = responseCache.get(cacheKey);
  if (cached && shouldCacheHybridResponse(cached)) {
    onChunk?.(cached.text);
    return { ...cached, latencyMs: 1, ttftMs: 1, cached: true };
  }

  const started = performance.now();
  const isStrictOffline = modeKey === 'ONLY_ON_DEVICE';
  const effectivePrompt = isStrictOffline
    ? `${prompt.slice(0, 3200)}${
        image
          ? `\n\n[Locally redacted image attached in RAM: ${image.name} — analyzed offline on text summary only]`
          : ''
      }`
    : prompt;
  const parts: Array<string | Part> = [effectivePrompt];
  if (image && !isStrictOffline) {
    parts.push({
      type: 'inlineData',
      inlineData: {
        mimeType: image.mimeType,
        data: image.base64Data,
      },
    });
  }

  const storeInCache = (entry: HybridResponse) => {
    if (!shouldCacheHybridResponse(entry)) return;
    if (responseCache.size >= MAX_CACHE_ENTRIES) {
      const firstKey = responseCache.keys().next().value;
      if (firstKey) responseCache.delete(firstKey);
    }
    responseCache.set(cacheKey, entry);
  };

  const primaryAttemptMode: ModeKey =
    modeKey === 'PREFER_IN_CLOUD' && activeCloudModel !== FALLBACK_CLOUD_MODEL
      ? 'ONLY_IN_CLOUD'
      : modeKey;

  try {
    const res = await runSingleStream(
      parts,
      primaryAttemptMode,
      activeCloudModel,
      systemPromptStyle,
      started,
      useStructuredAudit,
      nanoAvailable,
      onChunk,
      signal
    );
    const finalRes: HybridResponse =
      bypassedToFallback && res.inferenceSource !== 'ON_DEVICE'
        ? { ...res, fallbackUsed: true, fallbackReason: 'cooldown_bypass' }
        : { ...res, fallbackUsed: false, fallbackReason: null };
    storeInCache(finalRes);
    return finalRes;
  } catch (err) {
    if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
      throw err;
    }
    if (isStrictOffline && isOnDeviceInputTooLargeError(err)) {
      for (const maxLen of [1100, 550]) {
        try {
          const compactPrompt = `${prompt.slice(0, maxLen)}\n[Excerpted locally for on-device context limit]`;
          const compactRes = await runSingleStream(
            [compactPrompt],
            modeKey,
            activeCloudModel,
            systemPromptStyle,
            started,
            false,
            nanoAvailable,
            onChunk,
            signal
          );
          storeInCache(compactRes);
          return compactRes;
        } catch (retryErr) {
          if (
            signal?.aborted ||
            (retryErr instanceof DOMException && retryErr.name === 'AbortError') ||
            !isOnDeviceInputTooLargeError(retryErr)
          ) {
            throw retryErr;
          }
        }
      }
    }
    if (
      isRateLimitOrTransientError(err) &&
      activeCloudModel !== FALLBACK_CLOUD_MODEL &&
      modeKey !== 'ONLY_ON_DEVICE'
    ) {
      const isTimeout = err instanceof Error && err.message.includes('CLOUD_TTFT_TIMEOUT');
      markCloudModelStalled(stalledCloudModels, activeCloudModel);
      if (!isTimeout) {
        await sleepWithAbort(300, signal);
      }
      const fallbackRes = await runSingleStream(
        parts,
        modeKey,
        FALLBACK_CLOUD_MODEL,
        systemPromptStyle,
        started,
        useStructuredAudit,
        nanoAvailable,
        onChunk,
        signal
      );
      const taggedFallback: HybridResponse = {
        ...fallbackRes,
        fallbackUsed: true,
        fallbackReason: isTimeout ? 'ttft_timeout' : 'rate_limit',
      };
      return taggedFallback;
    }
    if (isRateLimitOrTransientError(err)) {
      throw new Error(
        'Cloud AI is temporarily busy (free-tier rate limit reached by concurrent users). Please wait a few seconds or switch to Strict Offline mode.'
      );
    }
    throw err;
  }
}

export async function generateFollowUpStream(
  redactedDoc: string,
  previousAnalysis: string,
  history: FollowUpMessage[],
  redactedQuestion: string,
  modeKey: ModeKey,
  cloudModel = 'gemini-3.6-flash',
  systemPromptStyle = 'concise_executive',
  onChunk?: (partialText: string) => void,
  signal?: AbortSignal,
  nanoAvailable = false
): Promise<HybridResponse> {
  const transcript = history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
    .join('\n\n');

  const prompt = [
    'Continue answering questions about the anonymized document below. Preserve all bracketed tokens like [SECRET_1], [PERSON_1], [EMAIL_1] exactly.',
    `\n--- ANONYMIZED DOCUMENT ---\n${redactedDoc.slice(0, 4000)}`,
    `\n--- INITIAL ANALYSIS ---\n${previousAnalysis.slice(0, 2500)}`,
    transcript ? `\n--- RECENT FOLLOW-UPS ---\n${transcript}` : '',
    `\n--- USER QUESTION ---\n${redactedQuestion}`,
  ]
    .filter(Boolean)
    .join('\n');

  return generateHybridStream(
    prompt,
    modeKey,
    cloudModel,
    null,
    onChunk,
    signal,
    systemPromptStyle,
    false,
    nanoAvailable
  );
}

export function createOnDeviceNanoModel() {
  return getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: {
      createOptions: {
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      } as OnDeviceParams['createOptions'],
    },
  });
}
