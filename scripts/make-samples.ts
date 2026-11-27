import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';

const SAMPLES_DIR = path.resolve(process.cwd(), 'public', 'samples');

async function generateNdaPdf(): Promise<string> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle('Mutual NDA Sample (Synthetic Data Only)');
  pdfDoc.setAuthor('PrivaGuard AI Demo Generator');

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Page 1 — Agreement Overview & Party Contact Details
  const page1 = pdfDoc.addPage([612, 792]);
  const margin = 54;
  let y = 738;

  const drawHeading = (page: typeof page1, text: string) => {
    page.drawText(text, { x: margin, y, size: 16, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
    y -= 24;
  };

  const drawSubheading = (page: typeof page1, text: string) => {
    y -= 6;
    page.drawText(text, { x: margin, y, size: 11.5, font: fontBold, color: rgb(0.06, 0.48, 0.42) });
    y -= 18;
  };

  const drawLines = (page: typeof page1, lines: string[]) => {
    for (const line of lines) {
      page.drawText(line, { x: margin, y, size: 10.5, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });
      y -= 16;
    }
    y -= 6;
  };

  drawHeading(page1, 'MUTUAL NON-DISCLOSURE AGREEMENT (SYNTHETIC SAMPLE)');
  drawLines(page1, [
    'Effective Date: November 15, 2026 | Agreement ID: NDA-2026-DEMO-041',
    'Notice: All personal, financial, and technical identifiers below are 100% fictional.',
  ]);

  drawSubheading(page1, '1. Parties & Designated Contacts');
  drawLines(page1, [
    'Disclosing Party: NovaGrid Cloud Ltd., 450 Market Street, Suite 1800, San Francisco, CA 94105',
    'Primary Contact: Elena Vance (VP Engineering)',
    'Email: elena.vance@novagrid-demo.io | Phone: +1-415-555-0192',
    '',
    'Receiving Party: Apex Meridian Labs, 128 Nguyen Hue Blvd, District 1, Ho Chi Minh City',
    'Primary Contact: Marcus Sterling (Head of Security)',
    'Email: legal@apexmeridian-demo.com | Local Hotline: 0912 345 678',
  ]);

  drawSubheading(page1, '2. Confidential Information & Escrow Settlement');
  drawLines(page1, [
    'Both parties agree to protect all proprietary source code, security audit reports, customer',
    'records, and financial settlement details disclosed during the Hybrid AI pilot evaluation.',
    'Approved Escrow Account (IBAN): DE89370400440532013000',
    'Authorized Signatory National ID (CCCD): 079092004812',
  ]);

  drawSubheading(page1, '3. Data Protection & Zero-Leak Requirement');
  drawLines(page1, [
    'Receiving Party shall not transmit raw personally identifiable information (PII) or live',
    'credentials to third-party cloud LLM endpoints without prior local tokenization and',
    'cryptographic verification of zero raw-secret egress.',
  ]);

  // Page 2 — Technical Appendix & Sandbox Credentials
  const page2 = pdfDoc.addPage([612, 792]);
  y = 738;

  drawHeading(page2, 'APPENDIX A — TECHNICAL SANDBOX & ACCESS DETAILS');
  drawLines(page2, [
    'This appendix lists synthetic staging parameters used for integration risk assessment.',
  ]);

  drawSubheading(page2, '1. Network & Telemetry Endpoints');
  drawLines(page2, [
    'Internal Gateway IPv4: 10.42.18.94',
    'Staging Bastion Host: 192.168.88.14',
    'Release Baseline: v2.4.1 (do not redact software version tags)',
  ]);

  drawSubheading(page2, '2. Provisioned Integration Credentials (Demo Only)');
  drawLines(page2, [
    'Billing Webhook API Key: sk_test_demo99482716540192837465abcd',
    'Escalation Contact Email: secops-oncall@novagrid-demo.io',
    'Emergency SMS Phone: +1-650-555-0148',
  ]);

  drawSubheading(page2, '3. Signatures');
  drawLines(page2, [
    'Signed for NovaGrid Cloud Ltd.: Elena Vance — November 15, 2026',
    'Signed for Apex Meridian Labs: Marcus Sterling — November 15, 2026',
  ]);

  const pdfBytes = await pdfDoc.save();
  const outPath = path.join(SAMPLES_DIR, 'nda-sample.pdf');
  await writeFile(outPath, pdfBytes);
  return outPath;
}

async function generateIdCardPng(): Promise<string> {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="680" viewBox="0 0 1100 680">
  <rect width="1100" height="680" fill="#F4F4F2" />
  <rect x="40" y="40" width="1020" height="600" rx="24" fill="#FFFFFF" stroke="#D4D4D0" stroke-width="3" />
  <rect x="40" y="40" width="1020" height="108" rx="24" fill="#0F7B6C" />
  <rect x="40" y="110" width="1020" height="38" fill="#0F7B6C" />

  <text x="84" y="102" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="#FFFFFF">
    ACME DEMO CORP — EMPLOYEE ID CARD
  </text>
  <text x="84" y="132" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="400" fill="#E6F4F1">
    SYNTHETIC SAMPLE FOR LOCAL OCR PII REDACTION
  </text>

  <!-- Avatar placeholder -->
  <rect x="84" y="192" width="220" height="270" rx="14" fill="#F0F0ED" stroke="#D4D4D0" stroke-width="2" />
  <circle cx="194" cy="285" r="46" fill="#B8B8B2" />
  <path d="M126 420 C126 365, 262 365, 262 420 Z" fill="#B8B8B2" />
  <text x="194" y="448" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" fill="#666660">
    DEMO PHOTO
  </text>

  <!-- High-contrast printed fields for reliable Tesseract OCR -->
  <text x="350" y="220" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#666660">FULL NAME</text>
  <text x="350" y="262" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="700" fill="#111111">NGUYEN VAN AN</text>

  <text x="350" y="316" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#666660">DATE OF BIRTH</text>
  <text x="350" y="352" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="#111111">1994-08-15</text>

  <text x="680" y="316" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#666660">NATIONAL ID</text>
  <text x="680" y="352" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="#111111">079094008123</text>

  <text x="350" y="416" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#666660">PHONE NUMBER</text>
  <text x="350" y="454" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="#111111">0912 345 678</text>

  <text x="350" y="516" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#666660">WORK EMAIL</text>
  <text x="350" y="554" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="#111111">van.an.demo@privaguard.test</text>

  <text x="84" y="554" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#666660">ID: EMP-2026-884</text>
</svg>
`.trim();

  const outPath = path.join(SAMPLES_DIR, 'id-card-sample.png');
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(outPath);
  return outPath;
}

async function main() {
  await mkdir(SAMPLES_DIR, { recursive: true });
  const pdfPath = await generateNdaPdf();
  const pngPath = await generateIdCardPng();
  console.log(`Generated sample PDF: ${pdfPath}`);
  console.log(`Generated sample PNG: ${pngPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
