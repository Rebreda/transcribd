import { describe, expect, it } from "vitest";
import { MICROPHONE_TROUBLESHOOTING_STEPS, normalizeEndpointList } from "./settingsUploadUtils";

describe("normalizeEndpointList", () => {
  it("removes empty values and deduplicates while preserving order", () => {
    const endpoints = [
      "http://localhost:13305/api/v1/audio/transcriptions",
      "  ",
      "http://localhost:13305/api/v1/audio/transcriptions",
      "http://localhost:13305/api/v1/health",
      "http://localhost:13305/api/v1/health ",
    ];

    expect(normalizeEndpointList(endpoints)).toEqual([
      "http://localhost:13305/api/v1/audio/transcriptions",
      "http://localhost:13305/api/v1/health",
    ]);
  });

  it("returns an empty list when no valid endpoints are present", () => {
    expect(normalizeEndpointList(["", "   ", "\n\t"]))
      .toEqual([]);
  });
});

describe("MICROPHONE_TROUBLESHOOTING_STEPS", () => {
  it("includes actionable troubleshooting guidance", () => {
    expect(MICROPHONE_TROUBLESHOOTING_STEPS.length).toBeGreaterThanOrEqual(3);
    expect(MICROPHONE_TROUBLESHOOTING_STEPS[0]?.length ?? 0).toBeGreaterThan(0);
  });
});
