import { describe, it, expect, vi } from "vitest";
import { pollUntilActive } from "./gemini";

// FileState string values from the SDK: ACTIVE, FAILED, PROCESSING.
const noWait = () => Promise.resolve();

describe("pollUntilActive", () => {
  it("resolves once the file becomes ACTIVE", async () => {
    const states = ["PROCESSING", "PROCESSING", "ACTIVE"];
    const fetchState = vi.fn(() => Promise.resolve(states.shift()!));

    await expect(
      pollUntilActive(fetchState, { intervalMs: 1, timeoutMs: 1000, sleep: noWait }),
    ).resolves.toBeUndefined();
    expect(fetchState).toHaveBeenCalledTimes(3);
  });

  it("throws immediately when the file is FAILED", async () => {
    const fetchState = vi.fn(() => Promise.resolve("FAILED"));
    await expect(
      pollUntilActive(fetchState, { intervalMs: 1, timeoutMs: 1000, sleep: noWait }),
    ).rejects.toThrow(/failed to process/i);
    expect(fetchState).toHaveBeenCalledTimes(1);
  });

  it("throws when the file never becomes ACTIVE before the timeout", async () => {
    const fetchState = vi.fn(() => Promise.resolve("PROCESSING"));
    await expect(
      pollUntilActive(fetchState, { intervalMs: 10, timeoutMs: 30, sleep: noWait }),
    ).rejects.toThrow(/timed out/i);
  });
});
