"use client";

import { useEffect, useRef, useState } from "react";
import type { ColumnConfig, Job } from "@/lib/schema";
import { DEFAULT_COLUMNS } from "@/lib/schema";
import { loadColumns } from "@/lib/columnsStore";
import { StepsTable } from "./StepsTable";

const POLL_INTERVAL_MS = 2000;

const STAGE_LABEL: Record<string, string> = {
  uploading: "Uploading & preparing the video…",
  analyzing: "Analyzing the recording with Gemini…",
  extracting: "Capturing screenshots…",
};

type View =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "tracking"; jobId: string; job: Job | null }
  | { kind: "error"; message: string };

/**
 * The client-side flow: pick a file → POST it → poll the job → render the table.
 * Columns are loaded from the user's saved template (Part 2), defaulting to the
 * seed config, and sent with the upload so generation matches the chosen template.
 */
export function UploadAndResults() {
  const [view, setView] = useState<View>({ kind: "idle" });
  const [columns, setColumns] = useState<ColumnConfig[]>(DEFAULT_COLUMNS);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load the saved template on mount (localStorage is client-only).
  useEffect(() => {
    setColumns(loadColumns());
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setView({ kind: "error", message: "Please choose a video file first." });
      return;
    }

    setView({ kind: "submitting" });
    const body = new FormData();
    body.append("video", file);
    body.append("columns", JSON.stringify(columns));

    try {
      const res = await fetch("/api/jobs", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed.");
      setView({ kind: "tracking", jobId: data.jobId, job: null });
    } catch (err) {
      setView({ kind: "error", message: err instanceof Error ? err.message : "Upload failed." });
    }
  }

  // Poll the job while we are tracking one and it is still processing.
  useEffect(() => {
    if (view.kind !== "tracking") return;
    if (view.job && view.job.status !== "processing") return;

    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${view.jobId}`);
        if (!res.ok) throw new Error("Lost track of the job.");
        const job: Job = await res.json();
        if (!cancelled) setView({ kind: "tracking", jobId: view.jobId, job });
      } catch (err) {
        if (!cancelled) {
          setView({ kind: "error", message: err instanceof Error ? err.message : "Polling failed." });
        }
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [view]);

  function reset() {
    setView({ kind: "idle" });
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <label className="block text-sm font-medium text-slate-700">Screen recording (under 3 minutes)</label>
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          className="mt-2 block w-full text-sm text-slate-600 file:mr-4 file:rounded-md file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700"
        />
        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            disabled={view.kind === "submitting" || (view.kind === "tracking" && view.job?.status === "processing")}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            Generate test script
          </button>
          {view.kind !== "idle" && (
            <button type="button" onClick={reset} className="text-sm text-slate-500 hover:text-slate-800">
              Start over
            </button>
          )}
          <span className="ml-auto text-xs text-slate-400">{columns.length} columns · {STAGE_HINT}</span>
        </div>
      </form>

      <StatusPanel view={view} columns={columns} />
    </div>
  );
}

const STAGE_HINT = "edit in Configure columns";

function StatusPanel({ view, columns }: { view: View; columns: ColumnConfig[] }) {
  if (view.kind === "idle") return null;

  if (view.kind === "submitting") {
    return <Banner tone="info">Uploading your recording…</Banner>;
  }

  if (view.kind === "error") {
    return <Banner tone="error">{view.message}</Banner>;
  }

  // tracking
  const job = view.job;
  if (!job || job.status === "processing") {
    const stage = job?.stage ?? "uploading";
    return <Banner tone="info">{STAGE_LABEL[stage] ?? "Processing…"}</Banner>;
  }

  if (job.status === "error") {
    return <Banner tone="error">{job.error ?? "Processing failed."}</Banner>;
  }

  // done
  const steps = job.steps ?? [];
  return (
    <div className="space-y-3">
      <Banner tone="success">Done — {steps.length} steps extracted.</Banner>
      <StepsTable columns={job.columns ?? columns} steps={steps} />
    </div>
  );
}

function Banner({ tone, children }: { tone: "info" | "error" | "success"; children: React.ReactNode }) {
  const styles = {
    info: "border-blue-200 bg-blue-50 text-blue-800",
    error: "border-red-200 bg-red-50 text-red-800",
    success: "border-green-200 bg-green-50 text-green-800",
  }[tone];
  return (
    <div className={`flex items-center gap-2 rounded-md border px-4 py-3 text-sm ${styles}`}>
      {tone === "info" && <Spinner />}
      <span>{children}</span>
    </div>
  );
}

function Spinner() {
  return (
    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-300 border-t-blue-700" aria-hidden />
  );
}
