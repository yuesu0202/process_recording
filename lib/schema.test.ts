import { describe, it, expect } from "vitest";
import {
  ColumnConfigArraySchema,
  DEFAULT_COLUMNS,
  buildResponseSchema,
  slugifyKey,
  type ColumnConfig,
} from "./schema";

describe("slugifyKey", () => {
  it("lowercases and underscores non-alphanumerics", () => {
    expect(slugifyKey("Expected Result")).toBe("expected_result");
    expect(slugifyKey("Risk / Severity!")).toBe("risk_severity");
  });

  it("ensures the key starts with a letter", () => {
    expect(slugifyKey("123 step")).toBe("column_123_step");
  });

  it("falls back to a usable key for empty/symbol-only labels", () => {
    expect(slugifyKey("!!!")).toBe("column");
    expect(slugifyKey("")).toBe("column");
  });

  it("always produces a key that passes column validation", () => {
    for (const label of ["Expected Result", "123 step", "!!!", "UI Element"]) {
      const cols: ColumnConfig[] = [{ key: slugifyKey(label), label, description: "" }];
      expect(ColumnConfigArraySchema.safeParse(cols).success).toBe(true);
    }
  });
});

describe("ColumnConfigArraySchema", () => {
  it("accepts the default columns", () => {
    expect(ColumnConfigArraySchema.safeParse(DEFAULT_COLUMNS).success).toBe(true);
  });

  it("rejects an empty config", () => {
    expect(ColumnConfigArraySchema.safeParse([]).success).toBe(false);
  });

  it("rejects duplicate keys", () => {
    const cols: ColumnConfig[] = [
      { key: "action", label: "Action", description: "" },
      { key: "action", label: "Action 2", description: "" },
    ];
    expect(ColumnConfigArraySchema.safeParse(cols).success).toBe(false);
  });

  it("rejects reserved system keys", () => {
    for (const reserved of ["timestamp", "screenshot"]) {
      const cols: ColumnConfig[] = [{ key: reserved, label: "X", description: "" }];
      expect(ColumnConfigArraySchema.safeParse(cols).success).toBe(false);
    }
  });

  it("rejects keys that are not safe identifiers", () => {
    const cols: ColumnConfig[] = [{ key: "has space", label: "X", description: "" }];
    expect(ColumnConfigArraySchema.safeParse(cols).success).toBe(false);
  });

  it("defaults a missing description to an empty string", () => {
    const parsed = ColumnConfigArraySchema.parse([{ key: "note", label: "Note" }]);
    expect(parsed[0].description).toBe("");
  });
});

describe("buildResponseSchema", () => {
  it("produces an array of objects with one property per column plus timestamp", () => {
    const schema = buildResponseSchema(DEFAULT_COLUMNS);
    expect(schema.type).toBe("array");
    if (schema.type !== "array" || schema.items.type !== "object") throw new Error("unexpected shape");

    const props = schema.items.properties;
    expect(Object.keys(props).sort()).toEqual(
      ["action", "description", "expectedResult", "timestamp"].sort(),
    );
    expect(props.action).toEqual({ type: "string", description: expect.any(String) });
  });

  it("marks every column key and timestamp as required", () => {
    const schema = buildResponseSchema(DEFAULT_COLUMNS);
    if (schema.type !== "array" || schema.items.type !== "object") throw new Error("unexpected shape");
    expect(schema.items.required).toContain("timestamp");
    expect(schema.items.required).toEqual(
      expect.arrayContaining(["action", "description", "expectedResult"]),
    );
  });

  it("extends to custom columns without code changes (Open/Closed)", () => {
    const custom: ColumnConfig[] = [
      { key: "action", label: "Action", description: "" },
      { key: "risk", label: "Risk Level", description: "How risky this step is." },
    ];
    const schema = buildResponseSchema(custom);
    if (schema.type !== "array" || schema.items.type !== "object") throw new Error("unexpected shape");
    expect(Object.keys(schema.items.properties)).toContain("risk");
  });
});
