import type { ColumnConfig } from "./schema";

/**
 * prompt.ts — pure logic that builds the Gemini instruction text from the column
 * config. Like the response schema, the prompt is *derived from the columns*, never
 * hard-coded — so adding a column in Part 2 automatically teaches the model about it
 * (Golden Rule 6). No SDK, no I/O: just string-building, so it is unit-testable.
 */

/**
 * Render the configured columns as a numbered instruction list, e.g.:
 *   - "action" (Action): A short, high-level name...
 * The model is told to produce exactly these fields per step.
 */
function renderColumnInstructions(columns: ColumnConfig[]): string {
  return columns
    .map((col) => {
      const description = col.description.trim() || col.label;
      return `  - "${col.key}" (${col.label}): ${description}`;
    })
    .join("\n");
}

/**
 * Build the full prompt that accompanies the video. It explains the task
 * (segment a screen recording into discrete user actions), lists the exact fields
 * to produce per step, and pins down how to choose the timestamp — the timestamp is
 * what our ffmpeg code uses to extract the screenshot, so its quality is critical.
 */
export function buildPrompt(columns: ColumnConfig[]): string {
  return [
    "You are analysing a screen recording of a user completing a software process",
    "(for example, creating a purchase order in an ERP system). Your job is to break",
    "the recording into the sequence of discrete, meaningful actions the user takes,",
    "so a colleague could reproduce the process by following your steps.",
    "",
    "Return a JSON array where each element is one step, in chronological order.",
    "Each step object must contain exactly these fields:",
    "",
    renderColumnInstructions(columns),
    '  - "timestamp" (MM:SS): the moment in the video when the RESULT of this step is',
    "    clearly visible on screen.",
    "",
    "Guidelines:",
    "  - Capture genuine user actions (clicks, typing, navigation, submissions).",
    "    Do NOT invent steps that did not happen, and do NOT split one action into many.",
    "  - Choose each timestamp at a stable frame that clearly shows the outcome of the",
    "    action — avoid mid-scroll, loading spinners, or transition blurs, because this",
    "    timestamp is used to capture the step's screenshot.",
    "  - Keep the text concise and written as reproducible instructions.",
    "  - If a field does not apply to a step, return an empty string for it rather than",
    "    omitting it or inventing content.",
  ].join("\n");
}
