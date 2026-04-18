import { describe, expect, it } from "vitest";
import { buildOpenAiEndpoint, normalizeOpenAiHttpBase } from "./openaiCompat";

describe("normalizeOpenAiHttpBase", () => {
  it("normalizes plain host to /api/v1", () => {
    expect(normalizeOpenAiHttpBase("http://localhost:13305")).toBe("http://localhost:13305/api/v1");
  });

  it("normalizes /v1 to /api/v1", () => {
    expect(normalizeOpenAiHttpBase("http://localhost:13305/v1")).toBe("http://localhost:13305/api/v1");
  });

  it("keeps /api/v1 unchanged", () => {
    expect(normalizeOpenAiHttpBase("http://localhost:13305/api/v1")).toBe("http://localhost:13305/api/v1");
  });
});

describe("buildOpenAiEndpoint", () => {
  it("builds endpoint paths consistently", () => {
    expect(buildOpenAiEndpoint("http://localhost:13305", "chat/completions")).toBe(
      "http://localhost:13305/api/v1/chat/completions",
    );
  });
});
