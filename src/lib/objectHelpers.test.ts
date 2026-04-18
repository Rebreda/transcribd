import { describe, expect, test } from "vitest";
import {
  buildLocalFallbackMetadata,
  buildObjectFallbackTitle,
  buildObjectId,
  normalizeLiveRecordKey,
} from "./objectHelpers";

describe("buildObjectId", () => {
  test("starts with obj- prefix", () => {
    const id = buildObjectId(1_000_000);
    expect(id.startsWith("obj-1000000-")).toBe(true);
  });

  test("two calls with the same timestamp are unique", () => {
    const ms = 1_000_000;
    const a = buildObjectId(ms);
    const b = buildObjectId(ms);
    expect(a).not.toBe(b);
  });
});

describe("normalizeLiveRecordKey", () => {
  test("lowercases and collapses whitespace", () => {
    expect(normalizeLiveRecordKey("  Hello   World  ")).toBe("hello world");
  });

  test("handles already-normalised string", () => {
    expect(normalizeLiveRecordKey("hello world")).toBe("hello world");
  });

  test("returns empty string for blank input", () => {
    expect(normalizeLiveRecordKey("   ")).toBe("");
  });
});

describe("buildObjectFallbackTitle", () => {
  test("includes 'Live Capture'", () => {
    const title = buildObjectFallbackTitle(Date.now());
    expect(title.startsWith("Live Capture")).toBe(true);
  });
});

describe("buildLocalFallbackMetadata", () => {
  test("always includes capture category", () => {
    const meta = buildLocalFallbackMetadata("Just some speech.", Date.now());
    expect(meta.categories).toContain("capture");
  });

  test("adds question category for text containing '?'", () => {
    const meta = buildLocalFallbackMetadata("What time is the meeting?", Date.now());
    expect(meta.categories).toContain("question");
  });

  test("adds question category for 'what' prefix", () => {
    const meta = buildLocalFallbackMetadata("what are we building today", Date.now());
    expect(meta.categories).toContain("question");
  });

  test("adds action category for 'todo'", () => {
    const meta = buildLocalFallbackMetadata("todo: ship the release", Date.now());
    expect(meta.categories).toContain("action");
  });

  test("adds action category for 'follow up'", () => {
    const meta = buildLocalFallbackMetadata("We need to follow up on the PR.", Date.now());
    expect(meta.categories).toContain("action");
  });

  test("adds debug category for 'bug'", () => {
    const meta = buildLocalFallbackMetadata("There is a bug in the parser.", Date.now());
    expect(meta.categories).toContain("debug");
  });

  test("adds meeting category for 'standup'", () => {
    const meta = buildLocalFallbackMetadata("Let's start the standup.", Date.now());
    expect(meta.categories).toContain("meeting");
  });

  test("title says 'Question' when question detected", () => {
    const meta = buildLocalFallbackMetadata("Why is this failing?", 0);
    expect(meta.title.startsWith("Question")).toBe(true);
  });

  test("title says 'Action Item' when action detected (no question)", () => {
    const meta = buildLocalFallbackMetadata("Next step is to deploy.", 0);
    expect(meta.title.startsWith("Action Item")).toBe(true);
  });

  test("max 4 categories returned", () => {
    // triggers question + action + debug + meeting all at once
    const meta = buildLocalFallbackMetadata(
      "Why is the test bug in the meeting todo?",
      Date.now(),
    );
    expect(meta.categories.length).toBeLessThanOrEqual(4);
  });
});
