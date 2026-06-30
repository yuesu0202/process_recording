import { describe, it, expect } from "vitest";
import { buildPrompt } from "./prompt";
import { DEFAULT_COLUMNS, type ColumnConfig } from "./schema";

describe("buildPrompt", () => {
  it("mentions every configured column key and label", () => {
    const prompt = buildPrompt(DEFAULT_COLUMNS);
    for (const col of DEFAULT_COLUMNS) {
      expect(prompt).toContain(`"${col.key}"`);
      expect(prompt).toContain(col.label);
    }
  });

  it("always instructs the model about the timestamp field", () => {
    const prompt = buildPrompt(DEFAULT_COLUMNS);
    expect(prompt).toContain('"timestamp"');
    expect(prompt.toLowerCase()).toContain("chronological");
  });

  it("extends to custom columns without code changes (Open/Closed)", () => {
    const custom: ColumnConfig[] = [
      { key: "risk", label: "Risk Level", description: "How risky this step is." },
    ];
    const prompt = buildPrompt(custom);
    expect(prompt).toContain('"risk"');
    expect(prompt).toContain("Risk Level");
    expect(prompt).toContain("How risky this step is.");
  });

  it("falls back to the label when a column has no description", () => {
    const custom: ColumnConfig[] = [{ key: "note", label: "Note", description: "" }];
    const prompt = buildPrompt(custom);
    expect(prompt).toContain('"note" (Note): Note');
  });
});
