# Devpost Submission Copy — PrivaGuard AI (#BuildHybridAI 2026)

## Tagline
Scrub sensitive PII & secrets locally with Gemini Nano on-device, then run deep reasoning safely in the cloud via Firebase AI Logic & App Check.

## Inspiration
Developers, clinicians, freelancers, and students hesitate to paste real incident logs, patient notes, or legal contracts into cloud AI tools because they contain API keys, SSNs, IBANs, and personal identities. Hybrid AI is uniquely positioned to solve this: keep raw PII strictly on-device, while still unlocking cloud-scale Gemini reasoning on the sanitized payload.

## What it does
**PrivaGuard AI** is a privacy-first hybrid AI workspace with a 2-stage pipeline:
1. **Stage 1 — On-Device Privacy Shield:** Combines deterministic secret/PII detection with Chrome's built-in **Gemini Nano** (`InferenceMode.ONLY_ON_DEVICE`) to replace sensitive values with reversible placeholders (`[SECRET_1]`, `[EMAIL_1]`, `[CARD_1]`, `[PERSON_1]`). Original values stay in browser RAM and never leave the device.
2. **Stage 2 — Hybrid Reasoning & Seamless Fallback:** Sends only the anonymized payload via **Firebase AI Logic** (`InferenceMode.PREFER_ON_DEVICE`), running offline on Gemini Nano when available or seamlessly falling back to **Gemini 2.5 Flash** in the cloud.
3. **Local Re-hydration & Live Telemetry:** Displays real-time `response.inferenceSource` (`ON_DEVICE` vs `IN_CLOUD`), latency (ms), bytes shielded locally, one-click local re-hydration, and anonymized history synced to **Cloud Firestore**.

## How we built it
- **Firebase AI Logic (`firebase/ai`)** with `GoogleAIBackend` and selectable `InferenceMode` (`PREFER_ON_DEVICE`, `ONLY_ON_DEVICE`, `PREFER_IN_CLOUD`, `ONLY_IN_CLOUD`).
- **Firebase App Check** enforced with **Fraud Defense (reCAPTCHA Enterprise)**.
- **Cloud Firestore** for real-time anonymized analysis history.
- **Firebase Remote Config** for dynamic hybrid mode and cloud model configuration.
- **React + TypeScript + Vite + Tailwind CSS**, deployed on **Firebase Hosting**.

## 2.5-Minute Demo Video Script
1. **0:00–0:25:** Introduce the problem — pasting API keys / medical SSNs / bank IBANs into cloud AI is unsafe. Show PrivaGuard AI live on `buildhybridai-tuananh.web.app`.
2. **0:25–1:05:** Click **DevOps Incident Log** sample → highlight the middle column showing API keys, tokens, IPs, and emails scrubbed locally in RAM (`0 bytes leaked`). Click **Shield Locally & Run Hybrid AI** → show live `ON_DEVICE` / `IN_CLOUD` badge + latency.
3. **1:05–1:40:** Click **Re-hydrate Locally** to restore real names/IPs inside the browser only. Click **Save to Firestore** to show only the anonymized report stored in Cloud Firestore.
4. **1:40–2:15:** Open DevTools → Network → toggle **Offline** → switch to **Clinical Patient Note** → show the app stays alive and runs **On-Device** with zero internet connection, then reconnect to show seamless cloud fallback.
5. **2:15–2:30:** Show Firebase Console (App Check Enforced + AI Logic Monitoring + Firestore) and wrap up!
