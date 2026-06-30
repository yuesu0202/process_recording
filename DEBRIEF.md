# Debrief notes

Short talking points to defend the design.

## 1. Why Gemini returns timestamps and *we* extract frames
The model is good at *understanding* the video and saying "the result of this action is visible
at 00:21"; it is not an image source. So we ask only for steps + a timestamp, then use ffmpeg
to grab the exact frame. This keeps screenshots deterministic, high-resolution, and under our
control, and it makes the model's job narrower (and therefore more reliable). `timestamp` is
read from the model; `screenshot` is a *system-owned* field we derive — they are never
AI-owned text columns.

## 2. Why the column config drives schema + prompt + UI (Part 2 without breaking Part 1)
One `ColumnConfig[]` is the single source of truth. It builds the Gemini `responseSchema`
(`buildResponseSchema`), the prompt (`buildPrompt`), the table headers (`StepsTable`), and the
validation (`parseSteps`). Adding a column is a data change, not a code change (Open/Closed).
Part 2 was therefore almost entirely UI — proven live: a custom `uiElement` column drove
generation with zero pipeline edits. Three independent guards stop a bad template from breaking
generation: validate-on-save, re-validate-on-load (stale localStorage → defaults), and
re-validate in the API on every upload.

## 3. Why structured output + validation (untrusted-model principle)
We request JSON via a `responseSchema`, but still validate with zod before use. The model's
output is a *claim*: it may omit a field (→ default `""`), add an extra one (→ dropped), or
return a bad timestamp (→ that row skipped). A non-array/empty result fails the job loudly. On
a validation failure we retry once, feeding the error back so the model can self-correct.

## 4. The async/job tradeoff and the honest in-memory limitation
`POST` returns `{jobId}` immediately and processing runs fire-and-forget in the same process;
the client polls. The job store is an in-memory `Map` — simple, but it does not survive
restarts and is not shared across workers/serverless instances. Production needs a DB/Redis +
a real queue and worker. Stated plainly, not hidden.

## 5. ffmpeg vs browser-canvas, and why server-side
Server-side ffmpeg is deterministic and keyframe-accurate, independent of the client's browser
and codecs — right for a document-generation product. We use input seeking (`-ss` before
`-i`) so extraction is fast even on a 3-minute video (~0.5s/frame), and clamp the timestamp to
`[0, duration)` so a slightly-off model timestamp still yields a valid frame. `ffmpeg-static`
removes the system-install dependency.

## 6. How quality is evaluated (because output is generative)
Golden set of 3–5 labeled videos; step precision/recall + ordering; timestamp error within a
±1s tolerance window; field quality via rubric/LLM-judge with human spot-checks; and the
production north star — **edit rate** (how much users change steps before exporting). See the
README for the full section. Honest limit: there's no single "correct" step granularity.

## 7. Code-quality stance (SOLID, concretely)
- **Single Responsibility:** `gemini.ts` only talks to Gemini, `frames.ts` only does ffmpeg,
  `steps.ts` only parses/validates, `jobs.ts` only holds state, `processor.ts` only orchestrates.
- **Dependency Inversion:** `processor.ts` depends on injected abstractions (`ProcessorDeps`),
  which is why the whole pipeline state machine is unit-tested with fakes — no network/ffmpeg.
- **Open/Closed:** new templates are added by editing column data, not code.
- Per-module loop throughout: implement → test (green) → explain. 51 tests, plus live E2E.
