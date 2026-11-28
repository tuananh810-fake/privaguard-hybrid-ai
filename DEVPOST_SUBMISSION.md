# PrivaGuard AI (v7.1) — #BuildHybridAI 2026 Submission

> **Use cloud AI on confidential docs — secrets never leave your browser.**

**Live Demo:** https://buildhybridai-tuananh.web.app
**Demo Video (2:21, 1080p):** https://youtu.be/RKsPo-4NGts
**Source Code:** https://github.com/tuananh810-fake/privaguard-hybrid-ai

---

## Inspiration
Engineers, clinicians, lawyers, students, and founders want to use frontier cloud models on incident logs, patient notes, NDAs, and technical assignments — yet pasting raw API keys, national IDs (CCCD/SSN), IBANs, or client names into a cloud LLM violates SOC2, GDPR, HIPAA, and company security policies. Conversely, naive regex redactors break educational/lab documents (e.g., Cisco Packet Tracer topologies or coding tutorials), strip Word/PDF layouts into flat text walls, and cannot export redacted files in the exact format users need.

### Why Neither Cloud-Only Nor On-Device-Only Works

| Approach | Raw Secrets Privacy | Complex Audit Reasoning | Offline Availability |
|---|---|---|---|
| **Cloud-only** | Raw PII & secrets must leave the browser first | High (frontier cloud models) | None |
| **On-device-only** | Private (stays in browser) | Limited for deep multi-framework JSON audits | Full |
| **PrivaGuard Hybrid** (`Nano` local semantic PII + `Cloud` reasoning on tokens) | **0 detected PII sent to cloud** (Regex + 3-Tier Context Guard + on-device Nano + manual marks) | **Frontier Gemini 3.6 Flash** reasoning over safe `[TOKEN_N]` placeholders + local RAM re-hydration | **Full** via PWA Service Worker (`privaguard-shell-v7.1.0`) + `ONLY_ON_DEVICE` Gemini Nano (`0 B` to cloud) |

We built **PrivaGuard AI** so **on-device Gemini Nano and Cloud Gemini work together as one true hybrid pipeline**: Nano discovers semantic PII & adjudicates ambiguous context locally before anything leaves the browser, while Cloud Gemini reasons exclusively over safe placeholder tokens.

## What it does
PrivaGuard AI is a calm, Notion-style **Local-First Hybrid AI Redaction Studio** (Web App powered by Firebase AI Logic + MV3 Chrome Extension companion sharing the pure TypeScript privacy core) where **0 detected PII is sent to the cloud**:

1. **Generalized 3-Tier Context-Aware Sensitivity Engine (`sensitivityEngine.ts`):**
   - **Tier 0 (< 0.1 ms):** Luhn checksum, Shannon entropy, sandbox test cards, IETF RFC 5737/2606/6761, NANP-555, and placeholder secret filters.
   - **Tier 1 (Multi-domain EN+VI Context Scorer):** Distinguishes real confidential secrets/PII from educational/Cisco/lab/tutorial/public examples — enforcing a **`MIXED_HYBRID` hard-secret invariant** so live API keys, JWTs, PEM blocks, DB URIs, and real CCCD/SSN are **always** masked even inside homework or tutorials.
   - **Tier 2 (On-device Gemini Nano `ONLY_ON_DEVICE`):** Discovers free-form `PERSON`, `ORG`, `ADDRESS`, and `LOCATION` entities (including Vietnamese diacritics) and adjudicates ambiguous context locally (never allowed to downgrade hard secrets).
2. **Document-First Native Visual Preview & Interactive Leak Inspector:**
   - Uploading `.pdf`, `.docx`, `.csv`, `.json`, `.md`, `.env`/`.log`/`.txt`, or images automatically opens the **`Preview`** tab in the document's authentic layout (multi-page PDF canvas, styled A4 Word view with headings/tables/images, RFC-4180 CSV table, formatted JSON, rendered Markdown, or line-numbered code).
   - Toggle instantaneously between **`Highlight leaks`** (red/amber overlays showing exact exposed text + source `regex`/`Nano`/`manual`) and **`Redacted preview`** (solid-black `[TOKEN_N]` boxes matching the exported file).
   - Click any highlighted entity to **Keep visible (Whitelist)** for the session, highlight text to **Mark as sensitive** (`Ctrl/Cmd+Shift+M`), or toggle **`Draw mask`** to drag custom redaction boxes over signatures, stamps, or scanned regions directly on PDF pages.
3. **Format-Preserving & Cross-Format Redacted Export (100% in Browser RAM):**
   - **Same-format preservation:** `.pdf → .pdf` (2x DPI visual burn-in of vault + manual boxes, 0 hidden text, stripped metadata), `.docx → .docx` (in-place OpenXML run-merging across `document`, `header*`, `footer*`, `footnotes`, `endnotes`, `comments.xml` + scrubbed `core.xml`/`app.xml` + shaded `[TOKEN_N]` runs), `.csv → .csv` (RFC-4180 quote-safe), `.json → .json` (AST syntax-safe), and Auto-OCR redacted images (`tesseract.js` `eng+vie`).
   - **Cross-format conversion (`DOCX / CSV / MD / JSON → Redacted PDF` & `Any → DOCX`):** Pure Canvas 2x DPI A4 renderer (`richPdfRenderer.ts`, zero extra deps) preserves Word tables, headings, lists, embedded images, and **full Vietnamese Unicode diacritics** with solid-black `[TOKEN_N]` pills, zero hidden text, and stripped metadata.
4. **Hybrid AI Routing, Model Selector, Multi-Format Reports & MV3 Chrome Extension:**
   - Switch between **`Auto Hybrid | Fast Cloud | Strict Offline`** inline, choose Cloud Model (`Auto` / `Gemini 3.6 Flash` / `Gemini 3.5 Flash-Lite`), isolate response caches per active model (`12 s` TTFT timeout + `90 s` cooldown + 1-click `Retry 3.6 Flash`), export structured Risk Card reports as `.pdf`, `.docx`, `.md`, `.json`, or `.txt`, and save read-only **Anonymized Cloud Snapshots** in Firestore.
   - **Chrome Extension Companion (`extension/`):** Manifest V3 Shadow DOM Shield Bar on ChatGPT, Claude, and Gemini — intercepts pastes and `<input type="file">` / drag-drop uploads (`DataTransfer` swap + MV3 Offscreen Document for CSP-free `.pdf` redaction), sharing the exact pure TypeScript redaction engine.

## How we built it
- **Web App & PWA:** React 19, TypeScript, Vite 8, Tailwind CSS v4 (Notion Light/Dark CSS tokens `--n-*`), viewport-locked split-pane layout (`1280×720` and `1920×1080`), hardened Firebase Hosting headers (`X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `no-cache` on `/`, `/index.html`, `/sw.js`), and Service Worker `privaguard-shell-v7.1.0` with live `"Update ready · Reload"` notification.
- **Hybrid AI & Firebase:** Firebase 13 (`firebase/ai`) routing between Chrome's built-in **Gemini Nano** (`ONLY_ON_DEVICE` semantic discovery + offline inference with `onDeviceParams`) and **Gemini 3.6 Flash** (with `12 s` TTFT / HTTP 429 fallback to `gemini-3.5-flash-lite`), managed via **Firebase Remote Config**, protected by **Firebase App Check (reCAPTCHA Enterprise)**, and persisted as sanitized owner-only snapshots in **Cloud Firestore** with **Firebase Anonymous Auth**.
- **Zero-bloat architecture:** `DocumentPreviewPane`, `PdfPreviewPane`, `DocxPreviewPane`, `richPdfRenderer`, `fileRedactor`, `reportExporter`, `ImageRedactorModal`, `nanoEntityDiscovery`, `historyStore`, `pdfjs-dist`, `pdf-lib`, `mammoth`, `jszip`, and `tesseract.js` are all dynamically imported so the initial `index.js` chunk stays lean (**`53.98 kB` gzip**, `<= 55 kB` budget).

## Accomplishments that we're proud of
- **Automated Verification Gate (`npm run verify` + CI):** **37/37 unit tests passing** (`node:test`) covering regex & Nano shielding, 3-Tier Context Guard, `ignoredValues` whitelisting, in-place DOCX (`document`/`header`/`footer`/`comments`/`core`/`app`), RFC-4180 CSV, AST JSON, visual PDF + manual boxes, cross-format `DOCX → PDF` & `CSV → PDF`, XSS HTML sanitization, model cache isolation, prompt-injection defense, and strict MV3 Chrome Extension TypeScript + build checks.
- **Measured Regex PII Accuracy (`npm run eval`):** **100.0% Precision · 100.0% Recall · 100.0% F1** across 52 EN+VI samples with **11/11 decoy traps rejected**.
- **Measured Context-Aware Accuracy (`npm run eval:context`):** **42/42 (100.0%) Context Accuracy · 41/41 (100.0%) Secret Recall · 48/48 (100.0%) Benign/Lab Preservation** at **`0.062 ms/doc`** (62.3 ms per 1,000 docs).
- **High-Throughput Local Vault (`npm run stress`):** **1,000 concurrent documents** (5,000 secrets) shielded & re-hydrated in **265 ms (`0.265 ms/doc`)**, **0 leaks, 0 mismatches**.
- **Lean Production Bundles:** Web initial JS **`53.98 kB` gzip** (`<= 55 kB` budget); Chrome Extension `background.js` `9.8 kB`, `content.js` `~141 kB`, `offscreen.js` lazy-loaded only for `.pdf`.

## What we learned
- Hybrid AI shines brightest when **on-device and cloud models have complementary roles** (Nano handles private local semantic discovery & context adjudication; Cloud handles complex multi-framework reasoning over tokens).
- Showing the user **their actual original document layout** with toggleable `Highlight leaks` vs `Redacted preview`, 1-click whitelisting, and true cross-format redacted exports (`DOCX → PDF`) builds far deeper trust than raw text redaction alone.

## What's next
- Optional WebGPU/ONNX NER fallback for browsers without Chrome's Prompt API.
- Team policy packs distributed via Firebase Remote Config (custom regex/context packs for HIPAA, PCI-DSS, and Vietnam PDPD Decree 13).
- Chrome Web Store publishing for the MV3 companion extension.

---

## Demo Video v2 Storyboard (`2:21`, 1080p 30fps — https://youtu.be/RKsPo-4NGts)

| Timestamp | Chapter | What Judges See |
|---|---|---|
| **0:00 – 0:18** | **Hybrid Privacy Vision (Intro)** | Confidential contract risk → on-device Gemini Nano local RAM shield → only safe placeholder tokens travel to Cloud Gemini (`0 detected PII leaked`). |
| **0:18 – 0:45** | **Step 1 / 4 — Local 3-Layer Shield** | Live on Firebase Hosting (`● Gemini Nano` & `● Hybrid`) → **NDA PDF** (`nda-sample.pdf`, 2 pages extracted locally, 11 regex entities) → **Diff** → **Scan semantic PII (Nano)** catches **6** real semantic entities locally → **Payload** (`0 detected PII included`). |
| **0:45 – 1:20** | **Step 2 / 4 — Hybrid Cloud Audit & Snapshot** | Inline mode pill (`Auto Hybrid` · `Fast Cloud` · `Strict Offline`) → **Fast Cloud** → **Analyze safely** → typed Risk Card (`GDPR · PCI-DSS · SOC2 · OWASP`) → **Show real names** restores real secrets from RAM → **Save** → **History** drawer opens read-only **Anonymized Cloud Snapshot**. |
| **1:20 – 1:37** | **Step 3 / 4 — Local Auto-OCR Image Redaction** | **ID image** (`id-card-sample.png`) → **Hide areas** → **Auto-detect PII** (`tesseract.js` locally draws **3** solid black `[HIDDEN]` boxes over National ID, Phone, and Email) → **Apply mask (3)** attaches only the redacted image. |
| **1:37 – 2:01** | **Step 4 / 4 — True Offline Mode & On-Device Nano (`0 B`)** | **DevOps log** → real browser network disconnect flips top-bar to **`● Offline · On-device`** → **Strict Offline** → **Analyze safely** runs entirely on **`Device (Nano)`** (`Bytes to cloud: 0 B`, `Raw PII bytes sent: 0 B`). |
| **2:01 – 2:21** | **Outro — Architecture & Verified Benchmarks** | Cloud-only vs On-device-only vs PrivaGuard Hybrid comparison, verified accuracy & latency metrics, Firebase stack & live links. |
