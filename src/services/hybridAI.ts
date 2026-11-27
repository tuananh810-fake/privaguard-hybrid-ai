import { getGenerativeModel, InferenceMode, Part, Schema } from 'firebase/ai';
import { ai } from '../firebase';
import {
  AnalysisTask,
  buildTaskPrompt,
  extractRiskBanner,
  ParsedRiskBanner,
  parseStructuredAudit,
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
const MAX_CACHE_ENTRIES = 24;
const responseCache = new Map<string, HybridResponse>();

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
  cloudModel: string,
  style: string,
  useStructured: boolean,
  image: AttachedImage | null
): string {
  const imgSig = image ? `${image.name}:${image.base64Data.length}` : 'no-img';
  return `${modeKey}|${cloudModel}|${style}|${useStructured ? 'json' : 'md'}|${imgSig}|${prompt}`;
}

function getSystemInstruction(style = 'concise_executive'): string {
  const base =
    'You are PrivaGuard AI, a privacy-first security & document intelligence analyst. ' +
    'ALWAYS preserve bracketed privacy tokens (such as [SECRET_1], [EMAIL_1], [PERSON_1], [CARD_1], [ID_1], [PHONE_1], [IP_1]) verbatim. ' +
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
    msg.includes('overloaded') ||
    msg.includes('404') ||
    msg.includes('not found') ||
    msg.includes('not supported')
  );
}

async function runSingleStream(
  parts: Array<string | Part>,
  modeKey: ModeKey,
  cloudModel: string,
  systemPromptStyle: string,
  started: number,
  useStructuredAudit: boolean,
  onChunk?: (partialText: string) => void,
  signal?: AbortSignal
): Promise<HybridResponse> {
  let ttftMs = 0;

  const model = getGenerativeModel(ai, {
    mode: toInferenceMode(modeKey),
    inCloudParams: {
      model: cloudModel,
      systemInstruction: getSystemInstruction(systemPromptStyle),
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
        if (!useStructuredAudit) {
          onChunk?.(accumulated);
        }
      }
    }
    if (signal?.aborted) {
      throw new DOMException('Analysis cancelled by user.', 'AbortError');
    }
    const finalResp = (await streamResult.response) as unknown as {
      text: () => string;
      inferenceSource?: string;
    };
    const rawText = accumulated || finalResp.text();
    const latencyMs = Math.round(performance.now() - started);
    const inferenceSource = detectSource(finalResp.inferenceSource, modeKey);
    const wasMockEcho = /not available in chromium|echoing back/i.test(rawText);

    const structuredAudit =
      useStructuredAudit && !wasMockEcho ? parseStructuredAudit(rawText) : null;
    const finalText = structuredAudit ? structuredAuditToMarkdown(structuredAudit) : rawText;
    onChunk?.(finalText);

    return {
      text: finalText,
      inferenceSource,
      latencyMs,
      ttftMs: ttftMs || latencyMs,
      modelUsed: inferenceSource === 'ON_DEVICE' ? 'Gemini Nano (On-Device)' : `${cloudModel} (Cloud)`,
      wasMockEcho,
      structuredAudit,
    };
  } catch (streamErr) {
    if (signal?.aborted || (streamErr instanceof DOMException && streamErr.name === 'AbortError')) {
      throw streamErr;
    }
    if (isRateLimitOrTransientError(streamErr)) {
      throw streamErr;
    }
    const fallbackModel = getGenerativeModel(ai, {
      mode: toInferenceMode(modeKey),
      inCloudParams: {
        model: cloudModel,
        systemInstruction: getSystemInstruction(systemPromptStyle),
      },
    });
    const result = await fallbackModel.generateContent(parts);
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
      structuredAudit: null,
    };
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
  useStructuredAudit = false
): Promise<HybridResponse> {
  const cacheKey = makeCacheKey(prompt, modeKey, cloudModel, systemPromptStyle, useStructuredAudit, image);
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
    const res = await runSingleStream(
      parts,
      modeKey,
      cloudModel,
      systemPromptStyle,
      started,
      useStructuredAudit,
      onChunk,
      signal
    );
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
    if (
      isRateLimitOrTransientError(err) &&
      cloudModel !== FALLBACK_CLOUD_MODEL &&
      modeKey !== 'ONLY_ON_DEVICE'
    ) {
      await new Promise((r) => setTimeout(r, 600));
      if (signal?.aborted) throw new DOMException('Analysis cancelled by user.', 'AbortError');
      const fallbackRes = await runSingleStream(
        parts,
        modeKey,
        FALLBACK_CLOUD_MODEL,
        systemPromptStyle,
        started,
        useStructuredAudit,
        onChunk,
        signal
      );
      return { ...fallbackRes, fallbackUsed: true };
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
  signal?: AbortSignal
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
    false
  );
}

export function createOnDeviceNanoModel() {
  return getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
  });
}

export async function detectEntitiesOnDevice(rawText: string): Promise<{
  entities: string[];
  usedOnDeviceAI: boolean;
  latencyMs: number;
}> {
  const started = performance.now();
  try {
    const model = createOnDeviceNanoModel();

    const chunkSize = 1500;
    const overlap = 150;
    const chunks: string[] = [];
    for (let pos = 0; pos < rawText.length && chunks.length < 3; pos += chunkSize - overlap) {
      chunks.push(rawText.slice(pos, pos + chunkSize));
      if (pos + chunkSize >= rawText.length) break;
    }

    const found = new Set<string>();
    let anyRealAI = false;

    for (const chunk of chunks) {
      const res = await model.generateContent(
        `Extract ONLY proper names of people, street addresses, and private company names from the text below. Return a plain comma-separated list with no explanation. If none, return NONE.\n\nText:\n${chunk}`
      );
      const cleaned = res.response.text().trim();
      if (
        !cleaned ||
        cleaned.toUpperCase() === 'NONE' ||
        /not available|echoing back/i.test(cleaned)
      ) {
        continue;
      }
      anyRealAI = true;
      cleaned
        .split(/[,\n]+/)
        .map((s) => s.replace(/^[-*•\d.)\s]+/, '').trim())
        .filter((s) => s.length >= 3 && s.length <= 45 && !s.includes(':') && s.split(/\s+/).length <= 4)
        .forEach((e) => found.add(e));
    }

    return {
      entities: Array.from(found),
      usedOnDeviceAI: anyRealAI,
      latencyMs: Math.round(performance.now() - started),
    };
  } catch {
    return {
      entities: [],
      usedOnDeviceAI: false,
      latencyMs: Math.round(performance.now() - started),
    };
  }
}
