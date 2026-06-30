# CLAUDE.md — Process Recording → Test Script Generator

Instructions for the coding agent building this project. Read this fully before writing code, and follow the **Build Order** — always keep the app in a runnable, demoable state.

---

## 1. What we're building

A web app where a user uploads a **screen-recording video** (< 3 min) and gets back a **test script**: an ordered table of steps, each with an Action, Description, Expected Result, a **screenshot**, and a timestamp. Today consultants write these by hand (45 min for a 2-min process); we automate it.

**The core mechanic — internalize this:** Gemini watches the video and returns the **steps and the timestamp** of each step. Gemini does **not** return images. We extract the screenshot ourselves by grabbing the video frame at each timestamp with ffmpeg. The screenshot is derived by *our* code, not produced by the model.

Two parts:
- **Part 1 (must be solid):** upload → process → table of steps with screenshots.
- **Part 2 (built-in, kept simple):** users define their own columns via a config UI; this must not break generation.

This is graded on **code quality and product sense**, not flashy UI. Build it like a product you have to maintain. Completion matters less than clean architecture and defensible decisions.

---

## 2. Golden rules (non-negotiable principles)

1. **Treat the model's output as an untrusted claim.** Always request **structured JSON** via a response schema, **validate** it before use, and never let malformed output crash the app or flow downstream unchecked.
2. **System-controlled fields are never AI-owned.** `timestamp` is read from Gemini but `screenshot` is derived by ffmpeg; these are reserved system columns, separate from user/AI-generated text columns.
3. **Fail loud, not silent.** On Gemini/ffmpeg errors, set the job to an error state with a clear message and surface it in the UI. Never write partial/garbage data as if it succeeded.
4. **One boundary per external dependency.** All Gemini calls live in `lib/gemini.ts`; all ffmpeg calls live in `lib/frames.ts`. Nothing else imports the SDK or spawns ffmpeg. This keeps them mockable and swappable.
5. **Pure logic in the middle, side effects at the edges.** Parsing, schema-building, validation, timestamp math are pure functions. File I/O, network, and ffmpeg are isolated and easy to find.
6. **Build column-driven from day one.** The default columns are just the seed config. Never hard-code "Action/Description/ExpectedResult" into the prompt, the schema, or the table — derive all three from the column config so Part 2 is nearly free.
7. **Keep it runnable at every step.** Follow the Build Order; commit at each milestone with a clear message. Prefer a working narrow slice over a broken broad one.
8. **Production-grade, SOLID code — reviewers will read every file.** Build as if you must maintain this product for years. Apply SOLID concretely:
   - *Single Responsibility:* each module does one job (`gemini.ts` only talks to Gemini, `frames.ts` only does ffmpeg, `steps.ts` only parses/validates). No god-files, no logic in route handlers beyond orchestration.
   - *Open/Closed:* new client templates are added by **editing the column config, not the code** — the schema, prompt, and table extend through data, not by modifying functions.
   - *Liskov / interface clarity:* the Gemini and ffmpeg boundaries are typed interfaces you could swap for a fake or another provider without touching callers.
   - *Interface Segregation:* small, focused function signatures and types; callers depend only on what they use.
   - *Dependency Inversion:* high-level flow (the job pipeline) depends on the **abstractions** (`extractSteps`, `extractFrame`), not on the SDK/ffmpeg directly — that's what makes it testable and mockable.
   Plus: clean naming, no dead code, no copy-paste, no clever hacks. Clarity over cleverness.
9. **Product sense over pixels.** Judged on usability and professionalism, not flashy design. Make it *sensible*: clear states (idle → uploading → analyzing → extracting → done → error), helpful empty/error messages, a layout a real consultant could use without a manual. Polished and professional, not fancy. Think "would I trust this product?"
10. **Explain before you proceed — gated by my understanding.** This is a hard rule. After you implement each file/module, **stop** and explain, in plain language: what it does, how it works, and why it's built that way. Do **not** move on to the next piece of code until I confirm I understand the current one. I have to be able to defend every file in the debrief, so teaching me as you go is part of the job, not an afterthought.
11. **Test each part the moment you build it — never batch testing to the end.** When you finish a module, immediately write focused tests for it before moving on. A part is not "done" until its tests exist and the suite is green. Prioritize the pure logic and the guarantees: timestamp parsing, model-output validation/defaulting, building the response schema + prompt from a column config, and job state transitions. This pairs with Rule 10 — the per-module loop is: **implement → test (green) → explain → I confirm → next.**

---

## 3. Tech stack

- **Next.js (App Router) + TypeScript.** One app for UI + API route handlers.
- **Gemini** via `@google/generative-ai` (Files API + `generateContent` with structured output).
- **ffmpeg** via `fluent-ffmpeg` + `ffmpeg-static` (no system install dependency).
- **Validation:** `zod` for schemas/validation of model output and column config.
- **Styling:** minimal — Tailwind or plain CSS. Clean, readable, professional. No component-library sprawl.
- **No database** for the prototype: in-memory job store + temp files (see §7). Note the production path in the README.

Keep dependencies lean. Justify any addition.

---

## 4. Architecture & file layout

```
app/
  page.tsx                  Upload UI + job polling + results table
  api/jobs/route.ts         POST: accept upload, create job, start processing → {jobId}
  api/jobs/[id]/route.ts    GET: return job status, and steps+screenshots when done
  config/                   (Part 2) column-config UI
lib/
  gemini.ts                 ONLY Gemini boundary: upload file, poll ACTIVE, generateContent
  frames.ts                 ONLY ffmpeg boundary: extract PNG at a timestamp
  jobs.ts                   in-memory job store (create/get/update) + types
  schema.ts                 zod models: Step, ColumnConfig, Job; build response schema from columns
  steps.ts                  pure: parse Gemini JSON → Step[], timestamp parsing, validation
  prompt.ts                 pure: build the Gemini prompt from the column config
public/
  screenshots/<jobId>/      extracted PNGs, served statically
```

**End-to-end flow:**
1. `POST /api/jobs` saves the upload to a temp path, creates `job{status:"processing"}`, returns `{jobId}`, and kicks off processing **without blocking the response**.
2. Background work: `gemini.uploadAndWaitActive(file)` → `gemini.extractSteps(file, columns)` → for each step `frames.extractFrame(videoPath, seconds)` → `jobs.update(id, {status:"done", steps})`. Any throw → `jobs.update(id,{status:"error", error})`.
3. `GET /api/jobs/[id]` returns the job; the client polls every ~2s and renders progress, then the table.

---

## 5. Data model (zod)

```ts
// A single column the user can configure (text, AI-generated)
ColumnConfig = { key: string; label: string; description: string }

// Reserved system columns (NOT user-editable, NOT AI-generated as text):
//   timestamp  -> from Gemini
//   screenshot -> derived by ffmpeg

// One extracted step
Step = {
  index: number
  timestampSeconds: number          // parsed from Gemini's timestamp
  fields: Record<string, string>    // keyed by ColumnConfig.key (action, description, ...)
  screenshotUrl: string | null      // /screenshots/<jobId>/step-N.png
}

Job = {
  id: string
  status: "processing" | "done" | "error"
  step?: "uploading" | "analyzing" | "extracting"   // for progress UX
  columns: ColumnConfig[]
  steps?: Step[]
  error?: string
}
```

Default columns seed: `action` ("Action"), `description` ("Description"), `expectedResult` ("Expected Result").

---

## 6. Gemini integration (`lib/gemini.ts`)

- **Auth:** read `process.env.GEMINI_API_KEY`. Never hard-code the key.
- **Upload:** use the Files API to upload the video; **poll the file's state until `ACTIVE`** before calling the model (handle `FAILED`). This polling is required — do not skip it.
- **Structured output:** call `generateContent` with `responseMimeType: "application/json"` and a **`responseSchema` built dynamically from the column config** (an array of step objects whose properties are the configured column keys + a `timestamp` string). Set a low temperature for determinism.
- **Prompt (`lib/prompt.ts`):** instruct Gemini that it's segmenting a screen recording into discrete user actions; for each step produce the configured fields plus a `timestamp` (when the action is clearly visible). Tell it to pick a timestamp where the screen best shows the result of the action. Ask for steps in chronological order.
- **Validate** the returned JSON with zod (`lib/steps.ts`). On validation failure, retry once feeding the error back; if it still fails, throw a clear error (→ job error state). Missing optional fields → fill with empty string; never crash.

---

## 7. ffmpeg frame extraction (`lib/frames.ts`)

- Parse Gemini's timestamp (`MM:SS` or seconds) → integer/float seconds (`lib/steps.ts`).
- Extract one frame: input-seek for speed, e.g. `ffmpeg -ss <seconds> -i <video> -frames:v 1 -q:v 2 <out.png>`, via `fluent-ffmpeg` with `ffmpeg-static`'s binary path.
- Write to `public/screenshots/<jobId>/step-<index>.png`; return the public URL `/screenshots/<jobId>/step-<index>.png`.
- Clamp timestamps to `[0, duration]`. If extraction fails for one step, set that step's `screenshotUrl = null` and continue — one bad frame must not fail the whole job.
- Clean up the temp video after processing.

---

## 8. Async jobs (`lib/jobs.ts`)

- In-memory `Map<string, Job>` with `create`, `get`, `update`. Generate `jobId` with `crypto.randomUUID()`.
- Processing runs in the same Node process, started from the POST handler and **not awaited**, updating `job.step` as it moves (`uploading`→`analyzing`→`extracting`→done).
- **Known limitation (state in README + debrief):** in-memory store doesn't survive server restarts and won't share across multiple workers/serverless instances. Production → Redis or a DB + a real queue (e.g. a worker). Acceptable for this prototype; say so explicitly.

---

## 9. Part 2 — flexible columns (keep simple, but real)

- A config screen lists the current columns; user can **add / remove / rename** a column and edit its description. Persist config (localStorage is fine for the prototype; note a per-client server-side template store as the production path).
- The **same config object** drives: (a) the Gemini `responseSchema`, (b) the prompt, (c) the table headers. Because Part 1 already reads from it, Part 2 is mostly UI.
- **Must not break generation:** validate the config (non-empty unique keys), and validate model output against the *current* schema — extra fields ignored, missing fields defaulted to empty. Adding a weird column should degrade gracefully, never crash.
- `timestamp` and `screenshot` are always-present system columns and cannot be deleted or duplicated by the user.

---

## 10. Build order (follow this; keep it running)

1. **UI shell** — Next.js + a hardcoded `Step[]` rendered as a table with placeholder images. Column-driven from the start.
2. **ffmpeg** — extract real frames from a local sample video at fixed timestamps; show real screenshots. (De-risk the infra early.)
3. **Gemini** — Files API upload + ACTIVE poll + structured steps; wire real steps in (synchronous internally is fine here). Now Part 1 works end to end.
4. **Async** — wrap in job store + `POST`/`GET` + client polling + progress states + error UI.
5. **Part 2** — lift columns into config; build schema + prompt from it; add the config UI.
6. **Polish** — loading/empty/error states, the README, and debrief notes.

Commit after each milestone. If time is short, ship through step 3+4 cleanly rather than a half-built step 5.

**Per-module loop at every milestone (Rules 10 + 11): implement → write tests and get them green → explain the code in plain language → wait until I confirm I understand → only then continue.**

---

## 11. Conventions & quality bar

- **The reviewers will read every file** — write it to be maintained, not just to run. SOLID (see Golden Rule 8), single-responsibility modules, dependency-inverted boundaries.
- TypeScript strict; meaningful names; small single-purpose functions; no dead code.
- Every external call wrapped in try/catch with a useful error surfaced to the job.
- No secrets in code or git. `.env.local` for `GEMINI_API_KEY`; ensure `.gitignore` covers `.env*`, `public/screenshots/`, temp uploads, `node_modules`.
- **Test each part as it's built (Golden Rule 11), not at the end.** A few **focused tests** on the pure logic that matters: timestamp parsing, model-output validation/defaulting, and building the response schema + prompt from a column config. Test the guarantees, not trivia. Keep the suite green before moving to the next module.
- Don't over-engineer: no auth, no multi-tenancy, no DB, no fancy design system. These are out of scope — list them as "next steps."

---

## 12. README (write it — it's graded)

Include: what it does + how to run (env var, `npm install`, `npm run dev`); the architecture and the **screenshot-from-timestamp** mechanic; **assumptions**; **tradeoffs** (in-memory jobs, ffmpeg vs browser capture, sync-internally vs full queue); **what I'd build next** for production (queue + Redis/DB, auth, per-client templates, observability, cost controls, retries, frame-selection quality); and the **evaluation section** below.

### How I'd evaluate quality (include this — it's a key debrief topic)

The output is generative, so quality is measured, not unit-tested. State it across dimensions and methods, and be honest about limits.

**Dimensions of "good":**
- **Step completeness & ordering** — every real action captured, in order, none invented or missed.
- **Timestamp accuracy** — the timestamp lands on a frame that actually shows the action/result (this drives screenshot quality).
- **Screenshot usefulness** — the right moment, not a mid-scroll/transition blur.
- **Field quality** — Action / Description / Expected Result accurate and at a usable level of abstraction.
- **Robustness (Part 2)** — custom columns degrade gracefully; generation never breaks.

**How to measure:**
- **A small golden set** — 3–5 recordings with hand-labeled ground-truth steps + correct timestamps. This is the benchmark; "it worked on one video" is not evidence.
- **Step precision/recall** vs the golden set (precision catches hallucinated steps, recall catches missing ones) + an ordering check.
- **Timestamp error with a tolerance window** (e.g. % within ±1s of a frame showing the action) — not exact-second matching.
- **Field quality via rubric or LLM-as-judge** (a second model rates step-text vs on-screen content), spot-checked by a human.
- **Human eyeball pass** end-to-end on a few videos — the most honest early signal.
- **Regression discipline** — re-run the golden set on every prompt change; ensure the eval exercises *real* model output, not a mock.
- **Production metric that matters most:** **edit rate** — how much users change generated steps before exporting (low = good), plus time saved (45 min → minutes).

**Honest limits to name:** there's no single "correct" granularity of steps; the eval set is tiny at first; timestamp eval needs tolerance, not exact match.

## 13. Debrief talking points (keep a short notes file)

- Why Gemini returns timestamps and *we* extract frames (the central design).
- Why the column config drives schema + prompt + UI (how Part 2 doesn't break Part 1).
- Why structured output + validation (untrusted-model principle).
- The async/job tradeoff and the honest in-memory limitation.
- ffmpeg vs browser-canvas tradeoff, and why server-side here.