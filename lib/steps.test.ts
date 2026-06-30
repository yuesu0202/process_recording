import { describe, it, expect } from "vitest";
import { parseTimestampToSeconds, parseSteps, formatTimestamp, StepParseError } from "./steps";
import { DEFAULT_COLUMNS } from "./schema";

describe("formatTimestamp", () => {
  it("formats seconds as M:SS", () => {
    expect(formatTimestamp(5)).toBe("0:05");
    expect(formatTimestamp(90)).toBe("1:30");
  });

  it("formats long durations as H:MM:SS", () => {
    expect(formatTimestamp(3723)).toBe("1:02:03");
  });

  it("clamps negatives to 0:00 and floors fractions", () => {
    expect(formatTimestamp(-4)).toBe("0:00");
    expect(formatTimestamp(12.9)).toBe("0:12");
  });
});

describe("parseTimestampToSeconds", () => {
  it("parses MM:SS", () => {
    expect(parseTimestampToSeconds("01:30")).toBe(90);
    expect(parseTimestampToSeconds("00:05")).toBe(5);
  });

  it("parses HH:MM:SS", () => {
    expect(parseTimestampToSeconds("01:02:03")).toBe(3723);
  });

  it("parses bare numbers and numeric strings", () => {
    expect(parseTimestampToSeconds(12)).toBe(12);
    expect(parseTimestampToSeconds("12")).toBe(12);
    expect(parseTimestampToSeconds("12.5")).toBe(12.5);
  });

  it("returns null for unparseable or negative input", () => {
    expect(parseTimestampToSeconds("abc")).toBeNull();
    expect(parseTimestampToSeconds("")).toBeNull();
    expect(parseTimestampToSeconds(-3)).toBeNull();
    expect(parseTimestampToSeconds(null)).toBeNull();
    expect(parseTimestampToSeconds({})).toBeNull();
  });
});

describe("parseSteps", () => {
  const cols = DEFAULT_COLUMNS;

  it("parses a well-formed array into Step[]", () => {
    const raw = [
      { action: "Open page", description: "Click menu", expectedResult: "Page shown", timestamp: "00:10" },
      { action: "Submit", description: "Click submit", expectedResult: "Saved", timestamp: "00:20" },
    ];
    const steps = parseSteps(raw, cols);
    expect(steps).toHaveLength(2);
    expect(steps[0].fields.action).toBe("Open page");
    expect(steps[0].timestampSeconds).toBe(10);
    expect(steps[0].screenshotUrl).toBeNull();
    expect(steps[0].index).toBe(0);
  });

  it("defaults missing fields to empty string instead of crashing", () => {
    const raw = [{ action: "Only action", timestamp: "5" }];
    const steps = parseSteps(raw, cols);
    expect(steps[0].fields.description).toBe("");
    expect(steps[0].fields.expectedResult).toBe("");
  });

  it("sorts steps chronologically and re-indexes contiguously", () => {
    const raw = [
      { action: "second", timestamp: "00:20" },
      { action: "first", timestamp: "00:05" },
    ];
    const steps = parseSteps(raw, cols);
    expect(steps.map((s) => s.fields.action)).toEqual(["first", "second"]);
    expect(steps.map((s) => s.index)).toEqual([0, 1]);
  });

  it("skips rows without a usable timestamp but keeps the good ones", () => {
    const raw = [
      { action: "good", timestamp: "00:01" },
      { action: "bad", timestamp: "not-a-time" },
    ];
    const steps = parseSteps(raw, cols);
    expect(steps).toHaveLength(1);
    expect(steps[0].fields.action).toBe("good");
  });

  it("ignores unknown extra fields the model may add (Part 2 robustness)", () => {
    const raw = [{ action: "a", timestamp: "1", hallucinatedField: "ignore me" }];
    const steps = parseSteps(raw, cols);
    expect(steps[0].fields).not.toHaveProperty("hallucinatedField");
  });

  it("throws when the model returns a non-array", () => {
    expect(() => parseSteps({ not: "an array" }, cols)).toThrow(StepParseError);
  });

  it("throws when no step has a usable timestamp", () => {
    const raw = [{ action: "a", timestamp: "bad" }];
    expect(() => parseSteps(raw, cols)).toThrow(StepParseError);
  });
});
