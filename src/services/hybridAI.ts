import { getGenerativeModel, InferenceMode } from 'firebase/ai';
import { ai } from '../firebase';

export type ModeKey = 'PREFER_ON_DEVICE' | 'ONLY_ON_DEVICE' | 'PREFER_IN_CLOUD' | 'ONLY_IN_CLOUD';

export type NanoAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

export interface HybridResponse {
  text: string;
  inferenceSource: 'ON_DEVICE' | 'IN_CLOUD' | 'UNKNOWN';
  latencyMs: number;
  modelUsed: string;
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

export async function generateHybrid(
  prompt: string,
  modeKey: ModeKey,
  cloudModel = 'gemini-2.5-flash'
): Promise<HybridResponse> {
  const started = performance.now();
  const model = getGenerativeModel(ai, {
    model: cloudModel,
    mode: toInferenceMode(modeKey),
  });

  const result = await model.generateContent(prompt);
  const latencyMs = Math.round(performance.now() - started);
  const response = result.response as unknown as {
    text: () => string;
    inferenceSource?: string;
  };

  const rawSource = (response.inferenceSource || '').toUpperCase();
  const inferenceSource: HybridResponse['inferenceSource'] =
    rawSource.includes('ON_DEVICE')
      ? 'ON_DEVICE'
      : rawSource.includes('IN_CLOUD')
        ? 'IN_CLOUD'
        : modeKey === 'ONLY_ON_DEVICE'
          ? 'ON_DEVICE'
          : 'IN_CLOUD';

  return {
    text: response.text(),
    inferenceSource,
    latencyMs,
    modelUsed: inferenceSource === 'ON_DEVICE' ? 'Gemini Nano (On-Device)' : `${cloudModel} (Cloud)`,
  };
}

/**
 * Stage 1 (On-Device): Ask Gemini Nano to find person names / company names / sensitive entities
 * strictly on-device (returns empty list if on-device model is unavailable so raw PII never leaks!).
 */
export async function detectEntitiesOnDevice(rawText: string): Promise<{
  entities: string[];
  usedOnDeviceAI: boolean;
  latencyMs: number;
}> {
  const started = performance.now();
  try {
    const res = await generateHybrid(
      `Extract ONLY proper names of people, street addresses, and private company names from the text below. Return a plain comma-separated list with no explanation. If none, return NONE.\n\nText:\n${rawText.slice(0, 1500)}`,
      'ONLY_ON_DEVICE'
    );
    const cleaned = res.text.trim();
    if (
      !cleaned ||
      cleaned.toUpperCase() === 'NONE' ||
      /not available|echoing back/i.test(cleaned)
    ) {
      return { entities: [], usedOnDeviceAI: false, latencyMs: res.latencyMs };
    }
    const entities = cleaned
      .split(/[,\n]+/)
      .map((s) => s.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter((s) => s.length >= 3 && s.length <= 45 && !s.includes(':') && s.split(/\s+/).length <= 4);
    return { entities, usedOnDeviceAI: true, latencyMs: res.latencyMs };
  } catch {
    return {
      entities: [],
      usedOnDeviceAI: false,
      latencyMs: Math.round(performance.now() - started),
    };
  }
}

export type AnalysisTask = 'executive' | 'risk_audit' | 'action_plan' | 'quick_offline';

export function buildTaskPrompt(redactedText: string, task: AnalysisTask): string {
  const keepTokensRule =
    'IMPORTANT: Preserve all bracketed placeholders exactly as written (e.g., [EMAIL_1], [PERSON_1], [SECRET_1], [CARD_1]) without modifying or guessing their values.';

  switch (task) {
    case 'quick_offline':
      return `${keepTokensRule}\nGive a crisp 3-bullet summary and 1-sentence tone assessment of the following anonymized note:\n\n${redactedText}`;
    case 'risk_audit':
      return `${keepTokensRule}\nYou are a Senior Security & Legal Auditor. Analyze this anonymized document and output:\n1. **Risk Level** (Low / Medium / High / Critical)\n2. **Top 3 Compliance or Security Risks** (bullet points)\n3. **Immediate Remediation Steps** (numbered list)\n\nDocument:\n${redactedText}`;
    case 'action_plan':
      return `${keepTokensRule}\nExtract a clear, prioritized Action Plan from this anonymized document:\n1. **Urgent Next Steps (24h)**\n2. **Owners & Deliverables** (referencing the exact placeholders)\n3. **Follow-up Checklist**\n\nDocument:\n${redactedText}`;
    case 'executive':
    default:
      return `${keepTokensRule}\nProvide a concise Executive Brief of this anonymized document with:\n1. **TL;DR (2 sentences)**\n2. **Key Facts & Decisions** (3-4 bullets)\n3. **Recommended Next Action**\n\nDocument:\n${redactedText}`;
  }
}
