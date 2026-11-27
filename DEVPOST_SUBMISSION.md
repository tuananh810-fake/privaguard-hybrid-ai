# Devpost Submission — PrivaGuard AI (#BuildHybridAI 2026)

## Tagline
Analyze confidential logs, contracts, medical notes, and images with Hybrid AI — while keeping 100% of your secrets and PII strictly on your device.

## Inspiration
Every day, engineers paste incident logs containing live API keys into AI tools, clinicians summarize patient notes with SSNs/MRNs, and founders review NDAs with bank details. Sending raw sensitive data to cloud LLMs creates immediate GDPR, HIPAA, and SOC2 compliance exposure — yet purely local models lack deep structured reasoning for complex audits.

We built **PrivaGuard AI** to prove that **Hybrid AI** solves this tradeoff cleanly: run deterministic + on-device privacy shielding strictly in browser RAM, send only anonymized tokens to **Firebase AI Logic** (Gemini Nano on-device or Gemini Cloud fallback), and re-hydrate real values locally on screen.

## What It Does
1. **Zero-Leak On-Device Privacy Shield (`<1ms`)**: Automatically detects and masks PEM private keys, JWTs, database URIs, API tokens, credit cards/IBANs, SSNs, 12-digit national IDs, international/local phone numbers, valid IPv4 addresses (safely ignoring software versions like `v1.2.3.4` and `1.2.3.4-rc1`), and case-insensitive custom terms.
2. **Visual Privacy Proof (Side-by-Side Diff & Payload Inspector)**: Users and auditors can switch to the **Diff** tab to see raw PII highlighted in red on the left vs. the exact anonymized `[TOKEN_N]` payload (`0B leaked`) on the right.
3. **Structured Security Audit via Firebase AI Logic (`responseSchema`)**: Uses `Schema.object(...)` on Gemini Cloud (`gemini-2.5-flash`) to output a structured risk dashboard (`riskLevel`, `riskScore 0–100`, `complianceFrameworks`, `findings`, and an interactive remediation checklist), automatically falling back to clean Markdown on Gemini Nano on-device and `gemini-2.5-flash-lite` on rate-limit spikes (`HTTP 429`).
4. **Local Multimodal Image Redactor**: Users attach screenshots or receipts and drag black `[HIDDEN]` bars directly on an HTML5 Canvas — pixels are flattened and WebP-compressed locally before multimodal inference.
5. **Collision-Free Private Follow-up Q&A**: Ask follow-up questions that automatically inherit the existing RAM vault so newly typed PII receives sequential tokens (`[EMAIL_2]`) without colliding with document tokens (`[EMAIL_1]`).
6. **Notion-Inspired Calm Workspace**: Light Mode default + Dark Mode toggle, flat 48px header, 1px split-view workspace, click-to-peek tokens (`translate="no"`), copyable code blocks, keyboard shortcuts (`Ctrl/Cmd+Enter`, `Esc`), and lazy-loaded owner-scoped **Cloud Firestore** history secured by **Anonymous Auth** + **App Check (reCAPTCHA Enterprise)**.

## How We Built It
- **Frontend**: React 19, TypeScript 7, Tailwind CSS v4, Vite 8 (Rolldown code-splitting, lazy-loaded Firestore/Auth/ImageRedactor for a **-51% smaller initial JS bundle** and **`5.95 kB` gzip CSS**).
- **Hybrid AI**: `firebase/ai` (`GoogleAIBackend`, `InferenceMode.PREFER_ON_DEVICE`, `ONLY_ON_DEVICE`, `PREFER_IN_CLOUD`, `ONLY_IN_CLOUD`, `Schema.object`, streaming with TTFT telemetry & `AbortController` cancellation).
- **Firebase Security & Ops**: Firebase App Check (reCAPTCHA Enterprise enforced), Firebase Remote Config (dynamic model & system prompt style), Firebase Anonymous Auth + strict owner-only `firestore.rules`, Firebase Hosting.
- **Verification**: 7/7 automated unit tests (`node:test`) + 1,000-user concurrency stress test (**247ms total, 5,000 secrets shielded, 0 leaks, 0 mismatches**).

---

## 2-Minute Demo Video Script (4 "Aha!" Moments)

| Time | Scene / Action | Voiceover Talking Points |
| :--- | :--- | :--- |
| **0:00 – 0:30** | **Moment 1: Side-by-Side Diff & Zero-Leak Proof**<br/>Open `https://buildhybridai-tuananh.web.app` (clean Notion Light Mode). Click **DevOps log** → click **Diff** tab. | *"Pasting production incident logs into AI normally leaks live API keys, IPs, and phone numbers. With PrivaGuard AI, watch the Side-by-Side Diff: on the left is your raw document in local RAM; on the right is the exact payload sent to AI — 7 secrets masked in under 1 millisecond, 0 bytes of PII leaked."* |
| **0:30 – 1:05** | **Moment 2: Structured Audit, Click-to-Peek & Follow-up Q&A**<br/>Press `Ctrl+Enter` to run **Security audit** → show Risk Score gauge, SOC2/GDPR badges, tick a remediation checkbox → click a `[SECRET_1]` chip to peek locally → click **Show real names** → ask a follow-up with a new email (`Notify ciso@corp.io`). | *"Using Firebase AI Logic's structured JSON schema on Gemini 2.5 Flash — protected by App Check — we get a live risk score, compliance frameworks, and an interactive remediation checklist. Click any token to peek its real value locally, or toggle 'Show real names' to re-hydrate in browser RAM. Even follow-up questions inherit the vault cleanly without token collisions."* |
| **1:05 – 1:35** | **Moment 3: Local WebP Image Redactor**<br/>Click **Attach → Image**, upload a screenshot/document, drag two black bars over sensitive regions, click **Apply mask (2)**. | *"Privacy extends to multimodal AI too. Before any screenshot leaves your browser, our local Canvas redactor permanently flattens masked regions and compresses to WebP on-device."* |
| **1:35 – 2:00** | **Moment 4: Offline On-Device Simulation & Firebase Stack**<br/>Click the topbar status dot (**Offline · On-device**) → open **Settings** slide-over showing `Gemini Nano`, `App Check: Enforced`, `Remote Config`, and `Protected on this device` → toggle Dark Mode → click **Save** to sync an anonymized snapshot to Firestore. | *"Need strict offline privacy? One click simulates Offline Mode to force on-device Gemini Nano via Firebase AI Logic. Under Settings, judges can inspect live App Check enforcement, Remote Config, and our local RAM vault — and saved Firestore reports never store a single byte of raw PII."* |
