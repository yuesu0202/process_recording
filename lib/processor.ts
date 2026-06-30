import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { ColumnConfig, Step } from "./schema";
import type { JobStore } from "./jobs";
import { parseSteps, StepParseError } from "./steps";
import {
  uploadAndWaitActive as realUpload,
  generateSteps as realGenerate,
  deleteUploadedVideo as realDelete,
  type UploadedVideo,
} from "./gemini";
import {
  getVideoDurationSeconds as realDuration,
  extractFrame as realExtractFrame,
} from "./frames";

/**
 * processor.ts — the high-level job pipeline. It orchestrates the abstractions
 * (Gemini boundary, ffmpeg boundary, pure validators) into the end-to-end flow and
 * drives the JobStore through its states. Per Dependency Inversion, every external
 * effect is injected via `ProcessorDeps`, so the whole state machine can be tested
 * with fakes — no network, no ffmpeg, no filesystem.
 */

/** Where extracted PNGs are written, and the public URL they are served from. */
const SCREENSHOTS_DIR = path.join(process.cwd(), "public", "screenshots");

export interface ProcessorDeps {
  uploadAndWaitActive: (videoPath: string, mimeType: string) => Promise<UploadedVideo>;
  generateSteps: (params: {
    video: UploadedVideo;
    columns: ColumnConfig[];
    feedbackError?: string;
  }) => Promise<unknown>;
  deleteUploadedVideo: (name: string) => Promise<void>;
  /** Fills in each step's screenshotUrl by extracting frames; one bad frame → null. */
  attachScreenshots: (jobId: string, videoPath: string, steps: Step[]) => Promise<Step[]>;
}

/** The real dependency set used in production. */
export const defaultDeps: ProcessorDeps = {
  uploadAndWaitActive: realUpload,
  generateSteps: realGenerate,
  deleteUploadedVideo: realDelete,
  attachScreenshots: attachScreenshots,
};

export interface ProcessVideoParams {
  jobId: string;
  videoPath: string;
  mimeType: string;
  columns: ColumnConfig[];
  store: JobStore;
  deps?: ProcessorDeps;
}

/**
 * Run the full pipeline for one job. Always resolves — failures are recorded on the
 * job (fail loud, never crash the server), and the temp video is always cleaned up.
 */
export async function processVideo({
  jobId,
  videoPath,
  mimeType,
  columns,
  store,
  deps = defaultDeps,
}: ProcessVideoParams): Promise<void> {
  let uploadedName: string | undefined;
  try {
    store.setStage(jobId, "uploading");
    const video = await deps.uploadAndWaitActive(videoPath, mimeType);
    uploadedName = video.name;

    store.setStage(jobId, "analyzing");
    const steps = await extractStepsWithRetry(video, columns, deps);

    store.setStage(jobId, "extracting");
    const withShots = await deps.attachScreenshots(jobId, videoPath, steps);

    store.markDone(jobId, withShots);
  } catch (err) {
    store.markError(jobId, err instanceof Error ? err.message : "Unknown processing error.");
  } finally {
    if (uploadedName) await deps.deleteUploadedVideo(uploadedName);
    await rm(videoPath, { force: true }).catch(() => {});
  }
}

/**
 * Generate + validate the steps, retrying once on a validation error by feeding the
 * error back to the model (CLAUDE.md §6). A second failure throws → job error state.
 */
async function extractStepsWithRetry(
  video: UploadedVideo,
  columns: ColumnConfig[],
  deps: ProcessorDeps,
): Promise<Step[]> {
  const raw = await deps.generateSteps({ video, columns });
  try {
    return parseSteps(raw, columns);
  } catch (err) {
    if (!(err instanceof StepParseError)) throw err;
    const retryRaw = await deps.generateSteps({ video, columns, feedbackError: err.message });
    return parseSteps(retryRaw, columns); // a second failure propagates to the job error state
  }
}

/**
 * Extract one frame per step into public/screenshots/<jobId>/ and set each step's
 * screenshotUrl. A single failed extraction leaves that step's url null and does not
 * fail the others (CLAUDE.md §7). This is the real implementation; tests inject a fake.
 */
export async function attachScreenshots(
  jobId: string,
  videoPath: string,
  steps: Step[],
): Promise<Step[]> {
  const outDir = path.join(SCREENSHOTS_DIR, jobId);
  await mkdir(outDir, { recursive: true });

  const duration = await realDuration(videoPath).catch(() => undefined);

  return Promise.all(
    steps.map(async (step) => {
      const fileName = `step-${step.index}.png`;
      const outputPath = path.join(outDir, fileName);
      try {
        await realExtractFrame({
          videoPath,
          atSeconds: step.timestampSeconds,
          outputPath,
          durationSeconds: duration,
        });
        return { ...step, screenshotUrl: `/screenshots/${jobId}/${fileName}` };
      } catch {
        return { ...step, screenshotUrl: null };
      }
    }),
  );
}
