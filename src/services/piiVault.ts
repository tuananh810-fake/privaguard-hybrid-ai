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

export interface RedactionResult {
  redactedText: string;
  vault: VaultEntry[];
  bytesShielded: number;
  leaksFound: number;
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
}

const PII_RULES: PatternRule[] = [
  // API keys, tokens, secrets
  {
    category: 'SECRET',
    regex: /\b(?:AIza[0-9A-Za-z\-_]{20,}|sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9\-._~+/]+=*|AKIA[0-9A-Z]{16})\b/g,
  },
  // Credit cards / IBANs
  {
    category: 'CARD',
    regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b|\b[A-Z]{2}\d{2}[A-Z0-9]{11,26}\b/g,
  },
  // SSN / National ID / Patient ID
  {
    category: 'ID',
    regex: /\b\d{3}-\d{2}-\d{4}\b|\b(?:MRN|PID|CCCD|ID)[#:\s-]*\d{5,12}\b/gi,
  },
  // Email addresses
  {
    category: 'EMAIL',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  // Phone numbers (international & local, including +84 912-345-678)
  {
    category: 'PHONE',
    regex: /(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{3,4}\b|\b0\d{2,3}[\s.-]?\d{3}[\s.-]?\d{3,4}\b/g,
  },
  // IPv4 addresses
  {
    category: 'IP',
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?\b/g,
  },
];

export function redactLocally(
  rawText: string,
  extraSensitiveTerms: string[] = [],
  enabledCategories: CategoryFilter = DEFAULT_CATEGORY_FILTER
): RedactionResult {
  let redacted = rawText;
  const vault: VaultEntry[] = [];
  const seen = new Map<string, string>();
  const counters: Record<string, number> = {};

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
    redacted = redacted.replace(rule.regex, (match) => registerToken(match, rule.category));
  }

  if (enabledCategories.PERSON || enabledCategories.CUSTOM) {
    const cleanExtras = extraSensitiveTerms
      .map((t) => t.trim())
      .filter((t) => t.length >= 3 && !t.startsWith('[') && !t.endsWith(']'))
      .sort((a, b) => b.length - a.length);

    for (const term of cleanExtras) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rgx = new RegExp(escaped, 'g');
      if (rgx.test(redacted)) {
        const token = registerToken(term, 'PERSON');
        redacted = redacted.replace(rgx, token);
      }
    }
  }

  const bytesShielded = vault.reduce((acc, item) => acc + new Blob([item.original]).size, 0);
  const leaksFound = verifyZeroLeak(redacted, vault);
  return { redactedText: redacted, vault, bytesShielded, leaksFound };
}

export function verifyZeroLeak(payload: string, vault: VaultEntry[]): number {
  let leaks = 0;
  for (const entry of vault) {
    if (entry.original.length >= 4 && payload.includes(entry.original)) {
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
