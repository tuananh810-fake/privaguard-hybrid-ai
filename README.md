# PrivaGuard AI — Privacy-First Hybrid AI Workspace (`#BuildHybridAI 2026`)

> **Scrub sensitive PII & secrets 100% locally with Gemini Nano on-device, then run deep reasoning safely in the cloud via Firebase AI Logic & App Check.**

## Why Hybrid AI?
Users want AI to analyze **confidential contracts, clinical notes, and production incident logs** — but cannot paste raw API keys, SSNs, IBANs, or patient names into cloud LLMs.

**PrivaGuard AI** solves this with a two-stage hybrid pipeline:
1. **Stage 1 — Local Privacy Shield (`ONLY_ON_DEVICE`):** Runs strictly inside the browser (deterministic PII/secret detector + Chrome's built-in **Gemini Nano** via `InferenceMode.ONLY_ON_DEVICE`) to replace sensitive values with reversible placeholders (`[SECRET_1]`, `[EMAIL_1]`, `[CARD_1]`, `[PERSON_1]`). Raw secrets stay in browser RAM and **never touch the network**.
2. **Stage 2 — Hybrid Reasoning (`PREFER_ON_DEVICE` → Cloud Fallback):** Sends **only the anonymized payload** through **Firebase AI Logic** (`firebase/ai`). Runs locally on **Gemini Nano** when available (including **100% offline**!), or seamlessly falls back to **Gemini 2.5 Flash** in the cloud for deep audits.
3. **Local Re-hydration:** One-click restores original entities back into the rendered report locally in the browser.

## Firebase Ecosystem Integrations
- **Firebase AI Logic (`firebase/ai`)**: `GoogleAIBackend` + `InferenceMode.PREFER_ON_DEVICE` / `ONLY_ON_DEVICE` / `PREFER_IN_CLOUD` / `ONLY_IN_CLOUD` + real-time `response.inferenceSource` telemetry.
- **Firebase App Check**: Enforced with `ReCaptchaEnterpriseProvider` (Fraud Defense) + automatic localhost debug token support.
- **Cloud Firestore**: Real-time persistence of **anonymized-only** analysis reports (`privaguard_analyses`).
- **Firebase Remote Config**: Dynamic remote control of `default_inference_mode` and `cloud_model`.
- **Firebase Hosting**: Live demo hosted at `https://buildhybridai-tuananh.web.app`.

## Quick Start
```bash
npm install
npm run dev
```

## Build & Deploy to Firebase Hosting
```bash
npm run build
npx firebase-tools login
npx firebase-tools deploy --only hosting
```
