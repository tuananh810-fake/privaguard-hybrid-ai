export type AnalysisTask = 'executive' | 'risk_audit' | 'action_plan' | 'quick_offline';

export const CLOUD_TTFT_TIMEOUT_MS = 12_000;
export const STALLED_MODEL_COOLDOWN_MS = 90_000;

export function markCloudModelStalled(
  stalledModels: Map<string, number>,
  model: string,
  now = Date.now()
): void {
  stalledModels.set(model, now);
}

export function clearStalledCloudModel(
  stalledModels: Map<string, number>,
  model?: string
): void {
  if (model) {
    stalledModels.delete(model);
  } else {
    stalledModels.clear();
  }
}

export function buildResponseCacheKey(
  prompt: string,
  modeKey: string,
  effectiveCloudModel: string,
  style: string,
  useStructured: boolean,
  imgSig: string
): string {
  return `${modeKey}|${effectiveCloudModel}|${style}|${useStructured ? 'json' : 'md'}|${imgSig}|${prompt}`;
}

export function shouldCacheHybridResponse(entry: {
  wasMockEcho?: boolean;
  nanoUnavailable?: boolean;
  fallbackUsed?: boolean;
}): boolean {
  return !entry.wasMockEcho && !entry.nanoUnavailable && !entry.fallbackUsed;
}

export function isCloudModelCoolingDown(
  stalledModels: Map<string, number>,
  model: string,
  ttlMs = STALLED_MODEL_COOLDOWN_MS,
  now = Date.now()
): boolean {
  const stalledAt = stalledModels.get(model);
  if (stalledAt === undefined) return false;
  if (now - stalledAt < ttlMs) return true;
  stalledModels.delete(model);
  return false;
}

export function shouldApplyCloudTtftTimeout(
  modeKey: string,
  cloudModel: string,
  fallbackModel: string,
  nanoAvailable: boolean
): boolean {
  if (cloudModel === fallbackModel || modeKey === 'ONLY_ON_DEVICE') {
    return false;
  }
  return (
    modeKey === 'PREFER_IN_CLOUD' ||
    modeKey === 'ONLY_IN_CLOUD' ||
    (modeKey === 'PREFER_ON_DEVICE' && !nanoAvailable)
  );
}

const MOCK_NANO_ECHO_REGEX = /on-device model is not available in chromium|this api is just echoing back|not available in chromium.*echoing back/i;
const MOCK_NANO_ECHO_PREFIX = 'on-device model is not available in chromium';

export function isMockNanoEcho(text: string): boolean {
  if (!text) return false;
  return MOCK_NANO_ECHO_REGEX.test(text);
}

export function isPossibleMockNanoEchoPrefix(text: string): boolean {
  const trimmed = text.trimStart().toLowerCase();
  if (!trimmed) return false;
  if (MOCK_NANO_ECHO_REGEX.test(trimmed)) return true;
  return trimmed.length < MOCK_NANO_ECHO_PREFIX.length && MOCK_NANO_ECHO_PREFIX.startsWith(trimmed);
}

export function sanitizeNanoResult<
  T extends {
    text: string;
    inferenceSource: 'ON_DEVICE' | 'IN_CLOUD' | 'UNKNOWN';
    latencyMs: number;
    ttftMs: number;
    modelUsed: string;
    wasMockEcho?: boolean;
    nanoUnavailable?: boolean;
    structuredAudit?: StructuredAuditReport | null;
  },
>(res: T): T {
  const unavailable = Boolean(res.nanoUnavailable || res.wasMockEcho || isMockNanoEcho(res.text));
  if (!unavailable) {
    return {
      ...res,
      wasMockEcho: false,
      nanoUnavailable: false,
    };
  }
  return {
    ...res,
    text: '',
    inferenceSource: 'UNKNOWN',
    latencyMs: 0,
    ttftMs: 0,
    modelUsed: 'Gemini Nano (Unavailable)',
    wasMockEcho: true,
    nanoUnavailable: true,
    structuredAudit: null,
  };
}

export function shouldEmitStreamChunk(accumulated: string, useStructuredAudit: boolean): boolean {
  if (isPossibleMockNanoEchoPrefix(accumulated)) return false;
  if (!useStructuredAudit) return true;
  const trimmed = accumulated.trimStart();
  if (!trimmed) return false;
  return !trimmed.startsWith('{') && !trimmed.startsWith('```');
}

export function resolveEffectiveCloudModel(
  requestedModel: string,
  fallbackModel: string,
  modeKey: string,
  stalledModels: Map<string, number>,
  now = Date.now(),
  ttlMs = STALLED_MODEL_COOLDOWN_MS
): { model: string; bypassedToFallback: boolean } {
  if (
    modeKey !== 'ONLY_ON_DEVICE' &&
    requestedModel !== fallbackModel &&
    isCloudModelCoolingDown(stalledModels, requestedModel, ttlMs, now)
  ) {
    return { model: fallbackModel, bypassedToFallback: true };
  }
  return { model: requestedModel, bypassedToFallback: false };
}

export interface StructuredFinding {
  title: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  detail: string;
}

export interface StructuredRemediation {
  step: string;
  priority: 'IMMEDIATE' | 'SHORT_TERM' | 'LONG_TERM';
}

export interface StructuredAuditReport {
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  riskScore: number;
  summary: string;
  complianceFrameworks: string[];
  findings: StructuredFinding[];
  remediations: StructuredRemediation[];
}

export interface ParsedRiskBanner {
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  summary: string;
}

export function parseStructuredAudit(rawJson: string): StructuredAuditReport | null {
  try {
    const cleaned = rawJson
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned) as Partial<StructuredAuditReport>;
    if (
      !parsed ||
      typeof parsed.summary !== 'string' ||
      !Array.isArray(parsed.findings) ||
      !Array.isArray(parsed.remediations)
    ) {
      return null;
    }
    const level = String(parsed.riskLevel || 'MEDIUM').toUpperCase();
    const riskLevel = (
      ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(level) ? level : 'MEDIUM'
    ) as StructuredAuditReport['riskLevel'];
    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.riskScore ?? 50))));
    return {
      riskLevel,
      riskScore: score,
      summary: parsed.summary,
      complianceFrameworks: Array.isArray(parsed.complianceFrameworks)
        ? parsed.complianceFrameworks.map(String).slice(0, 6)
        : [],
      findings: parsed.findings.slice(0, 8).map((f) => ({
        title: String(f.title || 'Finding'),
        severity: (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(String(f.severity).toUpperCase())
          ? String(f.severity).toUpperCase()
          : 'MEDIUM') as StructuredFinding['severity'],
        detail: String(f.detail || ''),
      })),
      remediations: parsed.remediations.slice(0, 8).map((r) => ({
        step: String(r.step || ''),
        priority: (['IMMEDIATE', 'SHORT_TERM', 'LONG_TERM'].includes(
          String(r.priority).toUpperCase()
        )
          ? String(r.priority).toUpperCase()
          : 'IMMEDIATE') as StructuredRemediation['priority'],
      })),
    };
  } catch {
    return null;
  }
}

export function structuredAuditToMarkdown(report: StructuredAuditReport): string {
  const frameworks =
    report.complianceFrameworks.length > 0
      ? `\n**Compliance Frameworks:** ${report.complianceFrameworks.join(', ')}\n`
      : '';
  const findingsMd = report.findings
    .map((f) => `- **[${f.severity}] ${f.title}:** ${f.detail}`)
    .join('\n');
  const remMd = report.remediations
    .map((r, i) => `${i + 1}. **[${r.priority}]** ${r.step}`)
    .join('\n');

  return [
    `### Risk Level`,
    `**${report.riskLevel}** (Score: ${report.riskScore}/100) — ${report.summary}`,
    frameworks,
    `### Top Security & Compliance Findings`,
    findingsMd,
    `\n### Immediate Remediation Checklist`,
    remMd,
  ]
    .filter(Boolean)
    .join('\n');
}

export function extractRiskBanner(markdown: string): ParsedRiskBanner | null {
  const match = markdown.match(
    /(?:###\s*Risk Level[\s\S]{0,40}?|\*\*Risk Level\*\*[:\s]*)\b(Critical|High|Medium|Low)\b([^\n]*)/i
  );
  if (!match) return null;
  const level = match[1].toUpperCase() as ParsedRiskBanner['level'];
  const summary = match[2].replace(/^[\s:—–-]+/, '').trim();
  return { level, summary };
}

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
      return `${keepTokensRule}${imageHint}\nYou are a Senior Security & Legal Auditor. Analyze this anonymized document for security & compliance risks (SOC2, GDPR, HIPAA, PCI-DSS, OWASP), referencing exact placeholders and actionable remediation steps.\n\nDocument:\n${redactedText}`;
    case 'action_plan':
      return `${keepTokensRule}${imageHint}\nExtract a prioritized Action Plan in Markdown from this anonymized document:\n### Urgent Next Steps (24h)\n### Owners & Deliverables\n### Follow-up Checklist\n\nDocument:\n${redactedText}`;
    case 'executive':
    default:
      return `${keepTokensRule}${imageHint}\nProvide a concise Executive Brief in Markdown of this anonymized document:\n### TL;DR\n### Key Facts & Decisions\n### Recommended Next Action\n\nDocument:\n${redactedText}`;
  }
}
