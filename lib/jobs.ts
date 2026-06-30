import { randomUUID } from "node:crypto";
import type { ColumnConfig, Job, Step, JobStage } from "./schema";

/**
 * jobs.ts — the in-memory job store. Single responsibility: hold job state and
 * expose create/get/update. It knows nothing about Gemini, ffmpeg, or HTTP — the
 * processor drives it and the API routes read from it.
 *
 * KNOWN LIMITATION (called out in the README): an in-memory Map does not survive a
 * server restart and is not shared across multiple workers / serverless instances.
 * For production this becomes Redis or a database plus a real job queue. Acceptable
 * for this prototype, where processing runs in the same Node process.
 */
export class JobStore {
  private jobs = new Map<string, Job>();

  /** Create a new job in the "processing" state and return it. */
  create(columns: ColumnConfig[]): Job {
    const job: Job = {
      id: randomUUID(),
      status: "processing",
      stage: "uploading",
      columns,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /**
   * Shallow-merge a partial update into an existing job. Returns the updated job, or
   * undefined if the id is unknown. Immutable replacement keeps reads consistent.
   */
  update(id: string, patch: Partial<Job>): Job | undefined {
    const existing = this.jobs.get(id);
    if (!existing) return undefined;
    const updated: Job = { ...existing, ...patch };
    this.jobs.set(id, updated);
    return updated;
  }

  /** Convenience helpers for the common transitions, to keep call sites readable. */
  setStage(id: string, stage: JobStage): void {
    this.update(id, { stage });
  }

  markDone(id: string, steps: Step[]): void {
    this.update(id, { status: "done", stage: undefined, steps });
  }

  markError(id: string, error: string): void {
    this.update(id, { status: "error", stage: undefined, error });
  }
}

/**
 * A single process-wide store instance. Stashed on `globalThis` so Next.js's dev
 * hot-reload doesn't create a new store (and lose all jobs) on every code change.
 */
const globalForJobs = globalThis as unknown as { __jobStore?: JobStore };
export const jobStore = globalForJobs.__jobStore ?? new JobStore();
globalForJobs.__jobStore = jobStore;
