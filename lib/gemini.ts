import { GoogleGenerativeAI, type ResponseSchema } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { buildResponseSchema, type ColumnConfig } from "./schema";
import { buildPrompt } from "./prompt";

/**
 * gemini.ts — the ONLY Gemini boundary (Golden Rule 4). Nothing else imports the
 * SDK. It does three things, in this order, mirroring the required flow:
 *   1. uploadAndWaitActive — upload the video via the Files API and poll until the
 *      file is ACTIVE (the model cannot read a still-PROCESSING file).
 *   2. generateSteps      — call generateContent with a *structured* response schema
 *      built from the column config, and return the raw (still untrusted) JSON.
 *
 * Validation of that JSON lives in steps.ts, and the retry-on-invalid orchestration
 * lives in the job pipeline — keeping this file a thin, swappable I/O boundary.
 */

const DEFAULT_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

/** Read and validate the API key once, with a clear error if it is missing. */
function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is not set. Add it to .env.local.");
  }
  return key;
}

/** A video that has been uploaded and confirmed ACTIVE, ready to pass to the model. */
export interface UploadedVideo {
  uri: string;
  mimeType: string;
  /** The Files API resource name, used for cleanup. */
  name: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Poll a file's state until it is ACTIVE. Extracted as a pure-ish function (it takes
 * its own `fetchState` and `sleep`) so the timeout / FAILED / PROCESSING logic is
 * unit-testable without hitting the network.
 *
 * @throws if the file reports FAILED, or if it does not become ACTIVE before timeout.
 */
export async function pollUntilActive(
  fetchState: () => Promise<string>,
  opts: { intervalMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const intervalMs = opts.intervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const wait = opts.sleep ?? sleep;
  const deadline = timeoutMs / intervalMs;

  for (let attempts = 0; attempts < deadline; attempts++) {
    const state = await fetchState();
    if (state === FileState.ACTIVE) return;
    if (state === FileState.FAILED) {
      throw new Error("Gemini failed to process the uploaded video.");
    }
    await wait(intervalMs);
  }
  throw new Error("Timed out waiting for Gemini to finish processing the video.");
}

/**
 * Upload a video file and wait until it is ACTIVE on the Files API.
 * This polling is required — the model rejects a file that is still PROCESSING.
 */
export async function uploadAndWaitActive(videoPath: string, mimeType: string): Promise<UploadedVideo> {
  const fileManager = new GoogleAIFileManager(getApiKey());

  const upload = await fileManager.uploadFile(videoPath, { mimeType });
  const name = upload.file.name;

  await pollUntilActive(async () => {
    const file = await fileManager.getFile(name);
    return file.state;
  });

  const active = await fileManager.getFile(name);
  return { uri: active.uri, mimeType: active.mimeType, name };
}

/** Best-effort cleanup of an uploaded file; never throws (cleanup must not fail a job). */
export async function deleteUploadedVideo(name: string): Promise<void> {
  try {
    await new GoogleAIFileManager(getApiKey()).deleteFile(name);
  } catch {
    // Ignore — the file expires on Gemini's side automatically.
  }
}

export interface GenerateStepsParams {
  video: UploadedVideo;
  columns: ColumnConfig[];
  /** When set, an error from a previous attempt is fed back so the model can correct itself. */
  feedbackError?: string;
}

/**
 * Ask Gemini to segment the video into steps. Returns the raw parsed JSON, which is
 * an UNTRUSTED claim — the caller must validate it with steps.parseSteps. Uses
 * structured output (responseMimeType + responseSchema built from the columns) and a
 * low temperature for determinism.
 */
export async function generateSteps({ video, columns, feedbackError }: GenerateStepsParams): Promise<unknown> {
  const genAI = new GoogleGenerativeAI(getApiKey());
  const responseSchema = buildResponseSchema(columns) as unknown as ResponseSchema;

  const model = genAI.getGenerativeModel({
    model: DEFAULT_MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0,
    },
  });

  let prompt = buildPrompt(columns);
  if (feedbackError) {
    prompt += `\n\nYour previous response was rejected: ${feedbackError}\nReturn corrected JSON that matches the required schema exactly.`;
  }

  const result = await model.generateContent([
    { fileData: { fileUri: video.uri, mimeType: video.mimeType } },
    { text: prompt },
  ]);

  const text = result.response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Gemini returned output that was not valid JSON.");
  }
}
