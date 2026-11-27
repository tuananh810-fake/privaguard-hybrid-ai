export type PiiCategory =
  | 'SECRET'
  | 'CARD'
  | 'ID'
  | 'EMAIL'
  | 'PHONE'
  | 'IP'
  | 'PERSON'
  | 'CUSTOM';

export interface VaultEntry {
  token: string;
  category: PiiCategory;
  original: string;
}

export interface CategoryBreakdown {
  category: PiiCategory;
  count: number;
}

export interface RedactionResult {
  redactedText: string;
  vault: VaultEntry[];
  bytesShielded: number;
  leaksFound: number;
  breakdown: CategoryBreakdown[];
  privacyScore: number; // 0-100 risk exposure before shielding
  shieldTimeMs: number;
}

export type CategoryFilter = Record<PiiCategory, boolean>;

export const DEFAULT_CATEGORY_FILTER: CategoryFilter = {
  SECRET: true,
  CARD: true,
  ID: true,
  EMAIL: true,
  PHONE: true,
  IP: true,
  PERSON: true,
  CUSTOM: true,
};

interface PatternRule {
  category: PiiCategory;
  regex: RegExp;
  validate?: (match: string) => boolean;
}

const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)';
// Matches valid IPv4 (0-255 octets) with optional :port, while skipping v1.2.3.4 and 1.2.3.4-rc1 / -alpha / -beta / -dev / -snapshot
const IPV4_REGEX = new RegExp(
  `(?<![vV\\d.])\\b(?:${IPV4_OCTET}\\.){3}${IPV4_OCTET}(?::\\d{2,5})?\\b(?!-(?:rc|alpha|beta|dev|snapshot)[0-9a-zA-Z.-]*\\b)(?!\\.\\d)`,
  'gi'
);

const PII_RULES: PatternRule[] = [
  // PEM Private Keys, DB connection URIs, JWTs, API keys, tokens, secrets
  {
    category: 'SECRET',
    regex:
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----|(?:\b(?:postgres|postgresql|mongodb(?:\+srv)?|mysql|redis):\/\/[^\s'"`<>]+)|\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b|\b(?:AIza[0-9A-Za-z\-_]{20,}|sk-(?:proj-|live-|test-)?[A-Za-z0-9\-_]{16,}|(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}|gh[pou]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|Bearer\s+[A-Za-z0-9\-._~+/]+=*|AKIA[0-9A-Z]{16})\b/g,
  },
  // Credit cards / IBANs
  {
    category: 'CARD',
    regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b|\b[A-Z]{2}\d{2}[A-Z0-9]{11,26}\b/g,
  },
  // SSN / National ID / Patient ID / Vietnam 12-digit CCCD
  {
    category: 'ID',
    regex: /\b\d{3}-\d{2}-\d{4}\b|\b(?:MRN|PID|CCCD|CMND|ID)[#:\s-]*\d{5,12}\b|\b0\d{11}\b/gi,
  },
  // Email addresses
  {
    category: 'EMAIL',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  // Phone numbers (international & local, including +84 912-345-678; excludes dotted-quads like 999.999.999.999)
  {
    category: 'PHONE',
    regex:
      /(?<!\d\.)(?<!\d)(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{3,4}(?!\.\d)(?!\d)|(?<!\d\.)\b0\d{2,3}[\s.-]?\d{3}[\s.-]?\d{3,4}(?!\.\d)(?!\d)/g,
  },
  // Valid IPv4 (strict 0-255 octets, skips v1.2.3.4 and 1.2.3.4-rc1 versions)
  {
    category: 'IP',
    regex: IPV4_REGEX,
  },
];

const CATEGORY_WEIGHT: Record<PiiCategory, number> = {
  SECRET: 35,
  CARD: 30,
  ID: 25,
  EMAIL: 10,
  PHONE: 12,
  IP: 12,
  PERSON: 10,
  CUSTOM: 10,
};

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redactLocally(
  rawText: string,
  extraSensitiveTerms: string[] = [],
  enabledCategories: CategoryFilter = DEFAULT_CATEGORY_FILTER,
  existingVault: VaultEntry[] = []
): RedactionResult {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let redacted = rawText;

  // Inherit existing vault entries & token counters so follow-up Q&A never collides with document tokens
  const vault: VaultEntry[] = existingVault.map((e) => ({ ...e }));
  const seen = new Map<string, string>();
  const counters: Record<string, number> = {};

  for (const entry of existingVault) {
    seen.set(entry.original, entry.token);
    const numMatch = entry.token.match(/_(\d+)\]$/);
    if (numMatch) {
      const idx = Number(numMatch[1]);
      counters[entry.category] = Math.max(counters[entry.category] || 0, idx);
    }
  }

  const registerToken = (original: string, category: PiiCategory): string => {
    const trimmed = original.trim();
    if (!trimmed) return original;
    const existing = seen.get(trimmed);
    if (existing) return existing;
    counters[category] = (counters[category] || 0) + 1;
    const token = `[${category}_${counters[category]}]`;
    seen.set(trimmed, token);
    vault.push({ token, category, original: trimmed });
    return token;
  };

  for (const rule of PII_RULES) {
    if (!enabledCategories[rule.category]) continue;
    rule.regex.lastIndex = 0;
    redacted = redacted.replace(rule.regex, (match) => {
      if (rule.validate && !rule.validate(match)) return match;
      return registerToken(match, rule.category);
    });
  }

  if (enabledCategories.PERSON || enabledCategories.CUSTOM) {
    const cleanExtras = extraSensitiveTerms
      .map((t) => t.trim())
      .filter((t) => t.length >= 3 && !t.startsWith('[') && !t.endsWith(']'))
      .sort((a, b) => b.length - a.length);

    for (const term of cleanExtras) {
      const escaped = escapeRegExp(term);
      // Case-insensitive match preserving exact matched text for lossless local re-hydration
      const rgx = new RegExp(escaped, 'gi');
      redacted = redacted.replace(rgx, (matched) => registerToken(matched, 'PERSON'));
    }
  }

  const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  const bytesShielded = vault.reduce(
    (acc, item) => acc + (encoder ? encoder.encode(item.original).length : item.original.length),
    0
  );
  const leaksFound = verifyZeroLeak(redacted, vault);

  const breakdownMap = new Map<PiiCategory, number>();
  let rawScore = 0;
  for (const entry of vault) {
    breakdownMap.set(entry.category, (breakdownMap.get(entry.category) || 0) + 1);
    rawScore += CATEGORY_WEIGHT[entry.category] || 10;
  }

  const breakdown: CategoryBreakdown[] = Array.from(breakdownMap.entries()).map(
    ([category, count]) => ({ category, count })
  );

  const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;

  return {
    redactedText: redacted,
    vault,
    bytesShielded,
    leaksFound,
    breakdown,
    privacyScore: Math.min(100, rawScore),
    shieldTimeMs: Number(elapsed.toFixed(2)),
  };
}

/**
 * Boundary-aware Zero-Leak check: avoids false positives when an IP like 1.2.3.4 is in the vault
 * and a version string like v1.2.3.4 or 1.2.3.4-rc1 legitimately remains in the text.
 */
export function verifyZeroLeak(payload: string, vault: VaultEntry[]): number {
  let leaks = 0;
  for (const entry of vault) {
    if (entry.original.length < 4) continue;
    const escaped = escapeRegExp(entry.original);
    const startsWord = /^[A-Za-z0-9_]/.test(entry.original);
    const endsWord = /[A-Za-z0-9_]$/.test(entry.original);

    let pattern = escaped;
    if (entry.category === 'IP') {
      pattern = `(?<![vV\\d.])${escaped}(?!-(?:rc|alpha|beta|dev|snapshot)[0-9a-zA-Z.-]*\\b)(?!\\.\\d)`;
    } else {
      const pre = startsWord ? '(?<![A-Za-z0-9_])' : '';
      const post = endsWord ? '(?![A-Za-z0-9_])' : '';
      pattern = `${pre}${escaped}${post}`;
    }

    if (new RegExp(pattern).test(payload)) {
      leaks += 1;
    }
  }
  return leaks;
}

export function rehydrateLocally(text: string, vault: VaultEntry[]): string {
  let output = text;
  for (const entry of vault) {
    output = output.split(entry.token).join(entry.original);
  }
  return output;
}

export function buildVaultLookup(vault: VaultEntry[]): Record<string, VaultEntry> {
  const map: Record<string, VaultEntry> = {};
  for (const entry of vault) {
    map[entry.token] = entry;
  }
  return map;
}
