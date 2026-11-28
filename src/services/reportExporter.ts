import type { HybridResponse, StructuredAuditReport } from './hybridAI.ts';
import type { SourceCounts } from './piiVault.ts';

export type ReportExportFormat = 'md' | 'pdf' | 'docx' | 'json' | 'txt';

export interface ReportExportInput {
  task: string;
  markdown: string;
  result: HybridResponse | null;
  structuredAudit?: StructuredAuditReport | null;
  isHistoricalView: boolean;
  rehydratedLocally: boolean;
  payloadText: string;
  vaultCount: number;
  bytesShielded: number;
  leakCount: number;
  sourceCounts: SourceCounts;
}

export interface ExportedArtifact {
  blob: Blob;
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
}

function encodeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Normalizes Unicode / Vietnamese diacritics to WinAnsi-safe ASCII for pdf-lib StandardFonts
 * so PDF generation never throws on accented characters.
 */
export function toPdfSafeText(input: string): string {
  return input
    .replace(/Đ/g, 'D')
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2022/g, '*')
    .replace(/\u00B7/g, '|')
    .replace(/[^\x20-\x7E\n\t]/g, ' ');
}

function stripMarkdownSyntax(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .trim();
}

async function computeSha256Hex(text: string): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const bytes = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // ignore subtle crypto unavailability
  }
  return 'unavailable';
}

function buildShadedRunsXml(text: string): string {
  const parts = text.split(/(\[[A-Z]+_\d+\])/g).filter((p) => p.length > 0);
  if (parts.length === 0) return '<w:r><w:t></w:t></w:r>';
  return parts
    .map((part) => {
      if (/^\[[A-Z]+_\d+\]$/.test(part)) {
        return `<w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:shd w:val="clear" w:color="auto" w:fill="18181B"/></w:rPr><w:t xml:space="preserve"> ${encodeXml(part)} </w:t></w:r>`;
      }
      return `<w:r><w:t xml:space="preserve">${encodeXml(part)}</w:t></w:r>`;
    })
    .join('');
}

function buildDocxParagraphXml(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) {
    return '<w:p/>';
  }
  const h1 = trimmed.match(/^#\s+(.+)$/);
  if (h1) {
    return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t xml:space="preserve">${encodeXml(h1[1])}</w:t></w:r></w:p>`;
  }
  const h2 = trimmed.match(/^#{2,3}\s+(.+)$/);
  if (h2) {
    return `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="26"/></w:rPr><w:t xml:space="preserve">${encodeXml(h2[1])}</w:t></w:r></w:p>`;
  }
  const clean = stripMarkdownSyntax(trimmed);
  const isBullet = /^[-*]\s+/.test(trimmed);
  const text = isBullet ? `• ${clean.replace(/^[-*]\s+/, '')}` : clean;
  return `<w:p>${buildShadedRunsXml(text)}</w:p>`;
}

/**
 * Generates a valid, standards-compliant native OpenXML `.docx` document from structured text/Markdown.
 * Uses JSZip (already installed) with zero external dependencies and clean scrubbed metadata.
 */
export async function buildNativeDocxBytes(
  title: string,
  bodyText: string,
  includeTitle = true
): Promise<Uint8Array> {
  const jszipMod = await import('jszip');
  const JSZip = jszipMod.default ?? jszipMod;
  const zip = new JSZip();

  const rawLines = bodyText.split(/\r?\n/);
  const lines = includeTitle && title.trim() ? [`# ${title}`, '', ...rawLines] : rawLines;
  const bodyXml = lines.map(buildDocxParagraphXml).join('');

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`
  );

  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`
  );

  zip.file(
    'word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
</w:styles>`
  );

  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyXml}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>
</w:document>`
  );

  zip.file(
    'docProps/core.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:creator>PrivaGuard AI</dc:creator>
  <dc:title></dc:title>
</cp:coreProperties>`
  );

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

function wrapLine(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(' ');
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) {
      cur = w;
    } else if (cur.length + 1 + w.length <= maxChars) {
      cur += ` ${w}`;
    } else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Generates a clean, paginated, metadata-stripped PDF document via pdf-lib.
 */
export async function buildCleanPdfBytes(
  title: string,
  bodyText: string,
  includeTitle = true
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setTitle('');
  pdf.setAuthor('');
  pdf.setSubject('');
  pdf.setKeywords([]);
  pdf.setCreator('');
  pdf.setProducer('');

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 612;
  const pageHeight = 792;
  const marginX = 48;
  const marginBottom = 52;

  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - 54;

  const ensureSpace = (needed: number) => {
    if (y - needed < marginBottom) {
      page = pdf.addPage([pageWidth, pageHeight]);
      y = pageHeight - 54;
    }
  };

  if (includeTitle && title.trim()) {
    page.drawText(toPdfSafeText(title), {
      x: marginX,
      y,
      size: 15,
      font: bold,
      color: rgb(0.06, 0.46, 0.43),
    });
    y -= 24;
  }

  const rawLines = bodyText.split(/\r?\n/);
  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      y -= 8;
      continue;
    }

    const isHeading = /^#{1,3}\s+/.test(trimmed);
    const cleaned = toPdfSafeText(stripMarkdownSyntax(trimmed));
    const font = isHeading ? bold : regular;
    const size = isHeading ? 11.5 : 10;
    const lineHeight = isHeading ? 17 : 14;
    const wrapped = wrapLine(cleaned, isHeading ? 72 : 84);

    if (isHeading) y -= 4;
    for (const seg of wrapped) {
      ensureSpace(lineHeight);
      page.drawText(seg, {
        x: marginX,
        y,
        size,
        font,
        color: isHeading ? rgb(0.1, 0.1, 0.12) : rgb(0.2, 0.2, 0.22),
      });
      y -= lineHeight;
    }
  }

  return pdf.save({ useObjectStreams: false });
}

export async function exportAnalysisReport(
  input: ReportExportInput,
  format: ReportExportFormat
): Promise<ExportedArtifact> {
  const exportedAt = new Date().toISOString();
  const payloadHash = input.isHistoricalView ? 'unavailable' : await computeSha256Hex(input.payloadText);
  const engineLabel =
    input.result?.inferenceSource === 'ON_DEVICE'
      ? 'Device (Gemini Nano)'
      : `Cloud (${input.result?.modelUsed || 'gemini-3.6-flash'})`;
  const privacyState = input.rehydratedLocally
    ? 'Locally Re-hydrated (Contains Real Values — Do Not Share Externally)'
    : 'Anonymized ([TOKEN_N] placeholders only)';

  const footerLines = input.isHistoricalView
    ? [
        '---',
        '### PrivaGuard Anonymized Cloud Snapshot',
        `- **Exported (UTC):** ${exportedAt}`,
        `- **Inference Engine:** ${engineLabel}`,
        '- **Vault Persistence:** Original secrets were never persisted (RAM-only vault)',
      ]
    : [
        '---',
        '### PrivaGuard Local Detection & Masking Proof',
        `- **Timestamp (UTC):** ${exportedAt}`,
        `- **Export Mode:** ${privacyState}`,
        `- **Inference Engine:** ${engineLabel}`,
        `- **Detected PII Masked Locally:** ${input.vaultCount} (regex ${input.sourceCounts.regex} / Nano ${input.sourceCounts.nano} / manual ${input.sourceCounts.manual})`,
        `- **Private Bytes Protected in RAM:** ${input.bytesShielded} bytes`,
        `- **Detected PII Sent to Cloud:** ${input.leakCount}`,
        `- **Sanitized Payload SHA-256:** \`${payloadHash}\``,
      ];

  const fullMarkdown = `${input.markdown}\n\n${footerLines.join('\n')}`;
  const stamp = Date.now();
  const baseName = `privaguard-${input.task}-${stamp}`;
  const encoder = new TextEncoder();

  if (format === 'md') {
    const bytes = encoder.encode(fullMarkdown);
    const mimeType = 'text/markdown;charset=utf-8';
    return { blob: new Blob([bytes], { type: mimeType }), bytes, fileName: `${baseName}.md`, mimeType };
  }

  if (format === 'txt') {
    const plain = stripMarkdownSyntax(fullMarkdown);
    const bytes = encoder.encode(plain);
    const mimeType = 'text/plain;charset=utf-8';
    return { blob: new Blob([bytes], { type: mimeType }), bytes, fileName: `${baseName}.txt`, mimeType };
  }

  if (format === 'json') {
    const payload = {
      exportedAt,
      task: input.task,
      inferenceSource: input.result?.inferenceSource ?? 'UNKNOWN',
      modelUsed: input.result?.modelUsed ?? '',
      rehydratedLocally: input.rehydratedLocally,
      isHistoricalSnapshot: input.isHistoricalView,
      privacyProof: {
        maskedCount: input.vaultCount,
        sourceCounts: input.sourceCounts,
        bytesShielded: input.bytesShielded,
        detectedLeaksSentToCloud: input.leakCount,
        sanitizedPayloadSha256: payloadHash,
      },
      structuredAudit: input.structuredAudit ?? null,
      markdown: input.markdown,
    };
    const jsonStr = JSON.stringify(payload, null, 2);
    const bytes = encoder.encode(jsonStr);
    const mimeType = 'application/json;charset=utf-8';
    return { blob: new Blob([bytes], { type: mimeType }), bytes, fileName: `${baseName}.json`, mimeType };
  }

  if (format === 'docx') {
    const bytes = await buildNativeDocxBytes(`PrivaGuard AI Report (${input.task})`, fullMarkdown);
    const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    return {
      blob: new Blob([bytes.buffer as ArrayBuffer], { type: mimeType }),
      bytes,
      fileName: `${baseName}.docx`,
      mimeType,
    };
  }

  // format === 'pdf'
  let bytes: Uint8Array;
  if (typeof document !== 'undefined') {
    const { renderStructuredTextToPdfBytes } = await import('./richPdfRenderer.ts');
    bytes = await renderStructuredTextToPdfBytes(
      'md',
      fullMarkdown,
      `PrivaGuard AI Report (${input.task})`,
      input.vaultCount,
      true
    );
  } else {
    bytes = await buildCleanPdfBytes(`PrivaGuard AI Report (${input.task})`, fullMarkdown, true);
  }
  const mimeType = 'application/pdf';
  return {
    blob: new Blob([bytes.buffer as ArrayBuffer], { type: mimeType }),
    bytes,
    fileName: `${baseName}.pdf`,
    mimeType,
  };
}
