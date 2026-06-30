import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, statSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { clampSeconds, getVideoDurationSeconds, extractFrame } from "./frames";

// A small sample video shipped with the repo, used for real ffmpeg integration tests.
const SAMPLE_VIDEO = path.resolve(
  __dirname,
  "../sample_video/Process_Recording_Examples/PO to GR Flow example compressed.mp4",
);
const hasSample = existsSync(SAMPLE_VIDEO);

describe("clampSeconds (pure)", () => {
  it("clamps negatives up to 0", () => {
    expect(clampSeconds(-5)).toBe(0);
  });

  it("passes through values within range", () => {
    expect(clampSeconds(10, 60)).toBe(10);
  });

  it("clamps values beyond the duration to just before the end", () => {
    expect(clampSeconds(120, 60)).toBeCloseTo(59.9, 5);
  });

  it("ignores a non-finite duration", () => {
    expect(clampSeconds(10, Number.NaN)).toBe(10);
  });
});

// Integration tests exercise the real ffmpeg binary against a real video.
// They are skipped automatically if the sample video is not present.
describe.skipIf(!hasSample)("ffmpeg integration", () => {
  let outDir: string;

  beforeAll(() => {
    outDir = path.join(os.tmpdir(), "frames-test-" + process.pid);
    mkdirSync(outDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("probes a positive duration", async () => {
    const duration = await getVideoDurationSeconds(SAMPLE_VIDEO);
    expect(duration).toBeGreaterThan(0);
  });

  it("extracts a non-empty PNG at a timestamp", async () => {
    const out = path.join(outDir, "frame-1.png");
    await extractFrame({ videoPath: SAMPLE_VIDEO, atSeconds: 1, outputPath: out });
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(0);
  });

  it("clamps an out-of-range timestamp instead of failing", async () => {
    const duration = await getVideoDurationSeconds(SAMPLE_VIDEO);
    const out = path.join(outDir, "frame-clamped.png");
    await extractFrame({
      videoPath: SAMPLE_VIDEO,
      atSeconds: duration + 9999,
      outputPath: out,
      durationSeconds: duration,
    });
    expect(statSync(out).size).toBeGreaterThan(0);
  });
});
