import { describe, expect, it } from "vitest";
import { calculateRms, mergeTranscriptText, parseRealtimeFrame } from "./realtimeMessageUtils";

describe("mergeTranscriptText", () => {
  it("returns existing when next is blank", () => {
    expect(mergeTranscriptText("hello", "   ")).toBe("hello");
  });

  it("prefers longer replacing delta strings", () => {
    expect(mergeTranscriptText("hello", "hello world")).toBe("hello world");
  });

  it("avoids duplicate suffix append", () => {
    expect(mergeTranscriptText("hello world", "world")).toBe("hello world");
  });

  it("appends disjoint chunks", () => {
    expect(mergeTranscriptText("hello", "there")).toBe("hello there");
  });
});

describe("calculateRms", () => {
  it("returns zero for empty buffers", () => {
    expect(calculateRms(new Float32Array())).toBe(0);
  });

  it("calculates RMS for sample data", () => {
    const value = calculateRms(new Float32Array([1, -1, 1, -1]));
    expect(value).toBeCloseTo(1, 6);
  });
});

describe("parseRealtimeFrame", () => {
  it("parses plain JSON frame", () => {
    const parsed = parseRealtimeFrame('{"type":"event","delta":"hello"}');
    expect(parsed.type).toBe("event");
    expect(parsed.delta).toBe("hello");
  });

  it("parses SSE-style data frames", () => {
    const parsed = parseRealtimeFrame('data: {"type":"event","transcript":"hi"}\n\n');
    expect(parsed.type).toBe("event");
    expect(parsed.transcript).toBe("hi");
  });
});
