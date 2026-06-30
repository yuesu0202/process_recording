import { z } from "zod";

/**
 * schema.ts — the single source of truth for the data model.
 *
 * Everything in the app is *column-driven*: the same `ColumnConfig[]` drives the
 * Gemini response schema, the prompt, and the table headers. Part 1 and Part 2
 * therefore share one model — adding a column is a data change, not a code change
 * (Open/Closed). This file owns the types and the schema-from-columns builder; it
 * deliberately knows nothing about Gemini, ffmpeg, or React.
 */

/**
 * System-owned columns. These are NOT user-editable and NOT generated as text by
 * the model:
 *   - `timestamp`  is read from Gemini but is a structural field, not a text column.
 *   - `screenshot` is derived by ffmpeg from the timestamp; the model never sees it.
 * User column keys may never collide with these.
 */
export const RESERVED_COLUMN_KEYS = ["timestamp", "screenshot"] as const;

/** A column key must be a safe identifier because it becomes a JSON property name. */
const COLUMN_KEY_PATTERN = /^[a-z][a-z0-9_]*$/i;

/** One user-configurable, AI-generated text column. */
export const ColumnConfigSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(""),
});
export type ColumnConfig = z.infer<typeof ColumnConfigSchema>;

/**
 * Validate a full column config. Used by Part 2 so a bad custom template can never
 * reach generation. Rules: at least one column; keys are safe identifiers, unique,
 * and not reserved.
 */
export const ColumnConfigArraySchema = z
  .array(ColumnConfigSchema)
  .min(1, "At least one column is required.")
  .superRefine((columns, ctx) => {
    const seen = new Set<string>();
    columns.forEach((col, i) => {
      if (!COLUMN_KEY_PATTERN.test(col.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, "key"],
          message: `Invalid key "${col.key}": use letters, digits, and underscores, starting with a letter.`,
        });
      }
      if ((RESERVED_COLUMN_KEYS as readonly string[]).includes(col.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, "key"],
          message: `"${col.key}" is a reserved system column.`,
        });
      }
      if (seen.has(col.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, "key"],
          message: `Duplicate column key "${col.key}".`,
        });
      }
      seen.add(col.key);
    });
  });

/** The default template, used as the seed config. Just data — not special-cased anywhere. */
export const DEFAULT_COLUMNS: ColumnConfig[] = [
  {
    key: "action",
    label: "Action",
    description: "A short, high-level name for the action the user performed (e.g. 'Open the Purchase Orders page').",
  },
  {
    key: "description",
    label: "Description",
    description: "A precise, instructional description of how to perform this step.",
  },
  {
    key: "expectedResult",
    label: "Expected Result",
    description: "What the user should observe on screen after performing the action.",
  },
];

/**
 * Derive a safe column key from a human label, so the config UI can let users type
 * just a label. Lowercases, replaces runs of non-alphanumerics with underscores, and
 * ensures it starts with a letter (keys must match COLUMN_KEY_PATTERN). Falls back to
 * "column" for labels with no usable characters.
 */
export function slugifyKey(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (slug === "" || /^[0-9]/.test(slug)) {
    return `column_${slug}`.replace(/_+$/g, "");
  }
  return slug;
}

/** One extracted step. `fields` is keyed by `ColumnConfig.key`. */
export const StepSchema = z.object({
  index: z.number().int().nonnegative(),
  timestampSeconds: z.number().nonnegative(),
  fields: z.record(z.string()),
  screenshotUrl: z.string().nullable(),
});
export type Step = z.infer<typeof StepSchema>;

export type JobStatus = "processing" | "done" | "error";
/** Sub-state of a processing job, surfaced to the UI for progress messaging. */
export type JobStage = "uploading" | "analyzing" | "extracting";

export interface Job {
  id: string;
  status: JobStatus;
  stage?: JobStage;
  columns: ColumnConfig[];
  steps?: Step[];
  error?: string;
}

/**
 * A minimal subset of the JSON-Schema dialect Gemini accepts for `responseSchema`.
 * We model it locally (instead of importing the SDK's `Schema` type) so this module
 * stays free of the Gemini dependency — gemini.ts is the only SDK boundary.
 */
export type GeminiSchema =
  | { type: "string"; description?: string }
  | { type: "array"; items: GeminiSchema; description?: string }
  | {
      type: "object";
      properties: Record<string, GeminiSchema>;
      required?: string[];
      description?: string;
    };

/**
 * Build the Gemini response schema from the column config: an array of step
 * objects, each with one string property per configured column plus a `timestamp`
 * string. Asking for structured output is how we treat the model as untrusted —
 * it must return this shape, and we still validate the result downstream.
 */
export function buildResponseSchema(columns: ColumnConfig[]): GeminiSchema {
  const properties: Record<string, GeminiSchema> = {};
  for (const col of columns) {
    properties[col.key] = {
      type: "string",
      description: col.description || col.label,
    };
  }
  properties.timestamp = {
    type: "string",
    description:
      "The timestamp in MM:SS format at the moment this step's result is clearly visible on screen.",
  };

  return {
    type: "array",
    items: {
      type: "object",
      properties,
      required: [...columns.map((c) => c.key), "timestamp"],
    },
  };
}
