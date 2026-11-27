# PrivaGuard AI (v6.0) — #BuildHybridAI 2026 Submission

> **Use cloud AI on confidential docs — secrets never leave your browser.**

**Live Demo:** https://buildhybridai-tuananh.web.app
**Source Code:** https://github.com/tuananh810-fake/privaguard-hybrid-ai

---

## Inspiration
Engineers, clinicians, lawyers, and founders want to use frontier cloud models on incident logs, patient notes, and NDAs — yet pasting raw API keys, national IDs (CCCD/SSN), IBANs, or client names into a cloud LLM violates SOC2, GDPR, HIPAA, and company security policies. Meanwhile, regex-only redactors miss free-form names and street addresses, and pure on-device models lack the reasoning depth of frontier cloud models for complex multi-framework security audits.

We built **PrivaGuard AI** so **on-device Gemini Nano and Cloud Gemini work together as one true hybrid pipeline**: Nano discovers semantic PII locally before anything leaves the browser, while Cloud Gemini reasons exclusively over safe placeholder tokens.

## What it does
PrivaGuard AI is a calm, Notion-style Hybrid AI workspace where **0 detected PII is sent to the cloud**:

1. **Three-layer local PII shielding (with source provenance):**
   - **Regex layer (< 1 ms):** Catches structured secrets (JWT, PEM keys, DB URIs, API keys), cards/IBANs, SSNs/Vietnam 12-digit CCCDs, emails, phones, and valid IPv4s (`source: regex`).
   - **Gemini Nano semantic discovery (`InferenceMode.ONLY_ON_DEVICE`):** Runs locally (5 s timeout + `AbortController`, verbatim anti-hallucination filter, regex span deduplication) to detect free-form `PERSON`, `ORG`, `ADDRESS`, and `LOCATION` entities — including Vietnamese diacritics (`source: Nano`).
   - **Human-in-the-loop (`Mark as sensitive`, `Ctrl/Cmd+Shift+M`):** Highlight any confidential phrase or project codename to mask it instantly (`source: manual`).
2. **Local PDF/DOCX & Auto-OCR image redaction:** Drop `.pdf` (up to 25 pages via `pdfjs-dist`), `.docx` (`mammoth`), or images (`tesseract.js` `eng+vie` auto-OCR) — all extracted and masked strictly in browser RAM. Includes 1-click **Try sample PDF** and **Try sample image** buttons.
3. **Transparent Hybrid execution & metrics:** Clearly reports Nano readiness (or a dismissible setup banner), labels every output `Ran on: Device (Nano)` or `Ran on: Cloud (<model>)`, and renders a per-run **Hybrid Metrics Strip** (`Engine · Latency · TTFT · Masked rx/Na/man · Bytes to cloud · Raw PII bytes sent: 0 B`).
4. **Structured Security Audits & Safe Re-hydration:** Generates typed JSON risk cards (`riskLevel`, `riskScore`, `complianceFrameworks`, `findings`, interactive checklist) with click-to-peek local vault lookup, `unknown token` chips for hallucinated placeholders, SHA-256 Markdown proofs, and offline-capable PWA app shell.

## How we built it
- **Frontend & PWA:** React 19, TypeScript, Vite 8, Tailwind CSS v4 (Notion Light/Dark CSS tokens `--n-*`), and a hand-written Service Worker (`public/sw.js` + `manifest.webmanifest`) that caches the app shell and hashed chunks while strictly excluding Firebase/Google/reCAPTCHA APIs.
- **Hybrid AI & Firebase:** Firebase 13 (`firebase/ai`) routing between Chrome's built-in **Gemini Nano** (`ONLY_ON_DEVICE` semantic discovery + offline inference) and **Gemini 3.6 Flash** (with automatic `gemini-3.5-flash-lite` fallback on rate limits), managed dynamically via **Firebase Remote Config**, protected by **Firebase App Check (reCAPTCHA Enterprise)**, and persisted as anonymized owner-only snapshots in **Cloud Firestore** with **Firebase Anonymous Auth**.
- **Zero-bloat performance:** `nanoEntityDiscovery`, `pdfjs-dist`, `mammoth`, `tesseract.js`, `ImageRedactorModal`, and `historyStore` are all dynamically imported so the initial `index.js` bundle stays lean (`50.09 kB` gzip).

## Challenges we ran into
- **Preventing LLM hallucinations during local entity extraction:** Small on-device models can occasionally invent entities or emit broken JSON. We added a strict verbatim substring verifier, span-overlap deduplicator against regex matches, 5 s timeout + `AbortController`, and silent graceful fallback to `[]`.
- **Avoiding false positives & prompt-injection myths:** Early regex rules tripped on software versions (`v1.2.3.4`, `1.2.3.4-rc1`) and invalid dotted-quads (`999.999.999.999`). We built a 52-sample EN+VI accuracy benchmark with 11 decoy traps and an automated prompt-injection test proving the local RAM vault is never serialized into cloud payloads.
- **Honest privacy boundaries:** Instead of claiming "100% absolute zero-leak", we clearly communicate `"0 detected PII sent to cloud"` and remind users that detection = regex + on-device Nano + manual marks.

## Accomplishments that we're proud of
- **13/13 unit tests passing** (`node:test`), including Nano anti-hallucination filtering, unknown-token re-hydration auditing, prompt-injection defense, and `eng+vie` OCR bounding-box matching.
- **Measured regex accuracy:** **100.0% Precision · 100.0% Recall · 100.0% F1** across 52 synthetic EN+VI samples with **11/11 decoy traps rejected** (`scripts/eval-pii.ts`).
- **High-throughput local vault:** 1,000 concurrent documents shielded and re-hydrated in **255 ms** (`0.255 ms/doc`, 5,000 secrets, 0 detected leaks, 0 mismatches).
- **Lean bundle:** Initial JS stayed at **50.09 kB gzip** despite adding semantic Nano discovery, PDF/DOCX parsing, `eng+vie` OCR, and PWA offline support.

## What we learned
- Hybrid AI shines brightest when **on-device and cloud models have complementary roles** (Nano handles private local semantic discovery; Cloud handles complex structured reasoning over tokens) rather than merely acting as an online/offline fallback switch.
- Honest security communication — showing exact source badges (`regex` / `Nano` / `manual`), per-run cloud byte counts, and measured Precision/Recall — earns far more trust than absolute marketing claims.

## What's next
- Optional WebGPU/ONNX NER fallback for browsers without Chrome's Prompt API so non-Chrome users also get on-device semantic PII discovery.
- Team policy packs distributed via Firebase Remote Config (custom industry regexes for HIPAA, PCI-DSS, and Vietnam PDPD Decree 13).
- Exportable signed audit certificates for enterprise compliance pipelines.

---

## 2-Minute Judge Demo Script (4 Aha Moments)

| Timestamp | Aha Moment | What Judges See |
|---|---|---|
| **0:00 – 0:30** | **1. Hybrid Semantic Masking & Source Provenance** | Open **Diff** & **Payload**: token chips display `regex`, `Nano`, and `manual` tags; highlight a word and press `Ctrl/Cmd+Shift+M` (`Mark as sensitive`); verify `0 detected PII sent to cloud`. |
| **0:30 – 1:05** | **2. Structured Audit + Local Peek + Hybrid Metrics** | Click **Analyze safely** → typed JSON risk card renders with `Ran on: Cloud (gemini-3.6-flash)`, click any token chip to peek real values locally, inspect the **Hybrid Metrics Strip** (`Engine · Latency · TTFT · Masked rx/Na/man · Bytes to cloud · Raw PII bytes sent: 0 B`). |
| **1:05 – 1:35** | **3. 1-Click Sample PDF & Auto-OCR Image Masking** | Click **Try sample PDF** (2-page NDA parsed in RAM) → click **Try sample image** (synthetic ID card) → **Auto-detect PII** (`eng+vie` OCR masks ID, phone, and email locally). |
| **1:35 – 2:00** | **4. True Offline PWA → On-Device Gemini Nano** | Disconnect network / enable **Offline** → PWA Service Worker still opens the app shell and routes analysis to **Device (Nano)** with **0 B sent to cloud**. |
