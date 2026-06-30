import { describe, it, expect, vi } from "vitest";
import { processVideo, type ProcessorDeps } from "./processor";
import { JobStore } from "./jobs";
import { DEFAULT_COLUMNS, type Step } from "./schema";
import type { UploadedVideo } from "./gemini";

const fakeVideo: UploadedVideo = { uri: "files/abc", mimeType: "video/mp4", name: "files/abc" };

/** A minimal valid model response for the default columns. */
const validRaw = [
  { action: "Open", description: "Click", expectedResult: "Shown", timestamp: "00:05" },
];

function makeDeps(overrides: Partial<ProcessorDeps> = {}): ProcessorDeps {
  return {
    uploadAndWaitActive: vi.fn(async () => fakeVideo),
    generateSteps: vi.fn(async () => validRaw),
    deleteUploadedVideo: vi.fn(async () => {}),
    // Pass steps through, simulating a successful screenshot for each.
    attachScreenshots: vi.fn(async (_jobId: string, _path: string, steps: Step[]) =>
      steps.map((s) => ({ ...s, screenshotUrl: `/screenshots/x/step-${s.index}.png` })),
    ),
    ...overrides,
  };
}

const baseParams = (store: JobStore, deps: ProcessorDeps) => ({
  jobId: store.create(DEFAULT_COLUMNS).id,
  videoPath: "/tmp/does-not-exist.mp4", // rm with {force:true} tolerates a missing file
  mimeType: "video/mp4",
  columns: DEFAULT_COLUMNS,
  store,
  deps,
});

describe("processVideo", () => {
  it("runs the happy path to done with screenshots attached", async () => {
    const store = new JobStore();
    const deps = makeDeps();
    const params = baseParams(store, deps);

    await processVideo(params);

    const job = store.get(params.jobId)!;
    expect(job.status).toBe("done");
    expect(job.stage).toBeUndefined();
    expect(job.steps?.[0].screenshotUrl).toContain("/screenshots/");
    expect(deps.deleteUploadedVideo).toHaveBeenCalledWith(fakeVideo.name);
  });

  it("retries once when the first model response is invalid, then succeeds", async () => {
    const store = new JobStore();
    const generateSteps = vi
      .fn()
      .mockResolvedValueOnce({ not: "an array" }) // invalid → StepParseError
      .mockResolvedValueOnce(validRaw); // corrected
    const deps = makeDeps({ generateSteps });
    const params = baseParams(store, deps);

    await processVideo(params);

    expect(generateSteps).toHaveBeenCalledTimes(2);
    expect(generateSteps.mock.calls[1][0]).toHaveProperty("feedbackError");
    expect(store.get(params.jobId)!.status).toBe("done");
  });

  it("marks the job errored when both attempts are invalid", async () => {
    const store = new JobStore();
    const deps = makeDeps({ generateSteps: vi.fn(async () => ({ not: "an array" })) });
    const params = baseParams(store, deps);

    await processVideo(params);

    const job = store.get(params.jobId)!;
    expect(job.status).toBe("error");
    expect(job.error).toBeTruthy();
  });

  it("marks the job errored when upload fails, and still cleans up", async () => {
    const store = new JobStore();
    const deps = makeDeps({
      uploadAndWaitActive: vi.fn(async () => {
        throw new Error("upload boom");
      }),
    });
    const params = baseParams(store, deps);

    await processVideo(params);

    const job = store.get(params.jobId)!;
    expect(job.status).toBe("error");
    expect(job.error).toBe("upload boom");
    // No uploaded file to delete since upload failed.
    expect(deps.deleteUploadedVideo).not.toHaveBeenCalled();
  });
});
