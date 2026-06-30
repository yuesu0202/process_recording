import { describe, it, expect } from "vitest";
import { JobStore } from "./jobs";
import { DEFAULT_COLUMNS, type Step } from "./schema";

const sampleStep: Step = { index: 0, timestampSeconds: 1, fields: { action: "a" }, screenshotUrl: null };

describe("JobStore", () => {
  it("creates a job in the processing/uploading state with a unique id", () => {
    const store = new JobStore();
    const a = store.create(DEFAULT_COLUMNS);
    const b = store.create(DEFAULT_COLUMNS);
    expect(a.status).toBe("processing");
    expect(a.stage).toBe("uploading");
    expect(a.columns).toEqual(DEFAULT_COLUMNS);
    expect(a.id).not.toBe(b.id);
  });

  it("gets a job by id and returns undefined for unknown ids", () => {
    const store = new JobStore();
    const job = store.create(DEFAULT_COLUMNS);
    expect(store.get(job.id)?.id).toBe(job.id);
    expect(store.get("nope")).toBeUndefined();
  });

  it("merges partial updates immutably", () => {
    const store = new JobStore();
    const job = store.create(DEFAULT_COLUMNS);
    store.update(job.id, { stage: "analyzing" });
    const updated = store.get(job.id)!;
    expect(updated.stage).toBe("analyzing");
    expect(updated.status).toBe("processing"); // untouched fields preserved
  });

  it("markDone transitions to done with steps and clears the stage", () => {
    const store = new JobStore();
    const job = store.create(DEFAULT_COLUMNS);
    store.markDone(job.id, [sampleStep]);
    const done = store.get(job.id)!;
    expect(done.status).toBe("done");
    expect(done.stage).toBeUndefined();
    expect(done.steps).toHaveLength(1);
  });

  it("markError transitions to error with a message", () => {
    const store = new JobStore();
    const job = store.create(DEFAULT_COLUMNS);
    store.markError(job.id, "boom");
    const errored = store.get(job.id)!;
    expect(errored.status).toBe("error");
    expect(errored.error).toBe("boom");
  });

  it("update on an unknown id returns undefined", () => {
    const store = new JobStore();
    expect(store.update("nope", { stage: "analyzing" })).toBeUndefined();
  });
});
