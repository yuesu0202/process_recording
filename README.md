# Process Recording → Test Script Generator

Upload a screen recording (under ~3 minutes) and get back a **test script**: an ordered
table of steps, each with an Action, Description, Expected Result, a **screenshot**, and a
timestamp. This automates what consultants do by hand today (≈45 minutes for a 2-minute
process).

- **Part 1:** upload → process → table of steps with screenshots.
- **Part 2:** users define their own columns (templates) via a config screen, without
  breaking generation.

---

## The core mechanic (read this first)

**Gemini returns steps and *timestamps*, not images.** For each step the model gives us the
fields (Action, Description, …) and a timestamp where the action's result is visible. We then
extract the screenshot ourselves: ffmpeg grabs the single video frame at that timestamp. The
screenshot is an artifact of *our* code, derived from the model's timestamp — never produced
by the model.

```
video ──► Gemini (Files API + structured output) ──► [ {fields…, timestamp}, … ]
                                                            │
                                          ffmpeg grabs the frame at each timestamp
                                                            ▼
                                          step.screenshotUrl = /screenshots/<job>/step-N.png
```

---

## Running it

Requirements: Node 18+ (developed on Node 22). ffmpeg is **not** a system dependency — it
ships via `ffmpeg-static`.

```bash
npm install

# Set your Gemini API key:
echo "GEMINI_API_KEY=your-key" > .env.local      # see .env.example

npm run dev        # http://localhost:3000
```

- **Use it:** pick a clip from `examples/`, click *Generate test script*, watch it move
- **Configure columns (Part 2):** click *Configure columns*, edit the template, save, then
  upload — the new columns drive generation.

```bash
npm test           # 51 unit/integration tests (includes real ffmpeg extraction)
npm run build      # production build
```

The model is configurable via `GEMINI_MODEL` (default `gemini-2.5-flash`).

---

## Architecture

One Next.js (App Router) app for both UI and API. The design rule: **boundaries at the edges,
pure logic in the middle, and everything driven by the column config.**

```
app/
  page.tsx                     Upload UI entry
  config/page.tsx              Part 2 column-config screen
  components/
    UploadAndResults.tsx       Client state machine: upload → poll → render
    StepsTable.tsx             Column-driven results table
    ColumnsEditor.tsx          Add/remove/rename columns (Part 2)
  api/jobs/route.ts            POST: accept upload, create job, start processing → {jobId}
  api/jobs/[id]/route.ts       GET: job status + steps when done
lib/
  schema.ts                    Types + zod validation + build response schema from columns
  prompt.ts                    Build the Gemini prompt from columns
  steps.ts                     Pure: parse/validate/normalize model output, timestamp math
  gemini.ts                    ONLY Gemini boundary: upload, poll ACTIVE, generateContent
  frames.ts                    ONLY ffmpeg boundary: extract a PNG at a timestamp
  jobs.ts                      In-memory job store (create/get/update)
  processor.ts                 The pipeline: orchestrates the boundaries + drives job state
  columnsStore.ts              Client persistence for the column template (localStorage)
```

**Column-driven everything (why Part 2 doesn't break Part 1).** A single `ColumnConfig[]`
drives four things: the Gemini **response schema** (`buildResponseSchema`), the **prompt**
(`buildPrompt`), the **table headers** (`StepsTable`), and the **validation** (`parseSteps`).
Adding a column is a *data* change, never a code change. The columns travel with the upload
and are stored on the job, so a finished table always matches the template that generated it.

**Treat the model as untrusted.** Gemini is asked for structured JSON via a `responseSchema`,
and the result is still validated with zod in `steps.ts` before use: missing fields default to
`""`, unknown fields are dropped, rows without a usable timestamp are skipped, and a
non-array or empty result fails the job loudly. On a validation failure the pipeline retries
once, feeding the error back to the model.

**End-to-end flow.** `POST /api/jobs` saves the upload, creates a `processing` job, starts
`processVideo` **without awaiting**, and returns `{jobId}`. The background pipeline runs
`upload → ACTIVE poll → generateSteps → parseSteps → extract frames → done`, updating the job
stage as it goes. The client polls `GET /api/jobs/:id` every 2s and renders progress, then the
table. Any failure sets the job to `error` with a message surfaced in the UI.

---

## Assumptions

- Videos are screen recordings under ~3 minutes and a few hundred MB (upload capped at 200 MB).
- Input seeking to the nearest keyframe is acceptable: screen recordings are visually static
  enough that ±a few frames shows the same screen. This is the right trade for responsiveness.
- A single Node process serves the app and runs processing (prototype scope — see tradeoffs).
- "Correct" step granularity is subjective; the prompt aims for one discrete user action per
  step and tells the model not to invent or over-split steps.

---

## Tradeoffs (deliberate, prototype-scoped)

- **In-memory job store, not a DB/queue.** `lib/jobs.ts` is a `Map`. Simple and fast, but it
  does **not** survive a server restart and is **not** shared across multiple workers or
  serverless instances. Production → Redis/DB for state + a real queue with a worker process.
- **Processing runs in-process, fire-and-forget**, not on a background queue. Fine for one
  node and short videos; under load or on serverless (where the function may be frozen after
  the response) this needs a proper queue/worker.
- **Server-side ffmpeg, not browser canvas capture.** Browser capture would offload work to
  the client, but server-side ffmpeg is deterministic, keyframe-accurate, and independent of
  the client's browser/codecs — the right call for a document-generation product. Cost: server
  CPU and a binary dependency (mitigated by `ffmpeg-static`).
- **Screenshots written to `public/`** and served statically. Easy for the prototype; in
  production these belong in object storage (S3/GCS) with signed URLs and lifecycle cleanup.
- **Template persistence is localStorage.** Keeps Part 2 backend-free. Production → a
  per-client template store on the server.

---

## What I'd build next for production

- **Durable jobs:** Postgres/Redis for job state + a queue (e.g. BullMQ / Cloud Tasks) and a
  dedicated worker, so processing survives restarts and scales horizontally.
- **Object storage** for uploads and screenshots, with signed URLs and TTL cleanup.
- **Auth + multi-tenancy** and server-side per-client templates (replacing localStorage).
- **Observability & cost controls:** structured logs, traces, Gemini token/cost metrics,
  per-tenant rate limits, and retries with backoff on transient API errors.
- **Frame-selection quality:** sample a few frames around the timestamp and pick the sharpest
  / least-transitional one; optional cropping to the active window.
- **Export** to Word/PDF/CSV — the format consultants actually hand off.

---

## How I'd evaluate quality

The output is **generative**, so quality is *measured*, not unit-tested. "It worked on one
video" is a smoke test, not evidence.

**Dimensions of "good":**

- **Step completeness & ordering** — every real action captured, in order, none invented or missed.
- **Timestamp accuracy** — the timestamp lands on a frame that actually shows the action's
  result (this directly drives screenshot quality).
- **Screenshot usefulness** — the right moment, not a mid-scroll/transition blur.
- **Field quality** — Action / Description / Expected Result accurate and at a usable level of
  abstraction.
- **Robustness (Part 2)** — custom columns degrade gracefully; generation never breaks.

**How to measure:**

- **A small golden set** — 3–5 recordings with hand-labeled ground-truth steps + timestamps.
  This is the benchmark.
- **Step precision/recall** vs the golden set (precision catches hallucinated steps, recall
  catches missing ones), plus an ordering check.
- **Timestamp error within a tolerance window** (e.g. % within ±1s of a frame showing the
  action) — not exact-second matching.
- **Field quality via rubric or LLM-as-judge** (a second model scores step text vs on-screen
  content), spot-checked by a human.
- **Human eyeball pass** end-to-end on a few videos — the most honest early signal.
- **Regression discipline** — re-run the golden set on every prompt change, against *real*
  model output (not a mock).
- **The production metric that matters most: edit rate** — how much users change generated
  steps before exporting (low = good), alongside time saved (45 min → minutes).

**Honest limits:** there is no single "correct" step granularity; the eval set is tiny at
first; timestamp eval needs a tolerance window, not exact match.

---

## Testing

`npm test` runs 51 tests. The pure logic is covered directly — timestamp parse/format,
model-output validation/defaulting, schema + prompt building from columns, job state
transitions, and the pipeline state machine (happy path, retry-on-invalid, error path) with
injected fakes (no network/ffmpeg). `lib/frames.test.ts` runs **real ffmpeg** against a sample
video and auto-skips if the sample is absent. Non-deterministic Gemini calls are verified
manually (and were, end-to-end) but kept out of the committed suite — they cost money and
aren't reproducible.

## Notes

- No secrets in code; `GEMINI_API_KEY` lives in `.env.local` (gitignored).
- `npm audit` reports advisories in `fluent-ffmpeg`/`ffmpeg-static` transitive deps; acceptable
  for a prototype, noted here for honesty.
