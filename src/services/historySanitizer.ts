export type ValidInferenceSource = 'ON_DEVICE' | 'IN_CLOUD' | 'UNKNOWN';

export interface AnalysisPayloadInput {
  task?: unknown;
  inferenceSource?: unknown;
  modelUsed?: unknown;
  latencyMs?: unknown;
  ttftMs?: unknown;
  piiCount?: unknown;
  bytesShielded?: unknown;
  redactedPreview?: unknown;
  analysisText?: unknown;
}

export interface SanitizedAnalysisPayload {
  task: string;
  inferenceSource: ValidInferenceSource;
  modelUsed: string;
  latencyMs: number;
  ttftMs: number;
  piiCount: number;
  bytesShielded: number;
  redactedPreview: string;
  analysisText: string;
}

const VALID_INFERENCE_SOURCES = new Set<ValidInferenceSource>(['ON_DEVICE', 'IN_CLOUD', 'UNKNOWN']);

function clampFiniteNumber(val: unknown, min: number, max: number, fallback: number): number {
  const num = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function clampInt(val: unknown, min: number, max: number, fallback = 0): number {
  const num = clampFiniteNumber(val, min, max, fallback);
  return Math.min(max, Math.max(min, Math.round(num)));
}

function truncateString(val: unknown, maxLen: number, fallback = ''): string {
  const str = typeof val === 'string' ? val : fallback;
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

/**
 * Pure sanitizer ensuring every client save strictly satisfies firestore.rules
 * field bounds and enums so valid saves never hit spurious permission-denied errors.
 */
export function sanitizeAnalysisPayload(input: AnalysisPayloadInput): SanitizedAnalysisPayload {
  const rawTask = typeof input.task === 'string' ? input.task.trim() : '';
  const task = (rawTask || 'executive').slice(0, 40);

  const rawSource = typeof input.inferenceSource === 'string' ? input.inferenceSource.trim() : '';
  const inferenceSource: ValidInferenceSource = VALID_INFERENCE_SOURCES.has(
    rawSource as ValidInferenceSource
  )
    ? (rawSource as ValidInferenceSource)
    : 'UNKNOWN';

  const modelUsed = truncateString(input.modelUsed, 100);
  const latencyMs = clampFiniteNumber(input.latencyMs, 0, 600_000, 0);
  const ttftMs =
    input.ttftMs === undefined || input.ttftMs === null
      ? latencyMs
      : clampFiniteNumber(input.ttftMs, 0, 600_000, latencyMs);
  const piiCount = clampInt(input.piiCount, 0, 5_000, 0);
  const bytesShielded = clampInt(input.bytesShielded, 0, 1_000_000, 0);
  const redactedPreview = truncateString(input.redactedPreview, 500);
  const analysisText = truncateString(input.analysisText, 30_000);

  return {
    task,
    inferenceSource,
    modelUsed,
    latencyMs,
    ttftMs,
    piiCount,
    bytesShielded,
    redactedPreview,
    analysisText,
  };
}
