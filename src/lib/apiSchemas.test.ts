import { describe, expect, it } from "vitest";
import {
  parseLlmInferenceOptions,
  parseRealtimeSessionOptions,
  parseTranscriptionRequestOptions,
} from "./apiSchemas";

describe("parseRealtimeSessionOptions", () => {
  it("uses defaults for invalid payload", () => {
    const parsed = parseRealtimeSessionOptions({ vadThreshold: 99 });
    expect(parsed.turnDetectionType).toBe("server_vad");
    expect(parsed.vadThreshold).toBe(0.05);
  });

  it("accepts valid values", () => {
    const parsed = parseRealtimeSessionOptions({
      turnDetectionType: "none",
      vadThreshold: 0.3,
      silenceDurationMs: 900,
      prefixPaddingMs: 120,
    });
    expect(parsed.turnDetectionType).toBe("none");
    expect(parsed.vadThreshold).toBe(0.3);
    expect(parsed.silenceDurationMs).toBe(900);
    expect(parsed.prefixPaddingMs).toBe(120);
  });
});

describe("parseTranscriptionRequestOptions", () => {
  it("falls back to defaults when invalid", () => {
    const parsed = parseTranscriptionRequestOptions({ temperature: -3 });
    expect(parsed.temperature).toBe(0);
    expect(parsed.responseFormat).toBe("verbose_json");
  });

  it("keeps valid options", () => {
    const parsed = parseTranscriptionRequestOptions({
      language: "en",
      prompt: "focus on technical terms",
      responseFormat: "json",
      temperature: 0.4,
    });
    expect(parsed.language).toBe("en");
    expect(parsed.prompt).toContain("technical");
    expect(parsed.responseFormat).toBe("json");
    expect(parsed.temperature).toBe(0.4);
  });
});

describe("parseLlmInferenceOptions", () => {
  it("falls back to defaults when invalid", () => {
    const parsed = parseLlmInferenceOptions({ responseFormat: "bad" });
    expect(parsed.responseFormat).toBe("json_object");
    expect(parsed.temperature).toBe(0.2);
  });

  it("keeps valid options", () => {
    const parsed = parseLlmInferenceOptions({
      responseFormat: "text",
      temperature: 0.8,
      systemPrompt: "Return title and categories only.",
    });
    expect(parsed.responseFormat).toBe("text");
    expect(parsed.temperature).toBe(0.8);
    expect(parsed.systemPrompt).toContain("title");
  });
});
