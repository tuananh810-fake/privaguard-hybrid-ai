import type { VaultEntry } from './piiVault.ts';
import {
  analyzeWithContextGuard,
  type ContextGuardAnalysis,
  type ContextGuardOptions,
} from './sensitivityEngine.ts';

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function replaceWithVault(text: string, vault: VaultEntry[]): string {
  if (!text || vault.length === 0) return text;
  const sorted = [...vault].sort((a, b) => b.original.length - a.original.length);
  let out = text;

  for (const entry of sorted) {
    if (!entry.original || entry.original.length < 2) continue;
    const escaped = escapeRegExp(entry.original);
    const startsWord = /^[A-Za-z0-9_]/.test(entry.original);
    const endsWord = /[A-Za-z0-9_]$/.test(entry.original);

    let pattern = escaped;
    if (entry.category === 'IP') {
      pattern = `(?<![vV\\d.])${escaped}(?!-(?:rc|alpha|beta|dev|snapshot)[0-9a-zA-Z.-]*\\b)(?!\\.\\d)`;
    } else if (entry.category !== 'SECRET') {
      const pre = startsWord ? '(?<![A-Za-z0-9_])' : '';
      const post = endsWord ? '(?![A-Za-z0-9_])' : '';
      pattern = `${pre}${escaped}${post}`;
    }

    const tokenSpans: Array<{ start: number; end: number }> = [];
    const spanRgx = /\[[A-Z]+_\d+\]/g;
    let m: RegExpExecArray | null;
    while ((m = spanRgx.exec(out)) !== null) {
      tokenSpans.push({ start: m.index, end: m.index + m[0].length });
    }

    const flags = entry.source === 'regex' ? 'g' : 'gi';
    out = out.replace(new RegExp(pattern, flags), (matched, offset: number) => {
      const end = offset + matched.length;
      if (tokenSpans.some((s) => offset < s.end && end > s.start)) {
        return matched;
      }
      return entry.token;
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// 1. Syntax-Safe JSON Redactor
// ---------------------------------------------------------------------------

export function redactJsonTextPreservingSyntax(
  rawJson: string,
  options: ContextGuardOptions = {}
): { redactedText: string; analysis: ContextGuardAnalysis; validJson: boolean } {
  const analysis = analyzeWithContextGuard(rawJson, options);

  try {
    const parsed: unknown = JSON.parse(rawJson);
    const vault = analysis.activeVault;

    const transform = (node: unknown): unknown => {
      if (typeof node === 'string') {
        return replaceWithVault(node, vault);
      }
      if (Array.isArray(node)) {
        return node.map(transform);
      }
      if (node && typeof node === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          out[k] = transform(v);
        }
        return out;
      }
      return node;
    };

    const indent = rawJson.includes('\n') ? 2 : undefined;
    const redactedText = JSON.stringify(transform(parsed), null, indent);
    return { redactedText, analysis, validJson: true };
  } catch {
    return { redactedText: analysis.redactedText, analysis, validJson: false };
  }
}

// ---------------------------------------------------------------------------
// 2. Format-Preserving Word (.docx) OpenXML In-Place Redactor (Run-Merging)
// ---------------------------------------------------------------------------

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&');
}

function encodeXmlEntities(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface XmlTextRun {
  fullStart: number;
  fullEnd: number;
  openTag: string;
  decoded: string;
  charStart: number;
  charEnd: number;
}

function extractParagraphRuns(paragraphXml: string): { runs: XmlTextRun[]; mergedText: string } {
  const runs: XmlTextRun[] = [];
  const wtRegex = /(<w:t(?:\s+[^>]*)?>)([\s\S]*?)<\/w:t>/g;
  let merged = '';
  let m: RegExpExecArray | null;

  while ((m = wtRegex.exec(paragraphXml)) !== null) {
    const decoded = decodeXmlEntities(m[2]);
    const charStart = merged.length;
    merged += decoded;
    runs.push({
      fullStart: m.index,
      fullEnd: m.index + m[0].length,
      openTag: m[1],
      decoded,
      charStart,
      charEnd: merged.length,
    });
  }

  return { runs, mergedText: merged };
}

function ensurePreserveSpaceTag(openTag: string, value: string): string {
  if (!value || (!/^\s/.test(value) && !/\s$/.test(value))) {
    return openTag;
  }
  if (/xml:space\s*=/.test(openTag)) return openTag;
  return openTag.replace(/^<w:t/, '<w:t xml:space="preserve"');
}

function applyVaultToDocxXml(xml: string, vault: VaultEntry[]): string {
  if (!xml || vault.length === 0) return xml;
  const pRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;

  return xml.replace(pRegex, (paragraphXml) => {
    const { runs, mergedText } = extractParagraphRuns(paragraphXml);
    if (runs.length === 0 || !mergedText.trim()) return paragraphXml;

    const replaced = replaceWithVault(mergedText, vault);
    if (replaced === mergedText) return paragraphXml;

    const sorted = [...vault].sort((a, b) => b.original.length - a.original.length);
    const edits: Array<{ start: number; end: number; replacement: string }> = [];
    const occupied: Array<{ start: number; end: number }> = [];

    for (const entry of sorted) {
      if (!entry.original || entry.original.length < 2) continue;
      const escaped = escapeRegExp(entry.original);
      const startsWord = /^[A-Za-z0-9_]/.test(entry.original);
      const endsWord = /[A-Za-z0-9_]$/.test(entry.original);
      let pattern = escaped;
      if (entry.category === 'IP') {
        pattern = `(?<![vV\\d.])${escaped}(?!-(?:rc|alpha|beta|dev|snapshot)[0-9a-zA-Z.-]*\\b)(?!\\.\\d)`;
      } else if (entry.category !== 'SECRET') {
        const pre = startsWord ? '(?<![A-Za-z0-9_])' : '';
        const post = endsWord ? '(?![A-Za-z0-9_])' : '';
        pattern = `${pre}${escaped}${post}`;
      }
      const flags = entry.source === 'regex' ? 'g' : 'gi';
      const rgx = new RegExp(pattern, flags);
      let match: RegExpExecArray | null;
      while ((match = rgx.exec(mergedText)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (occupied.some((o) => start < o.end && end > o.start)) continue;
        occupied.push({ start, end });
        edits.push({ start, end, replacement: entry.token });
      }
    }

    if (edits.length === 0) return paragraphXml;

    const runTexts = runs.map((r) => r.decoded);
    edits.sort((a, b) => b.start - a.start);

    for (const edit of edits) {
      let inserted = false;
      for (let i = 0; i < runs.length; i++) {
        const r = runs[i];
        if (edit.end <= r.charStart || edit.start >= r.charEnd) continue;
        const localStart = Math.max(0, edit.start - r.charStart);
        const localEnd = Math.min(r.decoded.length, edit.end - r.charStart);
        const cur = runTexts[i];
        const prefix = cur.slice(0, localStart);
        const suffix = cur.slice(localEnd);
        if (!inserted) {
          runTexts[i] = prefix + edit.replacement + suffix;
          inserted = true;
        } else {
          runTexts[i] = prefix + suffix;
        }
      }
    }

    let rebuilt = paragraphXml;
    for (let i = runs.length - 1; i >= 0; i--) {
      const r = runs[i];
      if (runTexts[i] === r.decoded) continue;
      const newOpen = ensurePreserveSpaceTag(r.openTag, runTexts[i]);
      const encoded = encodeXmlEntities(runTexts[i]);
      rebuilt = rebuilt.slice(0, r.fullStart) + `${newOpen}${encoded}</w:t>` + rebuilt.slice(r.fullEnd);
    }
    return rebuilt;
  });
}

function scrubDocxCoreXml(coreXml: string): string {
  return coreXml
    .replace(/<dc:creator\b[^>]*>[\s\S]*?<\/dc:creator>/gi, '<dc:creator>PrivaGuard AI</dc:creator>')
    .replace(/<cp:lastModifiedBy\b[^>]*>[\s\S]*?<\/cp:lastModifiedBy>/gi, '<cp:lastModifiedBy></cp:lastModifiedBy>')
    .replace(/<dc:title\b[^>]*>[\s\S]*?<\/dc:title>/gi, '<dc:title></dc:title>')
    .replace(/<dc:subject\b[^>]*>[\s\S]*?<\/dc:subject>/gi, '<dc:subject></dc:subject>')
    .replace(/<dc:description\b[^>]*>[\s\S]*?<\/dc:description>/gi, '<dc:description></dc:description>');
}

function extractPlainTextFromDocxXml(xml: string): string {
  const pRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  const paragraphs: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = pRegex.exec(xml)) !== null) {
    const { mergedText } = extractParagraphRuns(m[0]);
    if (mergedText.trim()) paragraphs.push(mergedText);
  }
  return paragraphs.join('\n');
}

export async function redactDocxBuffer(
  buffer: ArrayBuffer | Uint8Array,
  options: ContextGuardOptions = {}
): Promise<{
  bytes: Uint8Array;
  analysis: ContextGuardAnalysis;
  xmlFilesTouched: number;
  metadataStripped: boolean;
}> {
  const jszipMod = await import('jszip');
  const JSZip = jszipMod.default ?? jszipMod;
  const zip = await JSZip.loadAsync(buffer);

  const xmlTargetPaths = Object.keys(zip.files).filter((p) =>
    /^word\/(?:document|header\d*|footer\d*|footnotes|endnotes)\.xml$/i.test(p)
  );

  const xmlContents = new Map<string, string>();
  const allTexts: string[] = [];
  for (const path of xmlTargetPaths) {
    const entry = zip.file(path);
    if (!entry) continue;
    const content = await entry.async('string');
    xmlContents.set(path, content);
    const extracted = extractPlainTextFromDocxXml(content);
    if (extracted) allTexts.push(extracted);
  }

  const fullDocText = allTexts.join('\n\n');
  const analysis = analyzeWithContextGuard(fullDocText, options);

  let xmlFilesTouched = 0;
  for (const [path, content] of xmlContents.entries()) {
    const updated = applyVaultToDocxXml(content, analysis.activeVault);
    if (updated !== content) {
      zip.file(path, updated);
      xmlFilesTouched += 1;
    }
  }

  let metadataStripped = false;
  const coreEntry = zip.file('docProps/core.xml');
  if (coreEntry) {
    const coreXml = await coreEntry.async('string');
    const scrubbed = scrubDocxCoreXml(coreXml);
    zip.file('docProps/core.xml', scrubbed);
    metadataStripped = true;
  }

  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return { bytes, analysis, xmlFilesTouched, metadataStripped };
}
