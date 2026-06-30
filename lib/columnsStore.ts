import { ColumnConfigArraySchema, DEFAULT_COLUMNS, type ColumnConfig } from "./schema";

/**
 * columnsStore.ts — client-side persistence for the user's column template (Part 2).
 *
 * localStorage is intentional for the prototype: it keeps Part 2 simple and needs no
 * backend. The README notes the production path — a per-client template store on the
 * server. Crucially, every read is re-validated against the current schema, so a
 * stale or hand-edited value can never feed a broken template into generation.
 */
const STORAGE_KEY = "process-recording.columns";

/** Load the saved template, falling back to the defaults if absent or invalid. */
export function loadColumns(): ColumnConfig[] {
  if (typeof window === "undefined") return DEFAULT_COLUMNS;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_COLUMNS;

  try {
    const result = ColumnConfigArraySchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : DEFAULT_COLUMNS;
  } catch {
    return DEFAULT_COLUMNS;
  }
}

/** Persist a validated template. Throws if the config is invalid (caller surfaces it). */
export function saveColumns(columns: ColumnConfig[]): void {
  const result = ColumnConfigArraySchema.safeParse(columns);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid column configuration.");
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(result.data));
}

/** Restore the default template. */
export function resetColumns(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}
