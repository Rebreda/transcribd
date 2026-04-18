import { describe, expect, it } from "vitest";
import {
  NON_SPEECH_TOKEN,
  buildTranscriptionEndpoints,
  extractTranscriptionResult,
} from "./transcriptionParsing";

describe("buildTranscriptionEndpoints", () => {
  it("deduplicates endpoints when base already includes api/v1", () => {
    const endpoints = buildTranscriptionEndpoints("http://localhost:13305/api/v1");
    expect(endpoints).toEqual(["http://localhost:13305/api/v1/audio/transcriptions"]);
  });

  it("normalizes plain host to /api/v1 endpoint", () => {
    const endpoints = buildTranscriptionEndpoints("http://localhost:13305");
    expect(endpoints).toEqual(["http://localhost:13305/api/v1/audio/transcriptions"]);
  });
});

describe("extractTranscriptionResult", () => {
  it("extracts text and segments from a JSON payload", () => {
    const payload = JSON.stringify({
      text: "hello world",
      segments: [
        { start: 0, end: 0.5, text: "hello" },
        { start: 0.5, end: 1.0, text: "world" },
      ],
    });

    const result = extractTranscriptionResult(payload);
    expect(result.text).toBe("hello world");
    expect(result.segments).toEqual([
      { startMs: 0, endMs: 500, text: "hello" },
      { startMs: 500, endMs: 1000, text: "world" },
    ]);
  });

  it("filters non-speech tokens", () => {
    expect(NON_SPEECH_TOKEN.test("[silence]")).toBe(true);
    expect(extractTranscriptionResult("[BLANK_AUDIO]")).toEqual({ text: "", segments: [] });
  });

  it("falls back to plain text", () => {
    const result = extractTranscriptionResult("spoken words");
    expect(result).toEqual({ text: "spoken words", segments: [] });
  });
});
