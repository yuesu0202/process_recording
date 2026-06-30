"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ColumnConfigArraySchema,
  DEFAULT_COLUMNS,
  RESERVED_COLUMN_KEYS,
  slugifyKey,
  type ColumnConfig,
} from "@/lib/schema";
import { loadColumns, saveColumns, resetColumns } from "@/lib/columnsStore";

/**
 * ColumnsEditor — Part 2. Lets a user add / remove / rename columns and edit their
 * descriptions, then persists a *validated* template. The same ColumnConfig[] this
 * produces drives the response schema, the prompt, and the table — so editing here
 * changes generation everywhere with no code changes. The reserved system columns
 * (Timestamp, Screenshot) are shown as fixed and cannot be edited or removed.
 */
export function ColumnsEditor() {
  const [columns, setColumns] = useState<ColumnConfig[]>(DEFAULT_COLUMNS);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setColumns(loadColumns());
  }, []);

  function updateRow(index: number, patch: Partial<ColumnConfig>) {
    setColumns((prev) => prev.map((col, i) => (i === index ? { ...col, ...patch } : col)));
    setSavedAt(null);
  }

  function addRow() {
    setColumns((prev) => [...prev, { key: "", label: "", description: "" }]);
    setSavedAt(null);
  }

  function removeRow(index: number) {
    setColumns((prev) => prev.filter((_, i) => i !== index));
    setSavedAt(null);
  }

  function handleSave() {
    // Derive keys from labels so the user only manages labels + descriptions.
    const withKeys = columns.map((col) => ({
      ...col,
      label: col.label.trim(),
      key: col.key || slugifyKey(col.label),
    }));

    const result = ColumnConfigArraySchema.safeParse(withKeys);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Invalid configuration.");
      return;
    }
    try {
      saveColumns(result.data);
      setColumns(result.data);
      setError(null);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    }
  }

  function handleReset() {
    resetColumns();
    setColumns(DEFAULT_COLUMNS);
    setError(null);
    setSavedAt(null);
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        Define the columns Gemini generates for each step. Different clients use different
        templates — your changes here drive the prompt, the AI schema, and the results table.
      </p>

      <div className="space-y-3">
        {columns.map((col, i) => (
          <div key={i} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="grid flex-1 gap-3 sm:grid-cols-[1fr_2fr]">
                <div>
                  <label className="text-xs font-medium text-slate-500">Column name</label>
                  <input
                    value={col.label}
                    onChange={(e) => updateRow(i, { label: e.target.value, key: "" })}
                    placeholder="e.g. Risk Level"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">
                    Description (guides what Gemini writes)
                  </label>
                  <input
                    value={col.description}
                    onChange={(e) => updateRow(i, { description: e.target.value })}
                    placeholder="e.g. How risky this step is: Low, Medium, or High."
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="mt-6 rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                aria-label={`Remove ${col.label || "column"}`}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRow}
        className="rounded-md border border-dashed border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
      >
        + Add column
      </button>

      {/* Reserved, system-owned columns — always present, never editable. */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
        <span className="font-medium text-slate-600">Always included:</span>{" "}
        {RESERVED_COLUMN_KEYS.map((k) => k[0].toUpperCase() + k.slice(1)).join(" · ")} — these are
        produced by the system (timestamp from Gemini, screenshot from the video) and can&apos;t be
        changed.
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Save template
        </button>
        <button type="button" onClick={handleReset} className="text-sm text-slate-500 hover:text-slate-800">
          Reset to defaults
        </button>
        {savedAt && <span className="text-sm text-green-700">Saved.</span>}
        <Link href="/" className="ml-auto text-sm font-medium text-slate-700 hover:text-slate-900">
          ← Back to upload
        </Link>
      </div>
    </div>
  );
}
