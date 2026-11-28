# PrivaGuard AI (v6.3) — #BuildHybridAI 2026 Submission

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
| **PrivaGuard Hybrid** (`Nano` local semantic PII + `Cloud` reasoning on tokens) | **0 detected PII sent to cloud** (regex + on-device Nano + manual marks) | **Frontier Gemini 3.6 Flash** reasoning over safe `[TOKEN_N]` placeholders + local RAM re-hydration | **Full** via PWA Service Worker (`privaguard-shell-v6.3.2`) + `ONLY_ON_DEVICE` Gemini Nano (`0 B` to cloud) |

We built **PrivaGuard AI** so **on-device Gemini Nano and Cloud Gemini work together as one true hybrid pipeline**: Nano discovers semantic PII locally before anything leaves the browser, while Cloud Gemini reasons exclusively over safe placeholder tokens.

## What it does
PrivaGuard AI is a calm, Notion-style Hybrid AI workspace where **0 detected PII is sent to the cloud**:

1. **Three-layer local PII shielding (with pre-send preview, Cancel & honest timeout status):**
   - **Regex layer (< 1 ms):** Catches structured secrets (JWT, PEM keys, DB URIs, API keys), cards/IBANs, SSNs/Vietnam 12-digit CCCDs, emails, phones (including VN landlines `028-3822-1234`), and valid IPv4s (`source: regex`).
   - **Gemini Nano semantic discovery (`InferenceMode.ONLY_ON_DEVICE`):** Runs locally — either on-demand via an always-visible **Scan semantic PII (Nano)** bar in Diff/Payload *before* sending (**30 s** timeout + live **Cancel** button), automatically during analysis (**12 s** timeout), and on follow-up questions (**5 s** timeout) — with `AbortController`, honest timeout notices (`Nano timed out (Ns) · retry scan or mark names manually` / `kept N partial entities`), verbatim anti-hallucination filter, span deduplication, fingerprint reuse, and honest `scannedChars / totalChars` truncation notices for long docs to detect free-form `PERSON`, `ORG`, `ADDRESS`, and `LOCATION` entities, including Vietnamese diacritics (`source: Nano`).
   - **Human-in-the-loop (`Mark as sensitive`, `Ctrl/Cmd+Shift+M`):** Highlight any confidential phrase or project codename to mask it instantly (`source: manual`).
2. **Local PDF/DOCX & Auto-OCR image redaction:** Drop `.pdf` (up to 25 pages via `pdfjs-dist`), `.docx` (`mammoth`), or images (`tesseract.js` `eng+vie` auto-OCR) — all extracted and masked strictly in browser RAM. Includes 1-click **NDA PDF** and **ID image** sample buttons.
3. **Inline Hybrid Mode Pill, 8 s Cloud TTFT Cooldown & Instant Abort:** Switch effortlessly between **`Auto Hybrid | Fast Cloud | Strict Offline`** directly in the workspace action bar. Reports Nano readiness at startup, passes `onDeviceParams.createOptions.initialPrompts` + `expectedOutputs` so offline Nano preserves `[TOKEN_N]` placeholders, trims oversized inputs automatically in Strict Offline (`0 B` to cloud), falls back to `gemini-3.5-flash-lite` after an **8 s** TTFT timeout with a **5-minute** session cooldown, aborts immediately during TTFT, labels every output `Ran on: Device (Nano)` or `Ran on: Cloud (<model>)`, and renders a per-run **Hybrid Metrics Strip** (`Engine · Latency · TTFT · Masked rx/Na/man · Bytes to cloud · Raw PII bytes sent: 0 B` computed in exact UTF-8 bytes via `TextEncoder`).
4. **Structured Security Audits, Immutable SHA-256 Proofs & Slide-Over History Snapshots:** Generates typed JSON Risk Cards (`riskLevel`, `riskScore`, `complianceFrameworks`, `findings`, interactive checklist) with click-to-peek local vault lookup on any chip (including Nano `[PERSON_1]`), `unknown token` chips for hallucinated placeholders, immutable run-snapshot SHA-256 Markdown proofs, a slide-over **`History`** drawer opening read-only **Anonymized Cloud Snapshots** (disabling re-hydration & follow-up to prove secrets were never persisted), and an offline-capable PWA app shell (`privaguard-shell-v6.3.2`, `X-Frame-Options: SAMEORIGIN`, full PNG icons & Open Graph metadata).

## How we built it
- **Frontend & PWA:** React 19, TypeScript, Vite 8, Tailwind CSS v4 (Notion Light/Dark CSS tokens `--n-*`), viewport-locked desktop split-pane layout (`1280×720` and `1920×1080` zero clipping), Open Graph/Twitter social cards (`og-image.png`), full PNG PWA icons (`192×192`, `512×512`, `180×180`), hardened Firebase Hosting headers (`X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `no-cache` on `/`, `/index.html`, `/sw.js`), `robots.txt` & `sitemap.xml`, and a hand-written Service Worker (`public/sw.js` `privaguard-shell-v6.3.2` + `manifest.webmanifest`) that caches the app shell and hashed chunks while strictly excluding Firebase/Google/reCAPTCHA APIs.
- **Hybrid AI & Firebase:** Firebase 13 (`firebase/ai`) routing between Chrome's built-in **Gemini Nano** (`ONLY_ON_DEVICE` semantic discovery + offline inference with `onDeviceParams` system prompts) and **Gemini 3.6 Flash** (with automatic **8 s TTFT timeout / HTTP 429 + 5-minute session cooldown** fallback to `gemini-3.5-flash-lite`), managed dynamically via **Firebase Remote Config**, protected by **Firebase App Check (reCAPTCHA Enterprise)**, and persisted as sanitized, anonymized owner-only snapshots in **Cloud Firestore** with **Firebase Anonymous Auth**.
- **Zero-bloat performance:** `firebase/remote-config`, `nanoEntityDiscovery`, `pdfjs-dist`, `mammoth`, `tesseract.js`, `ImageRedactorModal`, and `historyStore` are all dynamically imported so the initial `index.js` bundle stays lean (`45.33 kB` gzip, ≤ 55 kB budget).

## Challenges we ran into
- **On-device Nano cold-start latency & honest failure UX:** A tight 5 s timeout caused cold-start Nano semantic scans to abort silently on longer documents. In v6.3 we tuned timeouts to **30 s manual / 12 s auto / 5 s follow-up**, added a live **Cancel** button, distinguished user cancel from timeout in `AbortController`, surfaced honest timeout status (`Nano timed out (Ns)`), and prevented timed-out scans from being cached as complete.
- **Cloud streaming stalls & on-device context quotas:** Live testing revealed `gemini-3.6-flash` occasionally stalling before first token while `gemini-3.5-flash-lite` responded in ~1.4 s, and Chrome's on-device `LanguageModel` rejecting combined 2-page PDF + image prompts with `QuotaExceededError`. We added an **8 s TTFT timeout + 5-minute session cooldown** (`stalledCloudModels`) for instant subsequent Lite routing, plus automatic progressive local excerpting in Strict Offline so offline runs always succeed with `0 B` sent to cloud.
- **Preventing LLM hallucinations during local entity extraction:** Small on-device models can occasionally invent entities or emit broken JSON. We added a strict verbatim substring verifier, span-overlap deduplicator against regex matches, truncated-JSON fallback recovery, and graceful degradation.
- **Canceling streams before first token (TTFT):** Standard `for await` loops do not interrupt while awaiting `generateContentStream()` or the first chunk. We added `raceWithAbort` across stream open, chunk iteration, and fallback generation so clicking **Stop** is instantaneous.
- **Avoiding false positives & prompt-injection myths:** Early regex rules tripped on software versions (`v1.2.3.4`, `1.2.3.4-rc1`) and invalid dotted-quads (`999.999.999.999`). We built a 52-sample EN+VI accuracy benchmark with 11 decoy traps and an automated prompt-injection test proving the local RAM vault is never serialized into cloud payloads.

## Accomplishments that we're proud of
- **One-command verification (`npm run verify`) — 23/23 unit tests passing** (`node:test`), including Nano anti-hallucination filtering, 30s/12s timeout & `AbortController` cancellation distinction, 8s Cloud TTFT timeout + 5-minute session cooldown bypass, `shouldApplyCloudTtftTimeout` Auto Hybrid guard, `shouldEmitStreamChunk` JSON-vs-Markdown & Chromium mock-echo stream guard, `isMockNanoEcho` / `sanitizeNanoResult` unavailable-Nano sanitizer, 2–3 char word-boundary leak detection, long-doc chunk truncation (`> 5,160` chars), Firestore payload clamping (`sanitizeAnalysisPayload`), unknown-token re-hydration auditing, prompt-injection defense, exact UTF-8 `rawPiiBytesSent` on Vietnamese diacritics, VN landline `028-3822-1234` redaction, and `eng+vie` OCR bounding-box matching.
- **Measured regex accuracy:** **100.0% Precision · 100.0% Recall · 100.0% F1** across 52 synthetic EN+VI samples with **11/11 decoy traps rejected** (`npm run eval`).
- **High-throughput local vault:** 1,000 concurrent documents shielded and re-hydrated in **240 ms** (`0.240 ms/doc`, 5,000 secrets, 0 detected leaks, 0 mismatches via `npm run stress`).
- **Lean bundle:** Initial JS dropped to **45.33 kB gzip** (`160.41 kB` raw) via lazy-loaded `firebase/remote-config`, `nanoEntityDiscovery`, `historyStore`, `pdfjs-dist`, `mammoth`, and `tesseract.js`.
- **Live Production Verification (`https://buildhybridai-tuananh.web.app`, `index-CDJQZLO1.js`):** Verified live on **Chrome Desktop with on-device Gemini Nano (`available`)** — `nda-sample.pdf` 2-page local extraction + live on-device Nano scan (**6** semantic `PERSON`/`ORG`/`ADDRESS` entities masked locally, `rx 11 · Na 6 · man 0`, `0 detected PII` in Payload); **Fast Cloud** Risk Card (`3.3s` latency, `High · Score 85/100`, `Lite fallback`, `Raw PII bytes sent: 0 B`) + RAM `Show real names` + Firestore `Save` + read-only **Anonymized Cloud Snapshot** from `History`; `id-card-sample.png` Auto-OCR (**3** solid black redaction boxes, `Escape` lock during scan); and **true browser offline** (`● Offline · On-device`) running **Strict Offline** entirely on **`Device (Nano)`** (`1.2s` TTFT, `Bytes to cloud: 0 B`, `Raw PII bytes sent: 0 B`). Also verified on non-Nano Chromium with honest `Nano unavailable` guard and zero Chromium mock echo.

## What we learned
- Hybrid AI shines brightest when **on-device and cloud models have complementary roles** (Nano handles private local semantic discovery; Cloud handles complex structured reasoning over tokens) rather than merely acting as an online/offline fallback switch.
- Honest security & latency communication — showing exact source badges (`regex` / `Nano` / `manual`), explicit timeout notices, per-run cloud byte counts, and measured Precision/Recall — earns far more trust than absolute marketing claims.

## What's next
- Optional WebGPU/ONNX NER fallback for browsers without Chrome's Prompt API so non-Chrome users also get on-device semantic PII discovery.
- Team policy packs distributed via Firebase Remote Config (custom industry regexes for HIPAA, PCI-DSS, and Vietnam PDPD Decree 13).
- Exportable signed audit certificates for enterprise compliance pipelines.

---

## Demo Video v2 Storyboard (`2:21`, 1080p 30fps — `submission-pack/privaguard-demo-v2.mp4`)

| Timestamp | Chapter | What Judges See |
|---|---|---|
| **0:00 – 0:18** | **Hybrid Privacy Vision (Intro)** | Confidential contract risk → on-device Gemini Nano local RAM shield → only safe placeholder tokens travel to Cloud Gemini (`0 detected PII leaked`). |
| **0:18 – 0:45** | **Step 1 / 4 — Local 3-Layer Shield** | Live on Firebase Hosting (`● Gemini Nano` & `● Hybrid`) → **NDA PDF** (`nda-sample.pdf`, 2 pages extracted locally, 11 regex entities) → **Diff** → **Scan semantic PII (Nano)** catches **6** real semantic entities locally (`[ORG_1]`, `[ADDRESS_1]`, `[PERSON_2]`, `[ORG_2]`, `[ADDRESS_2]`, `[PERSON_1]` → `rx 11 · Na 6 · man 0`, `Safe preview (17)`) → **Payload** (`0 detected PII included`). |
| **0:45 – 1:20** | **Step 2 / 4 — Hybrid Cloud Audit & Snapshot** | Inline mode pill (`Auto Hybrid \| Fast Cloud \| Strict Offline`) → **Fast Cloud** → **Analyze safely** → automatic Lite fallback (`Ran on: Cloud (gemini-3.5-flash-lite)`, `3.3s` latency, `2.4s` TTFT, `Masked 17 (11/6/0)`, **`Raw PII bytes sent: 0 B`**) returns typed Risk Card (`High · Score 85/100`, `GDPR · PCI-DSS · SOC2 · OWASP`) → **Show real names** restores real secrets from RAM → **Save** → **History** drawer opens read-only **Anonymized Cloud Snapshot**. |
| **1:20 – 1:37** | **Step 3 / 4 — Local Auto-OCR Image Redaction** | **ID image** (`id-card-sample.png`) → **Hide areas** → **Auto-detect PII** (`tesseract.js` locally draws **3** solid black `[HIDDEN]` boxes over National ID, Phone, and Email) → **Apply mask (3)** attaches only the redacted image. |
| **1:37 – 2:01** | **Step 4 / 4 — True Offline Mode & On-Device Nano (`0 B`)** | **DevOps log** → real browser network disconnect flips top-bar to **`● Offline · On-device`** → **Strict Offline** → **Analyze safely** runs both semantic masking (`rx 6 · Na 1`, catching `Nguyen Tuan Anh`) and the full security audit entirely on **`Device (Nano)`** (`1.2s` TTFT, **`Bytes to cloud: 0 B`**, **`Raw PII bytes sent: 0 B`**). |
| **2:01 – 2:21** | **Outro — Architecture & Verified Benchmarks** | Cloud-only vs On-device-only vs PrivaGuard Hybrid comparison, `100.0% F1`, `23/23` unit tests, `0.26 ms/doc`, `45.33 kB` gzip bundle, Firebase stack & live links. |

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
  6. `05-strict-offline-guard.png`
- **Demo Video:** Upload `submission-pack/privaguard-demo-v2.mp4` (`2:21`, 1080p 30fps, burned-in English captions) — or `privaguard-demo-v2-clean.mp4` + `privaguard-demo-v2.srt` — to YouTube (Public/Unlisted) and paste the URL into Devpost.
