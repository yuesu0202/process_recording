import { z } from "zod";
import type { ColumnConfig, Step } from "./schema";

/**
 * steps.ts — pure logic that turns Gemini's *untrusted* JSON into validated
 * `Step[]`. No I/O, no SDK, no ffmpeg: just parsing, defaulting, and timestamp
 * math, so it is fully unit-testable. This is where Golden Rule 1 ("treat the
 * model's output as an untrusted claim") is enforced.
 */

/** Thrown when the model output cannot be coerced into the expected shape. */
export class StepParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StepParseError";
  }
}

/**
 * Parse Gemini's timestamp into seconds. Accepts the formats the model realistically
 * returns: "MM:SS", "HH:MM:SS", a bare number, or a numeric string ("12", "12.5").
 * Returns `null` for anything unparseable so the caller can decide how to recover —
 * we never throw here, because one odd timestamp shouldn't fail a whole job.
 */
export function parseTimestampToSeconds(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 0 ? raw : null;
  }
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // Pure number, e.g. "12" or "12.5"
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  // Colon-separated clock, e.g. "MM:SS" or "HH:MM:SS"
  if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(trimmed)) {
    const parts = trimmed.split(":").map(Number);
    if (parts.some((p) => Number.isNaN(p))) return null;
    return parts.reduce((acc, part) => acc * 60 + part, 0);
  }

  return null;
}

/**
 * Format a number of seconds back into "M:SS" (or "H:MM:SS") for display in the
 * table. The inverse of `parseTimestampToSeconds` for UI purposes.
 */
export function formatTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * Build the zod schema for a *single raw step* from the column config. Every
 * configured field is an optional string (missing → defaulted to "" rather than
 * crashing), plus a required `timestamp`. We allow unknown keys and strip them, so
 * a model that returns extra fields degrades gracefully (Part 2 robustness).
 */
function buildRawStepSchema(columns: ColumnConfig[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const col of columns) {
    // Coerce so a number/boolean field comes back as a string instead of failing.
    shape[col.key] = z.coerce.string().optional();
  }
  shape.timestamp = z.union([z.string(), z.number()]);
  return z.object(shape).passthrough();
}

/**
 * Validate and normalise raw model output into `Step[]`.
 *
 * @param raw      Parsed JSON from Gemini (expected: an array of step objects).
 * @param columns  The active column config that defines the expected fields.
 * @returns        Clean `Step[]` with `screenshotUrl: null` (frames fill it later).
 * @throws         StepParseError if `raw` is not an array or no step has a usable timestamp.
 */
export function parseSteps(raw: unknown, columns: ColumnConfig[]): Step[] {
  if (!Array.isArray(raw)) {
    throw new StepParseError("Expected the model to return an array of steps.");
  }

  const rawStepSchema = buildRawStepSchema(columns);
  const steps: Step[] = [];

  raw.forEach((item, i) => {
    const parsed = rawStepSchema.safeParse(item);
    if (!parsed.success) {
      // A single malformed row is skipped, not fatal — keep the good steps.
      return;
    }

    const seconds = parseTimestampToSeconds(parsed.data.timestamp);
    if (seconds === null) {
      // Without a timestamp we can't extract a screenshot, so this row is useless.
      return;
    }

    const fields: Record<string, string> = {};
    for (const col of columns) {
      const value = parsed.data[col.key];
      fields[col.key] = typeof value === "string" ? value : "";
    }

    steps.push({
      index: steps.length,
      timestampSeconds: seconds,
      fields,
      screenshotUrl: null,
    });
  });

  if (steps.length === 0) {
    throw new StepParseError("No valid steps with a usable timestamp were returned.");
  }

  // Chronological order, then re-index so indices are contiguous 0..n-1.
  steps.sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  steps.forEach((step, i) => (step.index = i));

  return steps;
}
