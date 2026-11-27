# Devpost Submission — PrivaGuard AI v5.0 (#BuildHybridAI 2026)

## Tagline
Analyze confidential PDFs, DOCX files, logs, contracts, and images with Hybrid AI — while keeping 100% of your secrets and PII strictly on your device.

## Inspiration
Every day, engineers paste incident logs containing live API keys into AI tools, clinicians summarize patient notes with SSNs, and founders review NDAs containing bank details or scanned IDs. Sending raw sensitive data to cloud LLMs creates immediate GDPR, HIPAA, and SOC2 exposure — yet purely on-device models lack deep structured reasoning for complex audits.

We built **PrivaGuard AI (v5.0)** to prove **Hybrid AI** resolves this tradeoff cleanly: run deterministic + local OCR/document redaction strictly in browser RAM, send only anonymized tokens to **Firebase AI Logic** (Gemini Nano on-device or Gemini Cloud fallback), and re-hydrate real values locally on screen.

## What it does
1. **Zero-Leak On-Device Privacy Shield (`<1ms`)**: Detects and masks PEM private keys, JWTs, database URIs, API keys, credit cards/IBANs, SSNs, Vietnam 12-digit CCCD, VN/US phone numbers, valid IPv4 addresses (safely ignoring versions like `v1.2.3.4` and `1.2.3.4-rc1`), and case-insensitive custom terms.
2. **Local PDF & DOCX Drag-and-Drop (v5.0)**: Extracts text from `.pdf` (up to 25 pages via `pdfjs-dist`) and `.docx` (`mammoth`) directly in browser RAM — original files never leave the device. Includes 1-click **Try sample PDF** and **Try sample image** buttons.
3. **1-Click Auto-OCR Multimodal Image Redactor (v5.0)**: Runs lazy-loaded `tesseract.js` (`eng+vie`) + `ocrPiiMatcher` in-browser to auto-box PII on ID cards, receipts, and screenshots, then permanently flattens black `[HIDDEN]` bars and compresses to WebP locally.
4. **Visual Privacy Proof & SHA-256 Export (v5.0)**: Side-by-side **Diff** tab proves `0B leaked` before inference; exported `.md` reports embed a `SHA-256` Zero-Leak proof footer.
5. **Structured Security Audit via Firebase AI Logic (`responseSchema`)**: Uses `Schema.object(...)` on `gemini-3.6-flash` for a live Risk Score (`0–100`), compliance badges, and interactive remediation checklist — automatically falling back to `gemini-3.5-flash-lite` on HTTP 429 spikes and Markdown on Gemini Nano on-device.
6. **Collision-Free Follow-up Q&A & Offline Simulation**: Follow-ups inherit the local RAM vault without token collisions; a 1-click **Offline · On-device** toggle lets judges test `ONLY_ON_DEVICE` Gemini Nano immediately.

## How we built it
- **Frontend**: React 19, TypeScript 7, Tailwind CSS v4, Vite 8 with a Notion-inspired Light/Dark UI (`--n-*` tokens) and dynamic `import()` for all heavy modules (`pdfjs-dist`, `mammoth`, `tesseract.js`, `firebase/firestore`, `firebase/auth`, `ImageRedactorModal`) to keep the initial JS bundle lean.
- **Hybrid AI**: `firebase/ai` (`GoogleAIBackend`, `InferenceMode.PREFER_ON_DEVICE`, `ONLY_ON_DEVICE`, `PREFER_IN_CLOUD`, `ONLY_IN_CLOUD`, `Schema.object`, streaming TTFT telemetry, `AbortController` cancellation).
- **Firebase Security & Ops**: App Check (reCAPTCHA Enterprise enforced), Remote Config (`cloud_model` + prompt style), Anonymous Auth + owner-only immutable `firestore.rules`, and Firebase Hosting.
- **Privacy Model**: Document parsing, PII vaulting, Canvas redaction, and OCR run 100% in browser RAM/WASM. The Tesseract OCR language model (`eng+vie`) is downloaded once as a static asset; user images and text never leave the device.

## Challenges
- **Zero false-positive leaks**: Separating real IPv4 addresses and phone numbers from software versions (`v1.2.3.4`, `1.2.3.4-rc1`) and invalid dotted-quads (`999.999.999.999`) required boundary-aware regexes and token-boundary `verifyZeroLeak()`.
- **Keeping initial load fast with PDF/DOCX/OCR**: Bundling `pdfjs-dist`, `mammoth`, and `tesseract.js` eagerly would bloat initial paint; we isolated every heavy engine behind dynamic `import()` and Vite worker URLs.
- **Multi-turn token collisions**: Ensuring follow-up questions extend the active RAM vault cleanly so newly typed PII never overwrites document tokens.

## Accomplishments
- **10/10 automated unit tests passing** (`node:test`) covering PII shielding, edge cases, follow-up vault continuation, structured audit parsing, `eng+vie` OCR PII matching, and document classification.
- **1,000-document concurrency stress test**: **297ms total (`0.297ms/doc`), 5,000 secrets shielded, 0 leaks, 0 re-hydration mismatches**.
- **Clean production build**: `tsc --noEmit` 0 errors, `vite build` 0 warnings, and strict owner-scoped Firestore rules storing zero raw PII.

## What we learned
- Combining deterministic local shielding with Firebase AI Logic's Hybrid Nano/Cloud modes gives enterprises verifiable zero-leak guarantees without sacrificing structured reasoning quality.
- Visual proof (side-by-side Diff, click-to-peek tokens, SHA-256 footer) matters as much as the underlying cryptography for building user and auditor trust.

## What's next
- Optional WebGPU local NER models for domain-specific entity extraction alongside Gemini Nano.
- Team policy presets via Firebase Remote Config (HIPAA, PCI-DSS, SOC2 redaction profiles) and signed audit logs.

---

## 2-Minute Judge Walkthrough (4 "Aha!" Moments)

| Time | Scene / Action | Key Proof Point |
| :--- | :--- | :--- |
| **0:00 – 0:30** | **1. Side-by-Side Diff + Payload Inspector**<br/>Open live app → select **DevOps log** → click **Diff** tab. | Raw secrets highlighted in red on the left vs. exact `[TOKEN_N]` cloud payload (`0B leaked`) on the right in `<1ms`. |
| **0:30 – 1:05** | **2. Structured Audit JSON + Click-to-Peek**<br/>Press `Ctrl+Enter` → inspect Risk Score & remediation checklist → click `[SECRET_1]` to peek locally → export `.md`. | `gemini-3.6-flash` structured JSON via Firebase AI Logic + local RAM re-hydration + SHA-256 Zero-Leak proof footer. |
| **1:05 – 1:35** | **3. Sample PDF + Auto-OCR Sample ID Image**<br/>Click **Try sample PDF** (parsed locally) → click **Try sample image** → click **Auto-detect PII (OCR)** → **Apply mask**. | 100% browser-side PDF extraction and 1-click `tesseract.js` (`eng+vie`) auto-redaction flattened to WebP. |
| **1:35 – 2:00** | **4. Offline Simulation → On-Device Gemini Nano**<br/>Click **Offline · On-device** in topbar → open **Settings** drawer → save anonymized report to Firestore. | Forces `ONLY_ON_DEVICE` Gemini Nano via Firebase AI Logic; App Check enforced; zero raw PII stored in Firestore. |
