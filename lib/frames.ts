import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

/**
 * frames.ts — the ONLY ffmpeg boundary (Golden Rule 4). Nothing else in the app
 * spawns ffmpeg. It exposes two primitives the job pipeline depends on:
 *   - getVideoDurationSeconds: probe how long the video is (for clamping).
 *   - extractFrame:            capture one PNG at a given timestamp.
 *
 * This is the *abstraction* the pipeline inverts onto (Dependency Inversion): the
 * pipeline knows "extract a frame at N seconds", not how ffmpeg is invoked, so this
 * boundary could be swapped for a fake or a different tool without touching callers.
 */

// Use the bundled static binaries so there is no system-install dependency.
if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);

/** Probe the video's duration in seconds. Throws if the file is unreadable. */
export function getVideoDurationSeconds(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(new Error(`Failed to probe video duration: ${err.message}`));
        return;
      }
      const duration = metadata.format?.duration;
      if (typeof duration !== "number" || !Number.isFinite(duration)) {
        reject(new Error("Could not determine video duration."));
        return;
      }
      resolve(duration);
    });
  });
}

export interface ExtractFrameParams {
  videoPath: string;
  /** Requested timestamp in seconds; clamped to the video bounds when duration is known. */
  atSeconds: number;
  /** Absolute path of the PNG to write. */
  outputPath: string;
  /** Optional known duration; used to clamp so we never seek past the end. */
  durationSeconds?: number;
}

/**
 * Extract a single frame as a PNG at the given timestamp.
 *
 * Uses *input seeking* (`-ss` before `-i`) so ffmpeg jumps directly to the
 * keyframe near the timestamp instead of decoding from the start — fast even for
 * 3-minute videos. The timestamp is clamped into `[0, duration)` when a duration is
 * provided, so a slightly-out-of-range model timestamp still yields a valid frame.
 */
export function extractFrame({
  videoPath,
  atSeconds,
  outputPath,
  durationSeconds,
}: ExtractFrameParams): Promise<void> {
  const seek = clampSeconds(atSeconds, durationSeconds);

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .inputOptions(["-ss", seek.toString()])
      .outputOptions(["-frames:v", "1", "-q:v", "2"])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(new Error(`Failed to extract frame at ${seek}s: ${err.message}`)))
      .run();
  });
}

/**
 * Clamp a requested timestamp into the valid range. Pulled out as a pure function
 * so the bounds logic is unit-testable without invoking ffmpeg.
 */
export function clampSeconds(atSeconds: number, durationSeconds?: number): number {
  const lower = Math.max(0, Number.isFinite(atSeconds) ? atSeconds : 0);
  if (durationSeconds === undefined || !Number.isFinite(durationSeconds)) {
    return lower;
  }
  // Stay a hair before the end so the seek lands on a real frame.
  const upper = Math.max(0, durationSeconds - 0.1);
  return Math.min(lower, upper);
}
