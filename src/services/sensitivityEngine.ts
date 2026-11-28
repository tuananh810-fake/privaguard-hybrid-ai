import {
  countVaultBySource,
  DEFAULT_CATEGORY_FILTER,
  redactLocally,
  verifyZeroLeak,
  type CategoryBreakdown,
  type CategoryFilter,
  type PiiCategory,
  type RedactionResult,
  type SensitiveTermInput,
  type SourceCounts,
  type VaultEntry,
} from './piiVault.ts';

export type SensitivityDecision = 'MASK_REQUIRED' | 'MASK_SUGGESTED' | 'KEEP_SAFE_CONTEXT';

export type DocumentContextKind =
  | 'SENSITIVE_REAL'
  | 'EDUCATIONAL_SYNTHETIC'
  | 'MIXED_HYBRID'
  | 'CLEAN';

export interface ClassifiedEntity extends VaultEntry {
  decision: SensitivityDecision;
  confidence: number; // 0.0 (definitely benign) -> 1.0 (definitely sensitive)
  reason: string;
  isHardSecret: boolean;
}

export interface ContextGuardOptions {
  extraSensitiveTerms?: SensitiveTermInput[];
  enabledCategories?: CategoryFilter;
  smartContextGuard?: boolean;
  existingVault?: VaultEntry[];
  /** Explicit originals forced to mask or keep safe by user override */
  forceMaskOriginals?: string[];
  forceKeepOriginals?: string[];
  /** Session-scoped user-whitelisted exact values (case-insensitive) */
  ignoredValues?: string[];
}

export interface ContextGuardAnalysis {
  contextKind: DocumentContextKind;
  entities: ClassifiedEntity[];
  maskedByDefault: ClassifiedEntity[];
  keptSafeByContext: ClassifiedEntity[];
  ambiguousEntities: ClassifiedEntity[];
  redactedText: string;
  activeVault: VaultEntry[];
  bytesShielded: number;
  leaksFound: number;
  sourceCounts: SourceCounts;
  summaryLabel: string;
  analysisTimeMs: number;
}

export interface NanoAdjudicationResult {
  entities: ClassifiedEntity[];
  usedNano: boolean;
  cached: boolean;
  timedOut: boolean;
  latencyMs: number;
}

const TEXT_ENCODER = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

// ---------------------------------------------------------------------------
// Tier 0: Deterministic Structural, Cryptographic & Standard Benign Validators
// ---------------------------------------------------------------------------

const KNOWN_TEST_CARDS = new Set([
  '4242424242424242',
  '4000000000000002',
  '4000056655665556',
  '4012888888881881',
  '4111111111111111',
  '5555555555554444',
  '5105105105105100',
  '5200828282828210',
  '378282246310005',
  '371449635398431',
  '6011111111111117',
  '6011000990139424',
  '3530111333300000',
  '1234567812345678',
  '0000000000000000',
]);

const BENIGN_EMAIL_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'example.edu',
  'example.vn',
  'localhost',
  'test.local',
  'invalid',
  'domain.com',
  'yourdomain.com',
  'sample.com',
  'dummy.com',
  'test.com',
]);

const BENIGN_EMAIL_LOCALS = new Set([
  'user',
  'test',
  'demo',
  'foo',
  'bar',
  'john.doe',
  'jane.doe',
  'name',
  'your.email',
  'email',
  'sample',
  'placeholder',
  'student',
  'alice',
  'bob',
]);

const BENIGN_PLACEHOLDER_NAMES = new Set([
  'john doe',
  'jane doe',
  'john smith',
  'jane smith',
  'alice',
  'bob',
  'charlie',
  'nguyen van a',
  'nguyễn văn a',
  'tran thi b',
  'trần thị b',
  'le van c',
  'lê văn c',
  'abc corp',
  'xyz corp',
  'example inc',
  'example corp',
  'acme example',
]);

const PLACEHOLDER_SECRET_STEM =
  /(?:example|sample|dummy|mock|fake|placeholder|your[_-]|replace[_-]?me|changeme|test[_-]?key|demo[_-]?key|12345678|abcdef12|00000000|xxxxxxxx)/i;

const EXPLICIT_TEST_SECRET_PREFIX = /^(?:sk_test_|pk_test_|sk-test-)/i;

const DUMMY_DB_URI_PATTERN =
  /^(?:postgres|postgresql|mongodb(?:\+srv)?|mysql|redis):\/\/(?:(?:user|root|admin|postgres|mysql|mongo|demo|test|guest):(?:pass|password|secret|root|admin|postgres|demo|test|1234|123456)@)?(?:localhost|127\.0\.0\.1|example\.com|db\.example\.org|host|myhost)(?::\d+)?/i;

/**
 * Standard Luhn mod-10 checksum validation for payment cards (13-19 digits).
 */
export function isValidLuhn(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  if (/^(\d)\1+$/.test(digits)) return false;

  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (shouldDouble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

export function isKnownTestCard(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (KNOWN_TEST_CARDS.has(digits)) return true;
  if (digits.length >= 13 && /^(\d)\1+$/.test(digits)) return true;
  return false;
}

/**
 * Computes Shannon entropy (bits per character) to distinguish high-entropy live secrets
 * from low-entropy placeholders or repeated dummy strings.
 */
export function computeShannonEntropy(value: string): number {
  if (!value) return 0;
  const freq = new Map<string, number>();
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    freq.set(ch, (freq.get(ch) || 0) + 1);
  }
  const len = value.length;
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return Number(entropy.toFixed(3));
}

function extractSecretPayload(raw: string): string {
  return raw
    .replace(/^Bearer\s+/i, '')
    .replace(/^(?:AIza|sk-proj-|sk-live-|sk-test-|sk_|pk_|ghp_|gho_|ghu_|xox[baprs]-|AKIA)/i, '');
}

export function isPlaceholderSecret(raw: string): boolean {
  const trimmed = raw.trim();
  if (/^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i.test(trimmed)) {
    return /(?:EXAMPLE|DUMMY|FAKE|PLACEHOLDER|SAMPLE)/i.test(trimmed);
  }
  if (EXPLICIT_TEST_SECRET_PREFIX.test(trimmed)) return true;
  if (DUMMY_DB_URI_PATTERN.test(trimmed)) return true;
  if (PLACEHOLDER_SECRET_STEM.test(trimmed)) return true;

  // Check payload entropy for token/key secrets (skip DB URIs & JWTs which have structured delimiters)
  if (!trimmed.includes('://') && !trimmed.startsWith('eyJ')) {
    const payload = extractSecretPayload(trimmed);
    if (payload.length >= 12 && computeShannonEntropy(payload) < 2.95) {
      return true;
    }
  }
  return false;
}

export type IpClassification =
  | 'LOOPBACK_MASK_DNS'
  | 'BENCHMARK_DOC'
  | 'RFC1918_PRIVATE'
  | 'PUBLIC_IP';

export function classifyIpAddress(raw: string): IpClassification {
  const host = raw.split(':')[0].trim();
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return 'PUBLIC_IP';
  }
  const [a, b, c] = parts;

  // Loopback, unspecified, subnet/wildcard masks, well-known public DNS
  if (
    a === 127 ||
    host === '0.0.0.0' ||
    a === 255 ||
    host === '8.8.8.8' ||
    host === '8.8.4.4' ||
    host === '1.1.1.1' ||
    host === '1.0.0.1' ||
    host === '9.9.9.9'
  ) {
    return 'LOOPBACK_MASK_DNS';
  }

  // IETF RFC 5737 documentation ranges & RFC 2544 benchmark range
  if (
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 198 && (b === 18 || b === 19))
  ) {
    return 'BENCHMARK_DOC';
  }

  // RFC 1918 private & link-local ranges
  if (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  ) {
    return 'RFC1918_PRIVATE';
  }

  return 'PUBLIC_IP';
}

export function isBenignEmail(raw: string): boolean {
  const lower = raw.trim().toLowerCase();
  const at = lower.lastIndexOf('@');
  if (at <= 0) return false;
  const local = lower.slice(0, at);
  const domain = lower.slice(at + 1);
  if (BENIGN_EMAIL_DOMAINS.has(domain)) return true;
  if (domain.endsWith('.example') || domain.endsWith('.invalid') || domain.endsWith('.test')) {
    return true;
  }
  if (BENIGN_EMAIL_LOCALS.has(local) && /(?:example|test|sample|demo|company|domain)\./i.test(domain)) {
    return true;
  }
  return false;
}

export function isBenignPhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (/^(\d)\1{6,}$/.test(digits)) return true;
  if (digits === '0123456789' || digits === '1234567890' || digits === '0000000000') return true;
  // NANP fictional 555-0100 through 555-0199
  if (/^1?\d{3}55501\d{2}$/.test(digits) || /^55501\d{2}$/.test(digits)) return true;
  return false;
}

export function isBenignId(raw: string): boolean {
  const upper = raw.trim().toUpperCase();
  if (
    upper === '123-45-6789' ||
    upper === '000-00-0000' ||
    upper === '111-11-1111' ||
    upper === '999-99-9999' ||
    /^000-\d{2}-\d{4}$/.test(upper)
  ) {
    return true;
  }
  const digits = upper.replace(/\D/g, '');
  if (digits === '000000000000' || digits === '012345678901') return true;
  return false;
}

export function isBenignPlaceholderName(raw: string): boolean {
  return BENIGN_PLACEHOLDER_NAMES.has(raw.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Tier 1: Multi-Domain Windowed Contextual Risk Scorer (< 1 ms, EN + VI)
// ---------------------------------------------------------------------------

interface ContextSignalRule {
  pattern: RegExp;
  weight: number;
  label: string;
}

const BENIGN_CONTEXT_RULES: ContextSignalRule[] = [
  {
    pattern:
      /\b(?:homework|assignment|exercise|problem\s+\d+|question\s+\d+|quiz|exam|textbook|syllabus|worksheet|classwork|lab\s*\d*|solve\s+for|calculate\s+the)\b/gi,
    weight: 2.0,
    label: 'academic exercise',
  },
  {
    pattern:
      /(?:bài\s*tập|bài\s*lab|đề\s*bài|giả\s*sử|cho\s*biết|hãy\s*tính|hướng\s*dẫn\s*giải|ôn\s*tập|giáo\s*trình|thực\s*hành)/gi,
    weight: 2.0,
    label: 'bài tập / thực hành',
  },
  {
    pattern:
      /\b(?:cisco|packet\s*tracer|gns3|ccna|ccnp|ospf|eigrp|bgp|vlan|subnet(?:ting|mask)?|cidr|router\s+r\d+|switch\s+s\d+|interface\s+(?:g|gi|fa|eth)\d|routing\s+table|dhcp\s+pool|nat\s+config|wireshark\s+lab|ip\s+route)\b/gi,
    weight: 2.4,
    label: 'networking lab',
  },
  {
    pattern:
      /\b(?:tutorial|documentation|readme|for\s+example|e\.g\.|mock(?:ed|ing)?|dummy|fixture|unit\s+test|test\s+case|placeholder|sample\s+(?:data|input|output|payload|config|json)|fictional|hypothetical|sandbox|demo\s+only)\b/gi,
    weight: 1.8,
    label: 'tutorial / synthetic sample',
  },
  {
    pattern: /(?:ví\s*dụ|dữ\s*liệu\s*mẫu|mẫu\s*thử|giả\s*lập|mô\s*phỏng|kiểm\s*thử|thử\s*nghiệm)/gi,
    weight: 1.8,
    label: 'dữ liệu mẫu / mô phỏng',
  },
  {
    pattern:
      /\b(?:wikipedia|biography|historical|public\s+figure|textbook\s+case|case\s+study\s+example)\b/gi,
    weight: 1.5,
    label: 'public / reference context',
  },
];

const SENSITIVE_CONTEXT_RULES: ContextSignalRule[] = [
  {
    pattern:
      /\b(?:production|prod\b|incident|outage|post-?mortem|breach|leaked|compromised|key\s+rotation|firewall\s+lock|staging\s+config|live\s+server|upstream)\b/gi,
    weight: 2.2,
    label: 'production / incident',
  },
  {
    pattern:
      /\b(?:confidential|nda|non-?disclosure|addendum|contractor|payout|invoice|payroll|salary|bank\s+account|wire\s+transfer|patient|mrn|diagnosis|prescription|hipaa|gdpr|soc2|pci-?dss|internal\s+only|do\s+not\s+share)\b/gi,
    weight: 2.2,
    label: 'confidential / regulated doc',
  },
  {
    pattern:
      /(?:sự\s*cố|rò\s*rỉ|bảo\s*mật|tối\s*mật|nội\s*bộ|hợp\s*đồng|khách\s*hàng|nhân\s*viên|bảng\s*lương|thanh\s*toán|chuyển\s*khoản|bệnh\s*nhân|hồ\s*sơ\s*y\s*tế|bệnh\s*án|căn\s*cước|không\s*được\s*chia\s*sẻ)/gi,
    weight: 2.2,
    label: 'tài liệu nội bộ / nhạy cảm',
  },
];

interface ContextScores {
  benignScore: number;
  sensitiveScore: number;
  topBenignLabel: string | null;
  topSensitiveLabel: string | null;
}

function scoreContextText(text: string): ContextScores {
  let benignScore = 0;
  let sensitiveScore = 0;
  let topBenignWeight = 0;
  let topBenignLabel: string | null = null;
  let topSensitiveWeight = 0;
  let topSensitiveLabel: string | null = null;

  for (const rule of BENIGN_CONTEXT_RULES) {
    rule.pattern.lastIndex = 0;
    const matches = text.match(rule.pattern);
    if (matches && matches.length > 0) {
      const contribution = rule.weight * Math.min(3, matches.length);
      benignScore += contribution;
      if (contribution > topBenignWeight) {
        topBenignWeight = contribution;
        topBenignLabel = rule.label;
      }
    }
  }

  for (const rule of SENSITIVE_CONTEXT_RULES) {
    rule.pattern.lastIndex = 0;
    const matches = text.match(rule.pattern);
    if (matches && matches.length > 0) {
      const contribution = rule.weight * Math.min(3, matches.length);
      sensitiveScore += contribution;
      if (contribution > topSensitiveWeight) {
        topSensitiveWeight = contribution;
        topSensitiveLabel = rule.label;
      }
    }
  }

  return { benignScore, sensitiveScore, topBenignLabel, topSensitiveLabel };
}

function getSurroundingWindow(rawText: string, needle: string, radius = 95): string {
  const idx = rawText.indexOf(needle);
  if (idx === -1) return rawText.slice(0, Math.min(rawText.length, radius * 2));
  const start = Math.max(0, idx - radius);
  const end = Math.min(rawText.length, idx + needle.length + radius);
  return rawText.slice(start, end);
}

function clamp01(n: number): number {
  return Number(Math.max(0, Math.min(1, n)).toFixed(2));
}

function classifySingleEntity(
  entry: VaultEntry,
  rawText: string,
  docScores: ContextScores,
  forceMaskSet: Set<string>,
  forceKeepSet: Set<string>
): ClassifiedEntity {
  const norm = entry.original.trim().toLowerCase();

  if (forceMaskSet.has(norm)) {
    return {
      ...entry,
      decision: 'MASK_REQUIRED',
      confidence: 1.0,
      reason: 'Forced masked by user',
      isHardSecret: false,
    };
  }
  if (forceKeepSet.has(norm)) {
    return {
      ...entry,
      decision: 'KEEP_SAFE_CONTEXT',
      confidence: 0.0,
      reason: 'Marked safe by user',
      isHardSecret: false,
    };
  }

  // User manual mark always respected
  if (entry.source === 'manual') {
    return {
      ...entry,
      decision: 'MASK_REQUIRED',
      confidence: 1.0,
      reason: 'Manually marked sensitive',
      isHardSecret: true,
    };
  }

  const windowText = getSurroundingWindow(rawText, entry.original, 95);
  const winScores = scoreContextText(windowText);
  const totalBenign = docScores.benignScore + winScores.benignScore * 1.3;
  const totalSensitive = docScores.sensitiveScore + winScores.sensitiveScore * 1.3;
  const isEducationalContext = totalBenign >= 2.0 && totalBenign > totalSensitive * 1.25;
  const benignLabel = winScores.topBenignLabel ?? docScores.topBenignLabel ?? 'educational/sample context';

  // --- SECRET ---
  if (entry.category === 'SECRET') {
    if (isPlaceholderSecret(entry.original)) {
      return {
        ...entry,
        decision: 'KEEP_SAFE_CONTEXT',
        confidence: 0.12,
        reason: 'Placeholder or test-mode secret',
        isHardSecret: false,
      };
    }
    // Hard-override invariant: real high-entropy secrets ALWAYS stay masked even in homework/tutorials
    return {
      ...entry,
      decision: 'MASK_REQUIRED',
      confidence: 0.98,
      reason: 'Live high-entropy secret / credential',
      isHardSecret: true,
    };
  }

  // --- CARD / IBAN ---
  if (entry.category === 'CARD') {
    const isIban = /^[A-Z]{2}\d{2}[A-Z0-9]{11,26}$/.test(entry.original.trim());
    if (isIban) {
      if (/0000000000/.test(entry.original)) {
        return {
          ...entry,
          decision: 'KEEP_SAFE_CONTEXT',
          confidence: 0.12,
          reason: 'Placeholder IBAN',
          isHardSecret: false,
        };
      }
      return {
        ...entry,
        decision: 'MASK_REQUIRED',
        confidence: 0.95,
        reason: 'Valid IBAN bank identifier',
        isHardSecret: true,
      };
    }
    if (isKnownTestCard(entry.original)) {
      return {
        ...entry,
        decision: 'KEEP_SAFE_CONTEXT',
        confidence: 0.08,
        reason: 'Standard payment sandbox test card',
        isHardSecret: false,
      };
    }
    if (!isValidLuhn(entry.original)) {
      const hasCardCue = /\b(?:card|visa|mastercard|credit|debit|payment|billing|payout)\b|(?:số\s*thẻ|thẻ\s*tín\s*dụng|thanh\s*toán)/i.test(
        windowText
      );
      if (hasCardCue && totalSensitive > 0 && !isEducationalContext) {
        return {
          ...entry,
          decision: 'MASK_SUGGESTED',
          confidence: 0.68,
          reason: 'Labeled payment card in confidential doc (Luhn unverified)',
          isHardSecret: false,
        };
      }
      return {
        ...entry,
        decision: 'KEEP_SAFE_CONTEXT',
        confidence: 0.14,
        reason: 'Failed Luhn checksum — likely non-card ID/SKU',
        isHardSecret: false,
      };
    }
    // Valid non-test Luhn card: hard-override invariant
    return {
      ...entry,
      decision: 'MASK_REQUIRED',
      confidence: 0.96,
      reason: 'Luhn-valid payment card number',
      isHardSecret: true,
    };
  }

  // --- NATIONAL ID / SSN / CCCD / MRN ---
  if (entry.category === 'ID') {
    if (isBenignId(entry.original)) {
      return {
        ...entry,
        decision: 'KEEP_SAFE_CONTEXT',
        confidence: 0.1,
        reason: 'Placeholder national ID / SSN',
        isHardSecret: false,
      };
    }
    // If purely a 12-digit number starting with 0 inside an explicitly non-identity context (e.g., math/sku/tracking)
    const isBare12Digits = /^0\d{11}$/.test(entry.original.trim());
    if (
      isBare12Digits &&
      /\b(?:sku|order|tracking|barcode|serial|mã\s*đơn|vận\s*đơn)\b/i.test(windowText) &&
      !/(?:cccd|cmnd|căn\s*cước|citizen|national\s*id)/i.test(windowText)
    ) {
      return {
        ...entry,
        decision: 'KEEP_SAFE_CONTEXT',
        confidence: 0.18,
        reason: 'Order/SKU number rather than national ID',
        isHardSecret: false,
      };
    }
    return {
      ...entry,
      decision: 'MASK_REQUIRED',
      confidence: 0.93,
      reason: 'Personal government / medical identifier',
      isHardSecret: true,
    };
  }

  // --- IP ADDRESS ---
  if (entry.category === 'IP') {
    const ipKind = classifyIpAddress(entry.original);
    if (ipKind === 'LOOPBACK_MASK_DNS' || ipKind === 'BENCHMARK_DOC') {
      return {
        ...entry,
        decision: 'KEEP_SAFE_CONTEXT',
        confidence: 0.08,
        reason:
          ipKind === 'BENCHMARK_DOC'
            ? 'IETF RFC 5737 documentation IP'
            : 'Loopback / subnet mask / public DNS IP',
        isHardSecret: false,
      };
    }
    if (ipKind === 'RFC1918_PRIVATE') {
      if (isEducationalContext) {
        return {
          ...entry,
          decision: 'KEEP_SAFE_CONTEXT',
          confidence: 0.14,
          reason: `Private IP in ${benignLabel}`,
          isHardSecret: false,
        };
      }
      if (totalSensitive >= 1.5) {
        return {
          ...entry,
          decision: 'MASK_REQUIRED',
          confidence: 0.88,
          reason: 'Internal infrastructure IP in operational context',
          isHardSecret: false,
        };
      }
      return {
        ...entry,
        decision: 'MASK_SUGGESTED',
        confidence: 0.58,
        reason: 'Private IP — ambiguous context',
        isHardSecret: false,
      };
    }
    // PUBLIC_IP
    if (isEducationalContext && totalSensitive === 0) {
      return {
        ...entry,
        decision: 'KEEP_SAFE_CONTEXT',
        confidence: 0.22,
        reason: `IP used in ${benignLabel}`,
        isHardSecret: false,
      };
    }
    return {
      ...entry,
      decision: 'MASK_REQUIRED',
      confidence: 0.86,
      reason: 'Public IP address',
      isHardSecret: false,
    };
  }

  // --- EMAIL ---
  if (entry.category === 'EMAIL') {
    if (isBenignEmail(entry.original)) {
      return {
        ...entry,
        decision: 'KEEP_SAFE_CONTEXT',
        confidence: 0.09,
        reason: 'RFC 2606 / placeholder example email',
        isHardSecret: false,
      };
    }
    return {
      ...entry,
      decision: 'MASK_REQUIRED',
      confidence: clamp01(0.84 + (totalSensitive > 0 ? 0.1 : 0)),
      reason: 'Personal or organizational email address',
      isHardSecret: false,
    };
  }

  // --- PHONE ---
  if (entry.category === 'PHONE') {
    if (isBenignPhone(entry.original)) {
      return {
        ...entry,
        decision: 'KEEP_SAFE_CONTEXT',
        confidence: 0.1,
        reason: 'Fictional / placeholder phone number',
        isHardSecret: false,
      };
    }
    return {
      ...entry,
      decision: 'MASK_REQUIRED',
      confidence: clamp01(0.84 + (totalSensitive > 0 ? 0.1 : 0)),
      reason: 'Real phone number',
      isHardSecret: false,
    };
  }

  // --- SEMANTIC ENTITIES (PERSON / ORG / ADDRESS / LOCATION / CUSTOM) ---
  if (isBenignPlaceholderName(entry.original)) {
    return {
      ...entry,
      decision: 'KEEP_SAFE_CONTEXT',
      confidence: 0.1,
      reason: 'Placeholder example name / organization',
      isHardSecret: false,
    };
  }

  if (isEducationalContext && totalSensitive === 0) {
    return {
      ...entry,
      decision: 'MASK_SUGGESTED',
      confidence: 0.55,
      reason: `Entity in ${benignLabel} — verify sensitivity`,
      isHardSecret: false,
    };
  }

  return {
    ...entry,
    decision: 'MASK_REQUIRED',
    confidence: 0.85,
    reason: 'Semantic personal / organizational entity',
    isHardSecret: false,
  };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applySelectiveRedaction(
  rawText: string,
  activeEntities: ClassifiedEntity[],
  existingVault: VaultEntry[] = []
): { redactedText: string; activeVault: VaultEntry[] } {
  const vault: VaultEntry[] = existingVault.map((e) => ({ ...e, source: e.source ?? 'regex' }));
  const seen = new Map<string, string>();
  const counters: Record<string, number> = {};

  for (const entry of vault) {
    seen.set(entry.original, entry.token);
    const numMatch = entry.token.match(/_(\d+)\]$/);
    if (numMatch) {
      const idx = Number(numMatch[1]);
      counters[entry.category] = Math.max(counters[entry.category] || 0, idx);
    }
  }

  const register = (entity: ClassifiedEntity): string => {
    const trimmed = entity.original.trim();
    const prev = seen.get(trimmed);
    if (prev) return prev;
    counters[entity.category] = (counters[entity.category] || 0) + 1;
    const token = `[${entity.category}_${counters[entity.category]}]`;
    seen.set(trimmed, token);
    vault.push({
      token,
      category: entity.category,
      original: trimmed,
      source: entity.source,
    });
    return token;
  };

  // Sort longest first so sub-strings never corrupt longer matches
  const sorted = [...activeEntities].sort((a, b) => b.original.length - a.original.length);
  let redacted = rawText;

  for (const entity of sorted) {
    const token = register(entity);
    const escaped = escapeRegExp(entity.original);
    const startsWord = /^[A-Za-z0-9_]/.test(entity.original);
    const endsWord = /[A-Za-z0-9_]$/.test(entity.original);
    let pattern = escaped;
    if (entity.category === 'IP') {
      pattern = `(?<![vV\\d.])${escaped}(?!-(?:rc|alpha|beta|dev|snapshot)[0-9a-zA-Z.-]*\\b)(?!\\.\\d)`;
    } else if (entity.category !== 'SECRET') {
      const pre = startsWord ? '(?<![A-Za-z0-9_])' : '';
      const post = endsWord ? '(?![A-Za-z0-9_])' : '';
      pattern = `${pre}${escaped}${post}`;
    }

    // Protect existing [TOKEN_N] spans while replacing
    const tokenSpans: Array<{ start: number; end: number }> = [];
    const spanRgx = /\[[A-Z]+_\d+\]/g;
    let m: RegExpExecArray | null;
    while ((m = spanRgx.exec(redacted)) !== null) {
      tokenSpans.push({ start: m.index, end: m.index + m[0].length });
    }

    const flags = entity.source === 'regex' ? 'g' : 'gi';
    redacted = redacted.replace(new RegExp(pattern, flags), (matched, offset: number) => {
      const end = offset + matched.length;
      if (tokenSpans.some((s) => offset < s.end && end > s.start)) {
        return matched;
      }
      return token;
    });
  }

  return { redactedText: redacted, activeVault: vault };
}

function buildSummaryLabel(
  contextKind: DocumentContextKind,
  maskedCount: number,
  keptCount: number,
  topBenignLabel: string | null
): string {
  if (contextKind === 'CLEAN') return 'No sensitive data detected';
  if (contextKind === 'EDUCATIONAL_SYNTHETIC') {
    const label = topBenignLabel ? ` (${topBenignLabel})` : '';
    return `${keptCount} non-sensitive item${keptCount === 1 ? '' : 's'} kept intact${label}`;
  }
  if (contextKind === 'MIXED_HYBRID') {
    return `${keptCount} sample/lab item${keptCount === 1 ? '' : 's'} kept · ${maskedCount} real secret${maskedCount === 1 ? '' : 's'} masked`;
  }
  return `${maskedCount} sensitive item${maskedCount === 1 ? '' : 's'} masked locally`;
}

/**
 * Runs the fast Tier 0 + Tier 1 Context-Aware Sensitivity Engine (< 1 ms/doc).
 * Does NOT modify or break `redactLocally()` in piiVault.ts.
 */
export function analyzeWithContextGuard(
  rawText: string,
  options: ContextGuardOptions = {}
): ContextGuardAnalysis {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const {
    extraSensitiveTerms = [],
    enabledCategories = DEFAULT_CATEGORY_FILTER,
    smartContextGuard = true,
    existingVault = [],
    forceMaskOriginals = [],
    forceKeepOriginals = [],
    ignoredValues = [],
  } = options;

  const base = redactLocally(rawText, extraSensitiveTerms, enabledCategories, existingVault);
  const existingTokenSet = new Set(existingVault.map((e) => e.token));
  const candidates = base.vault.filter((e) => !existingTokenSet.has(e.token));

  if (candidates.length === 0) {
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
    return {
      contextKind: 'CLEAN',
      entities: [],
      maskedByDefault: [],
      keptSafeByContext: [],
      ambiguousEntities: [],
      redactedText: base.redactedText,
      activeVault: base.vault,
      bytesShielded: base.bytesShielded,
      leaksFound: base.leaksFound,
      sourceCounts: base.sourceCounts,
      summaryLabel: 'No sensitive data detected',
      analysisTimeMs: Number(elapsed.toFixed(2)),
    };
  }

  const docScores = scoreContextText(rawText);
  const forceMaskSet = new Set(forceMaskOriginals.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const forceKeepSet = new Set(
    [...forceKeepOriginals, ...ignoredValues].map((s) => s.trim().toLowerCase()).filter(Boolean)
  );

  const entities = candidates.map((entry) => {
    const lowerOriginal = entry.original.trim().toLowerCase();
    if (forceKeepSet.has(lowerOriginal) && !forceMaskSet.has(lowerOriginal)) {
      return {
        ...entry,
        decision: 'KEEP_SAFE_CONTEXT' as SensitivityDecision,
        confidence: 0.05,
        reason: 'Whitelisted by user',
        isHardSecret: false,
      };
    }
    return smartContextGuard
      ? classifySingleEntity(entry, rawText, docScores, forceMaskSet, forceKeepSet)
      : {
          ...entry,
          decision: 'MASK_REQUIRED' as SensitivityDecision,
          confidence: 0.95,
          reason: 'Strict mode — all detected PII masked',
          isHardSecret: entry.category === 'SECRET',
        };
  });

  const maskedByDefault = entities.filter((e) => e.decision !== 'KEEP_SAFE_CONTEXT');
  const keptSafeByContext = entities.filter((e) => e.decision === 'KEEP_SAFE_CONTEXT');
  const ambiguousEntities = entities.filter((e) => e.confidence >= 0.35 && e.confidence <= 0.75);

  const contextKind: DocumentContextKind =
    maskedByDefault.length > 0 && keptSafeByContext.length > 0
      ? 'MIXED_HYBRID'
      : keptSafeByContext.length > 0
        ? 'EDUCATIONAL_SYNTHETIC'
        : 'SENSITIVE_REAL';

  // Fast path: if every candidate is masked, reuse base.redactedText directly with zero extra work
  let redactedText = base.redactedText;
  let activeVault = base.vault;
  if (keptSafeByContext.length > 0) {
    const selective = applySelectiveRedaction(rawText, maskedByDefault, existingVault);
    redactedText = selective.redactedText;
    activeVault = selective.activeVault;
  }

  const bytesShielded = activeVault.reduce(
    (acc, item) => acc + (TEXT_ENCODER ? TEXT_ENCODER.encode(item.original).length : item.original.length),
    0
  );
  const leaksFound = verifyZeroLeak(redactedText, activeVault);
  const sourceCounts = countVaultBySource(activeVault);
  const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;

  return {
    contextKind,
    entities,
    maskedByDefault,
    keptSafeByContext,
    ambiguousEntities,
    redactedText,
    activeVault,
    bytesShielded,
    leaksFound,
    sourceCounts,
    summaryLabel: buildSummaryLabel(
      contextKind,
      maskedByDefault.length,
      keptSafeByContext.length,
      docScores.topBenignLabel
    ),
    analysisTimeMs: Number(elapsed.toFixed(2)),
  };
}

/**
 * Projects a ContextGuardAnalysis into the canonical RedactionResult shape
 * so existing UI panels & metrics consume it seamlessly with zero breaking changes.
 */
export function contextAnalysisToRedaction(analysis: ContextGuardAnalysis): RedactionResult {
  const breakdownMap = new Map<PiiCategory, number>();
  for (const entry of analysis.activeVault) {
    breakdownMap.set(entry.category, (breakdownMap.get(entry.category) || 0) + 1);
  }
  const breakdown: CategoryBreakdown[] = Array.from(breakdownMap.entries()).map(
    ([category, count]) => ({ category, count })
  );
  const rawScore = analysis.activeVault.reduce(
    (sum, e) => sum + (e.category === 'SECRET' ? 35 : e.category === 'CARD' ? 30 : e.category === 'ID' ? 25 : 10),
    0
  );
  return {
    redactedText: analysis.redactedText,
    vault: analysis.activeVault,
    bytesShielded: analysis.bytesShielded,
    leaksFound: analysis.leaksFound,
    breakdown,
    sourceCounts: analysis.sourceCounts,
    privacyScore: Math.min(100, rawScore),
    shieldTimeMs: analysis.analysisTimeMs,
  };
}

// ---------------------------------------------------------------------------
// Tier 2: Async On-Device Gemini Nano Contextual Adjudicator (Bounded + Cached)
// ---------------------------------------------------------------------------

interface NanoAdjudicationDecision {
  text: string;
  sensitive: boolean;
  reason?: string;
}

const MAX_ADJUDICATION_CACHE = 32;
const adjudicationCache = new Map<string, Map<string, { sensitive: boolean; reason: string }>>();

function fingerprintAdjudication(rawText: string, candidates: ClassifiedEntity[]): string {
  const sample = rawText.slice(0, 240) + '|' + rawText.slice(-120) + '|' + rawText.length;
  const items = candidates.map((c) => `${c.category}:${c.original}`).join(',');
  return `${sample}::${items}`;
}

function parseNanoAdjudicationJson(raw: string): NanoAdjudicationDecision[] {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  candidate = candidate.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1');
  try {
    const parsed = JSON.parse(candidate);
    if (!Array.isArray(parsed)) return [];
    const out: NanoAdjudicationDecision[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as { text?: unknown }).text === 'string' &&
        typeof (item as { sensitive?: unknown }).sensitive === 'boolean'
      ) {
        const obj = item as { text: string; sensitive: boolean; reason?: unknown };
        out.push({
          text: obj.text.trim(),
          sensitive: obj.sensitive,
          reason: typeof obj.reason === 'string' ? obj.reason.trim().slice(0, 80) : undefined,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Tier-2 On-Device Gemini Nano adjudicator for ambiguous entities ONLY (0.35 <= confidence <= 0.75).
 * Respects Hard-Override Safety Invariant: Nano can NEVER downgrade `isHardSecret === true`.
 * Always degrades cleanly to Tier-1 decisions when Nano is unavailable or times out.
 */
export async function adjudicateAmbiguousWithNano(
  rawText: string,
  entities: ClassifiedEntity[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<NanoAdjudicationResult> {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const timeoutMs = options.timeoutMs ?? 6_000;
  const candidates = entities.filter(
    (e) => !e.isHardSecret && e.confidence >= 0.35 && e.confidence <= 0.75
  );

  if (candidates.length === 0) {
    return {
      entities,
      usedNano: false,
      cached: false,
      timedOut: false,
      latencyMs: 0,
    };
  }

  const cacheKey = fingerprintAdjudication(rawText, candidates);
  const cachedMap = adjudicationCache.get(cacheKey);
  if (cachedMap) {
    const updated = entities.map((e) => {
      if (e.isHardSecret) return e;
      const hit = cachedMap.get(e.original.toLowerCase());
      if (!hit) return e;
      return {
        ...e,
        decision: hit.sensitive ? ('MASK_REQUIRED' as const) : ('KEEP_SAFE_CONTEXT' as const),
        confidence: hit.sensitive ? 0.88 : 0.16,
        reason: hit.reason || (hit.sensitive ? 'Confirmed sensitive by on-device Nano' : 'Confirmed benign by on-device Nano'),
      };
    });
    return {
      entities: updated,
      usedNano: true,
      cached: true,
      timedOut: false,
      latencyMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started),
    };
  }

  const g = globalThis as unknown as {
    LanguageModel?: {
      availability?: (opts?: unknown) => Promise<string>;
      create?: (opts?: unknown) => Promise<{
        prompt: (text: string, opts?: { signal?: AbortSignal }) => Promise<string>;
        destroy?: () => void;
      }>;
    };
  };

  if (!g.LanguageModel?.availability || !g.LanguageModel?.create) {
    return { entities, usedNano: false, cached: false, timedOut: false, latencyMs: 0 };
  }

  let status = '';
  try {
    status = (await g.LanguageModel.availability({ expectedOutputs: [{ type: 'text', languages: ['en'] }] })).toLowerCase();
  } catch {
    try {
      status = (await g.LanguageModel.availability()).toLowerCase();
    } catch {
      return { entities, usedNano: false, cached: false, timedOut: false, latencyMs: 0 };
    }
  }
  if (status !== 'available' && status !== 'readily') {
    return { entities, usedNano: false, cached: false, timedOut: false, latencyMs: 0 };
  }

  const controller = new AbortController();
  let timedOut = false;
  const onParentAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let session: { prompt: (text: string, opts?: { signal?: AbortSignal }) => Promise<string>; destroy?: () => void } | null = null;
  try {
    session = await g.LanguageModel.create({
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
      initialPrompts: [
        {
          role: 'system',
          content:
            'You are a strict local privacy classifier. Decide if each candidate string is REAL private/confidential data (sensitive: true) OR benign homework/tutorial/public/placeholder data (sensitive: false). Reply ONLY with a JSON array: [{"text":"...","sensitive":true,"reason":"short reason"}].',
        },
      ],
    });

    const snippet = rawText.slice(0, 1400);
    const list = candidates.map((c) => `- (${c.category}) "${c.original}"`).join('\n');
    const prompt = `Context snippet:\n"""\n${snippet}\n"""\n\nCandidates:\n${list}\n\nJSON array:`;
    const rawOut = await session.prompt(prompt, { signal: controller.signal });
    const parsed = parseNanoAdjudicationJson(rawOut);

    const decisionMap = new Map<string, { sensitive: boolean; reason: string }>();
    for (const d of parsed) {
      decisionMap.set(d.text.toLowerCase(), {
        sensitive: d.sensitive,
        reason: d.reason || (d.sensitive ? 'Confirmed sensitive (Nano)' : 'Benign context (Nano)'),
      });
    }

    if (decisionMap.size > 0) {
      if (adjudicationCache.size >= MAX_ADJUDICATION_CACHE) {
        const firstKey = adjudicationCache.keys().next().value;
        if (firstKey) adjudicationCache.delete(firstKey);
      }
      adjudicationCache.set(cacheKey, decisionMap);
    }

    const updated = entities.map((e) => {
      if (e.isHardSecret) return e;
      const hit = decisionMap.get(e.original.toLowerCase());
      if (!hit) return e;
      return {
        ...e,
        decision: hit.sensitive ? ('MASK_REQUIRED' as const) : ('KEEP_SAFE_CONTEXT' as const),
        confidence: hit.sensitive ? 0.88 : 0.16,
        reason: hit.reason,
      };
    });

    return {
      entities: updated,
      usedNano: true,
      cached: false,
      timedOut: false,
      latencyMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started),
    };
  } catch {
    return {
      entities,
      usedNano: false,
      cached: false,
      timedOut,
      latencyMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started),
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onParentAbort);
    try {
      session?.destroy?.();
    } catch {
      // ignore
    }
  }
}
