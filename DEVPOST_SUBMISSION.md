# PrivaGuard AI (v6.2) — #BuildHybridAI 2026 Submission

> **Use cloud AI on confidential docs — secrets never leave your browser.**

**Live Demo:** https://buildhybridai-tuananh.web.app
**Source Code:** https://github.com/tuananh810-fake/privaguard-hybrid-ai

---

## Inspiration
Engineers, clinicians, lawyers, and founders want to use frontier cloud models on incident logs, patient notes, and NDAs — yet pasting raw API keys, national IDs (CCCD/SSN), IBANs, or client names into a cloud LLM violates SOC2, GDPR, HIPAA, and company security policies. Meanwhile, regex-only redactors miss free-form names and street addresses, and pure on-device models lack the reasoning depth of frontier cloud models for complex multi-framework security audits.

### Why Neither Cloud-Only Nor On-Device-Only Works

| Approach | Raw Secrets Privacy | Complex Audit Reasoning | Offline Availability |
|---|---|---|---|
| **Cloud-only** | Raw PII & secrets must leave the browser first | High (frontier cloud models) | None |
| **On-device-only** | Private (stays in browser) | Limited for deep multi-framework JSON audits | Full |
| **PrivaGuard Hybrid** (`Nano` local semantic PII + `Cloud` reasoning on tokens) | **0 detected PII sent to cloud** (regex + on-device Nano + manual marks) | **Frontier Gemini 3.6 Flash** reasoning over safe `[TOKEN_N]` placeholders + local RAM re-hydration | **Full** via PWA Service Worker + `ONLY_ON_DEVICE` Gemini Nano (`0 B` to cloud) |

We built **PrivaGuard AI** so **on-device Gemini Nano and Cloud Gemini work together as one true hybrid pipeline**: Nano discovers semantic PII locally before anything leaves the browser, while Cloud Gemini reasons exclusively over safe placeholder tokens.

## What it does
PrivaGuard AI is a calm, Notion-style Hybrid AI workspace where **0 detected PII is sent to the cloud**:

1. **Three-layer local PII shielding (with pre-send preview & source provenance):**
   - **Regex layer (< 1 ms):** Catches structured secrets (JWT, PEM keys, DB URIs, API keys), cards/IBANs, SSNs/Vietnam 12-digit CCCDs, emails, phones (including VN landlines `028-3822-1234`), and valid IPv4s (`source: regex`).
   - **Gemini Nano semantic discovery (`InferenceMode.ONLY_ON_DEVICE`):** Runs locally — either on-demand via an always-visible **Scan semantic PII (Nano)** bar in Diff/Payload *before* sending, automatically during analysis, and on follow-up questions (timeout + `AbortController`, verbatim anti-hallucination filter, regex span deduplication, fingerprint reuse, and honest `scannedChars / totalChars` truncation notices for long docs) — to detect free-form `PERSON`, `ORG`, `ADDRESS`, and `LOCATION` entities, including Vietnamese diacritics (`source: Nano`).
   - **Human-in-the-loop (`Mark as sensitive`, `Ctrl/Cmd+Shift+M`):** Highlight any confidential phrase or project codename to mask it instantly (`source: manual`).
2. **Local PDF/DOCX & Auto-OCR image redaction:** Drop `.pdf` (up to 25 pages via `pdfjs-dist`), `.docx` (`mammoth`), or images (`tesseract.js` `eng+vie` auto-OCR) — all extracted and masked strictly in browser RAM. Includes 1-click **Try sample PDF** and **Try sample image** buttons.
3. **Transparent Hybrid execution & metrics:** Clearly reports Nano readiness (with 1-click **Enable Gemini Nano →** settings drawer), passes `onDeviceParams.createOptions.initialPrompts` so offline Nano preserves `[TOKEN_N]` placeholders, labels every output `Ran on: Device (Nano)` or `Ran on: Cloud (<model>)`, and renders a per-run **Hybrid Metrics Strip** (`Engine · Latency · TTFT · Masked rx/Na/man · Bytes to cloud · Raw PII bytes sent: 0 B` computed in exact UTF-8 bytes via `TextEncoder`).
4. **Structured Security Audits, Immutable SHA-256 Proofs & Read-Only Cloud Snapshots:** Generates typed JSON risk cards (`riskLevel`, `riskScore`, `complianceFrameworks`, `findings`, interactive checklist) with click-to-peek local vault lookup, `unknown token` chips for hallucinated placeholders, immutable run-snapshot SHA-256 Markdown proofs, read-only Firestore cloud snapshot mode (disabling re-hydration & follow-up to prove secrets were never persisted), and an offline-capable PWA app shell (`privaguard-shell-v6.2.3` + full PNG icons & Open Graph metadata).

## How we built it
- **Frontend & PWA:** React 19, TypeScript, Vite 8, Tailwind CSS v4 (Notion Light/Dark CSS tokens `--n-*`), Open Graph/Twitter social cards (`og-image.png`), full PNG PWA icons (`192×192`, `512×512`, `180×180`), and a hand-written Service Worker (`public/sw.js` + `manifest.webmanifest`) that caches the app shell and hashed chunks while strictly excluding Firebase/Google/reCAPTCHA APIs.
- **Hybrid AI & Firebase:** Firebase 13 (`firebase/ai`) routing between Chrome's built-in **Gemini Nano** (`ONLY_ON_DEVICE` semantic discovery + offline inference with `onDeviceParams` system prompts) and **Gemini 3.6 Flash** (with automatic `gemini-3.5-flash-lite` fallback on rate limits/404), managed dynamically via **Firebase Remote Config**, protected by **Firebase App Check (reCAPTCHA Enterprise)**, and persisted as sanitized, anonymized owner-only snapshots in **Cloud Firestore** with **Firebase Anonymous Auth**.
- **Zero-bloat performance:** `nanoEntityDiscovery`, `pdfjs-dist`, `mammoth`, `tesseract.js`, `ImageRedactorModal`, and `historyStore` are all dynamically imported so the initial `index.js` bundle stays lean (`51.81 kB` gzip).

## Challenges we ran into
- **Preventing LLM hallucinations during local entity extraction:** Small on-device models can occasionally invent entities or emit broken JSON. We added a strict verbatim substring verifier, span-overlap deduplicator against regex matches, 5 s timeout + `AbortController`, and silent graceful fallback to `[]`.
- **Avoiding false positives & prompt-injection myths:** Early regex rules tripped on software versions (`v1.2.3.4`, `1.2.3.4-rc1`) and invalid dotted-quads (`999.999.999.999`). We built a 52-sample EN+VI accuracy benchmark with 11 decoy traps and an automated prompt-injection test proving the local RAM vault is never serialized into cloud payloads.
- **Honest privacy boundaries:** Instead of claiming "100% absolute zero-leak", we clearly communicate `"0 detected PII sent to cloud"` and remind users that detection = regex + on-device Nano + manual marks.

## Accomplishments that we're proud of
- **16/16 unit tests passing** (`node:test`), including Nano anti-hallucination filtering & long-doc chunk truncation (`> 5,160` chars), Firestore payload clamping (`sanitizeAnalysisPayload`), unknown-token re-hydration auditing, prompt-injection defense, exact UTF-8 `rawPiiBytesSent` on Vietnamese diacritics, VN landline `028-3822-1234` redaction, and `eng+vie` OCR bounding-box matching.
- **Measured regex accuracy:** **100.0% Precision · 100.0% Recall · 100.0% F1** across 52 synthetic EN+VI samples with **11/11 decoy traps rejected** (`scripts/eval-pii.ts`).
- **High-throughput local vault:** 1,000 concurrent documents shielded and re-hydrated in **269 ms** (`0.269 ms/doc`, 5,000 secrets, 0 detected leaks, 0 mismatches).
- **Lean bundle:** Initial JS stayed at **51.81 kB gzip** (`179.81 kB` raw) despite adding pre-send & follow-up Nano semantic discovery, historical snapshot isolation, immutable SHA-256 export snapshots, PDF/DOCX parsing, `eng+vie` OCR, and PWA offline support.

## What we learned
- Hybrid AI shines brightest when **on-device and cloud models have complementary roles** (Nano handles private local semantic discovery; Cloud handles complex structured reasoning over tokens) rather than merely acting as an online/offline fallback switch.
- Honest security communication — showing exact source badges (`regex` / `Nano` / `manual`), per-run cloud byte counts, and measured Precision/Recall — earns far more trust than absolute marketing claims.

## What's next
- Optional WebGPU/ONNX NER fallback for browsers without Chrome's Prompt API so non-Chrome users also get on-device semantic PII discovery.
- Team policy packs distributed via Firebase Remote Config (custom industry regexes for HIPAA, PCI-DSS, and Vietnam PDPD Decree 13).
- Exportable signed audit certificates for enterprise compliance pipelines.

---

## Final Demo Video Chapters (2:47 · 1080p)

| Timestamp | Chapter | What Judges See |
|---|---|---|
| **0:00 – 0:20** | **Intro · Hybrid Privacy Vision** | Confidential contract risk → on-device Gemini Nano local RAM shield → only safe placeholder tokens travel to Cloud Gemini (`0 detected PII leaked`). |
| **0:20 – 0:53** | **Step 1 / 4 · Local PDF & 3-Layer Shield** | Live on Firebase Hosting (`Gemini Nano ready`) → **Try sample PDF** (2-page NDA parsed 100% locally) → **Diff** (regex masks emails, phones, API keys, IDs) → **Scan semantic PII (Nano)** → **Payload** (`0 detected PII included`). |
| **0:53 – 1:41** | **Step 2 / 4 · Hybrid Audit, RAM Re-hydration & Cloud Snapshot** | **Analyze safely** in `Auto Hybrid` (`Device (Nano)` · `0 B to cloud`, seamless Cloud `gemini-3.6-flash` fallback on safe tokens) → structured GDPR/SOC2/OWASP audit + **Hybrid Metrics Strip** → **Show real names** instant RAM restore → **Save** → reopen from **History** in read-only **Anonymized Cloud Snapshot** mode (`Original secrets were never persisted`). |
| **1:41 – 2:01** | **Step 3 / 4 · Client-Side Auto-OCR Image Redaction** | **Try sample image** (employee ID card) → Image Redactor → **Auto-detect PII** (`tesseract.js` locally draws 3 solid black boxes) → **Apply mask (3)** attaches only the redacted image. |
| **2:01 – 2:26** | **Step 4 / 4 · Strict Offline Mode & Multimodal Nano Audit** | **Settings** → enable **Simulate offline mode** + **Strict Offline** (`Offline · On-device`) → load **DevOps log** + redacted ID card → **Analyze safely** executes full multimodal incident audit entirely on-device (`0 B` to cloud, offline PWA shell). |
| **2:26 – 2:47** | **Outro · Architecture & Verified Benchmarks** | Cloud-only vs On-device-only vs PrivaGuard Hybrid comparison, `100.0% F1`, `16/16` unit tests, `0.27 ms/doc`, `51.8 kB` gzip bundle, Firebase stack & live links. |

---

## Devpost Form Quick-Fill Checklist

- **Project Name:** `PrivaGuard AI`
- **Tagline (<= 140 chars):** `Use frontier cloud AI on confidential docs & IDs — on-device Gemini Nano shields PII in RAM so 0 detected secrets ever reach the cloud.`
- **Built With:** `firebase`, `firebase-ai-logic`, `gemini-nano`, `gemini`, `firebase-app-check`, `cloud-firestore`, `firebase-hosting`, `firebase-remote-config`, `react`, `typescript`, `tailwindcss`, `vite`, `pwa`, `tesseract-js`, `pdf-js`
- **Try It Out Links:**
  - Live Web App: `https://buildhybridai-tuananh.web.app`
  - GitHub Repository: `https://github.com/tuananh810-fake/privaguard-hybrid-ai`
- **Image Gallery (1080p PNGs in `docs/screenshots/`):**
  1. `06-architecture-metrics-slide.png` *(recommended Cover / Thumbnail)*
  2. `01-local-diff-shield.png`
  3. `02-payload-zero-pii.png`
  4. `03-cloud-snapshot-audit.png`
  5. `04-auto-ocr-id-redaction.png`
  6. `05-strict-offline-nano.png`
- **Demo Video:** Upload `submission-pack/privaguard-demo-v1.mp4` (`2:47`, burned-in English captions) or `privaguard-demo-clean.mp4` + `privaguard-demo.srt` to YouTube (Public/Unlisted) and paste the URL into Devpost.
