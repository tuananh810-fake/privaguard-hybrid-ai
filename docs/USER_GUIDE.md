# PrivaGuard AI — User Guide (v6.3)

> **Use cloud AI on confidential documents while keeping detected secrets, PII, and your local vault strictly inside your browser RAM.**

- **Live App:** https://buildhybridai-tuananh.web.app
- **Source & Architecture:** [README.md](../README.md)

---

## 1. Getting Started

### Option A — Use the Live Web App (Recommended)
1. Open [https://buildhybridai-tuananh.web.app](https://buildhybridai-tuananh.web.app) in **Google Chrome Desktop** (recommended for Chrome Built-in AI / Gemini Nano).
2. No account or sign-up is required. History sync uses Firebase Anonymous Auth automatically in the background.

### Option B — Run Locally
```bash
npm install
npm run dev
```
Open `http://localhost:5173`. If Firebase App Check blocks requests on `localhost`, open **Settings (Tech Drawer)** in the top-right corner and paste your App Check Debug Token.

To run the full local verification suite (typecheck, 23 unit tests, regex accuracy eval, 1,000-doc stress test, and production build):
```bash
npm run verify
```

---

## 2. Enabling On-Device Gemini Nano (Chrome Built-in AI)

PrivaGuard AI works in **any modern browser** using local regex + manual masking + Firebase Cloud Gemini. To unlock **on-device semantic PII discovery** (free-form person names, private company names, street addresses) and **Strict Offline inference** (`0 B` sent to cloud):

1. Open Chrome Desktop and navigate to `chrome://flags/#prompt-api-for-gemini-nano` → set to **Enabled**.
2. Navigate to `chrome://flags/#optimization-guide-on-device-model` → set to **Enabled BypassPerfRequirement**.
3. Click **Relaunch** to restart Chrome.
4. Re-open PrivaGuard AI. Chrome will download the local Gemini Nano model once in the background. When ready, the top bar displays **`Gemini Nano ready`**.

> If Gemini Nano is not enabled yet, the **Diff** and **Payload** views still display the Nano bar with an **`Enable Gemini Nano →`** button that opens the setup instructions inside the app.

---

## 3. Core Workflow (5 Steps)

### Step 1 — Load a Confidential Document
In the left **Document Input** panel, you can:
- **Try built-in samples (1-click):** Click **`NDA PDF`** (parses a 2-page NDA locally via `pdfjs-dist`) or **`ID image`** (loads a synthetic ID card for local OCR redaction), or pick one of the text presets (`DevOps log`, `Clinical note`, `Freelance NDA`).
- **Drag & drop or upload local files:** Supports **PDF** (`.pdf`), **Word** (`.docx`), **Plain Text** (`.txt`), and **Images** (`.png`, `.jpg`, `.webp`). File parsing and OCR run **100% client-side** in your browser.
- **Type or paste text directly** in the **`Original`** tab (supports English and Vietnamese with diacritics, including 12-digit Vietnam CCCD, mobile/landline numbers like `028-3822-1234`, API keys, JWTs, PEM private keys, DB URIs, cards/IBANs, emails, and IPv4 addresses).

### Step 2 — Inspect & Mask Locally Before Sending
Review what is detected before anything leaves your browser:
- **`Safe` tab:** Preview the anonymized text with color-coded placeholder chips (`[SECRET_1]`, `[EMAIL_1]`, `[PERSON_1]`, etc.). Click any chip to peek at the original value locally.
- **`Diff` tab:** Compare the original document and masked output side-by-side, showing the detection source for every token (`regex`, `Nano`, or `manual`).
- **`Payload` tab:** Inspect the exact sanitized text payload that will be transmitted (`0 detected PII included`).
- **Pre-send Semantic Scan (Nano):** In **`Diff`** or **`Payload`**, click **`Scan semantic PII (Nano)`** to run local Gemini Nano entity discovery *before* calling the cloud (**20 s** timeout for manual scans; **12 s** for automatic pre-analysis scans; **5 s** for follow-ups).
  - Click **`Cancel`** anytime while scanning to abort immediately.
  - If Nano exceeds the timeout budget, the status bar reports an honest notice (`Nano timed out (Ns) · retry scan or mark names manually` or `kept N partial entities`) rather than silently claiming zero entities, and does not cache the incomplete scan.
  - If a document exceeds the first ~5,160 characters (3 Nano chunks), the notice explicitly reports the scanned range so you can mark later names manually.
- **Manual Mark:** In the **`Original`** tab, highlight any sensitive phrase (e.g., an internal project codename) and press **`Ctrl + Shift + M`** (macOS: **`Cmd + Shift + M`**) or click the inline mark button.

### Step 3 — Redact Images Locally with Auto-OCR (Optional)
When an image is attached:
1. Open the **Image Redactor** modal.
2. Click **`Auto-detect PII`** to run local `tesseract.js` (`eng+vie`) recognition and automatically place solid black redaction boxes over detected emails, phone numbers, IDs, and custom names.
3. Drag on the canvas to draw additional manual black boxes if needed, then click **`Apply mask`**. Only the **redacted canvas image** is ever sent to AI.

### Step 4 — Choose Hybrid Mode, Analyze Safely & Re-Hydrate Locally
1. Pick your routing mode right from the inline mode pill in the action bar: **`Auto Hybrid` | `Fast Cloud` | `Strict Offline`**.
2. Choose an analysis task (such as **`Security audit`** for structured JSON Risk Cards + remediation checklist, or **`Executive brief`**).
3. Click **`Analyze safely`** (or press **`Ctrl + Enter`** / **`Cmd + Enter`**). Click **`Stop`** anytime to cancel immediately — even during Time-To-First-Token (**TTFT**) before the first token arrives.
4. Inspect the **Hybrid Metrics Strip** beneath the output:
   - Execution engine: **`Ran on: Device (Nano)`** or **`Ran on: Cloud (<model>)`**
   - Total latency & Time-To-First-Token (**TTFT**)
   - Masked entity breakdown (`regex` / `Nano` / `manual`)
   - Bytes sent to cloud (`0 B` on Strict Offline / Nano) and **`Raw PII bytes sent: 0 B`** (measured in exact UTF-8 bytes)
5. **Re-hydrate locally:** Toggle **`Show real names`** to replace placeholders with your real values directly in browser RAM—or click individual `[TOKEN_N]` chips (including Nano `[PERSON_1]` / `[ORG_1]` chips) to peek one at a time. Any hallucinated token invented by an LLM (not present in your local vault) is preserved and flagged as an `unknown token`.
6. **Follow-up Q&A:** Ask follow-up questions in the chat box below the report. New questions are also scanned locally (regex + on-device Nano with a 5 s timeout when available) before being sent, and new tokens continue the existing vault without colliding.

### Step 5 — Save Cloud Snapshots & Export SHA-256 Proof
- **Save to History (`Save`):** Persists only the **anonymized** analysis snapshot to your owner-scoped Firestore history—never your raw text or RAM vault.
- **Read-Only Cloud Snapshots (`History` drawer):** Click **`History`** in the top header to open the slide-over saved-reports drawer. Selecting any past item opens it in read-only **`Anonymized Cloud Snapshot`** mode (re-hydration and follow-up are locked because original secrets were never stored in the database).
- **Export Markdown (`Export`):** Downloads a `.md` report with a verification footer containing the UTC timestamp, masked counts by source, and the **SHA-256 hash** of the exact sanitized payload snapshot sent during that run.

---

## 4. Hybrid Modes, Offline Usage & Settings (Tech Drawer)

Switch between the three primary modes directly via the inline **`Auto Hybrid | Fast Cloud | Strict Offline`** pill in the action bar, or click **Settings** in the top-right corner to open the **Tech Drawer**:

| Mode | Behavior |
|---|---|
| **Auto Hybrid (Recommended)** | Prefers on-device Gemini Nano first, with automatic fallback to Cloud Gemini (`gemini-3.6-flash` / `gemini-3.5-flash-lite`) on safe tokens. |
| **Fast Cloud** | Runs frontier Cloud Gemini on anonymized tokens for fastest structured JSON Risk Cards (with an **8 s** TTFT timeout + **5-minute** session cooldown fallback to `gemini-3.5-flash-lite`), with on-device fallback. |
| **Strict Offline** | Forces `ONLY_ON_DEVICE` Gemini Nano (`0 B` sent to cloud), automatically excerpting oversized inputs locally to stay within on-device context limits. |
| **Cloud Only** *(Settings drawer)* | Always uses Cloud Gemini on anonymized tokens. |

Additional controls in the Tech Drawer:
- **Simulate Offline:** Test offline resilience and PWA app-shell behavior without disconnecting your system Wi-Fi.
- **PII Category Filters:** Toggle individual categories (`API keys & JWT`, `Cards / IBAN`, `SSN / CCCD`, `Emails`, `Phones`, `IPs`, `Names`, `Orgs (Nano)`, `Addresses (Nano)`) and manage custom sensitive terms.
- **Remote Config:** View and refresh live Firebase Remote Config settings (`default_inference_mode`, `cloud_model`, `system_prompt_style`).
- **Light / Dark Theme:** Switch themes anytime from the top bar.

---

## 5. How to Verify Zero-Leak Yourself (DevTools Check)

1. Open Chrome DevTools (**`F12`**) → select the **Network** tab (filter by `Fetch/XHR`).
2. Click **`NDA PDF`** → open **`Diff`** → click **`Scan semantic PII (Nano)`** (or mark a custom term with **`Ctrl/Cmd + Shift + M`**).
3. Select **`Fast Cloud`** in the inline mode pill and click **`Analyze safely`**.
4. Inspect the outgoing Gemini request payload in the **Network** tab: confirm only bracketed placeholders (`[SECRET_1]`, `[EMAIL_1]`, `[PERSON_1]`, `[ORG_1]`, etc.) appear—and zero detected raw PII leaves your browser.
5. Check response headers on `/` to verify `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and `Cache-Control: no-cache, must-revalidate`.

---

## 6. Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl + Enter` *(macOS: `Cmd + Enter`)* | Run **`Analyze safely`** |
| `Ctrl + Shift + M` *(macOS: `Cmd + Shift + M`)* | Mask currently highlighted text in **`Original`** (`manual` source) |
| `Esc` | Close active modal, Image Redactor, History drawer, or Settings drawer |

---

## 7. Troubleshooting

- **"Gemini Nano unavailable":** Verify you are using Chrome Desktop with both flags in [Section 2](#2-enabling-on-device-gemini-nano-chrome-built-in-ai) enabled, and allow Chrome a few minutes to finish downloading the on-device model. Regex + manual masking + Cloud Gemini continue working normally in the meantime.
- **"Nano timed out (Ns)":** The first Nano invocation after browser launch can take several seconds to warm up. Click **`Scan semantic PII (Nano)`** again to retry (20 s budget), click **`Cancel`** if you want to stop early, or highlight names manually with `Ctrl/Cmd + Shift + M`.
- **"Saved history is paused" / App Check verification:** Indicates Firebase Anonymous Sign-in, App Check (reCAPTCHA Enterprise), or Firestore rules declined the save request. Core local masking, AI analysis, and viewing existing read-only reports in the top-bar **`History`** slide-over drawer continue working without interruption.
- **Long documents (> 5,160 chars):** Regex still scans the entire document, while on-device Nano scans the first 3 chunks (~5,160 chars) to stay responsive. Review the Diff view and highlight any later free-form names with `Ctrl/Cmd + Shift + M`.
- **Stale cached app version:** Because PrivaGuard is an offline-capable PWA, hard-refresh once after updates so the latest Service Worker (`privaguard-shell-v6.3.0`) activates cleanly.
