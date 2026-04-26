import { describe, expect, test } from "vitest";
import type { ManifestClip, RealtimeObjectRecord } from "./appTypes";
import {
  extractClipCategories,
  extractRecordCategories,
  filterAndSortClips,
  filterAndSortRecords,
  selectClip,
} from "./clipFinder";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeClip(overrides: Partial<ManifestClip> = {}): ManifestClip {
  return {
    id: "clip-1",
    fileName: "clip-1.wav",
    createdAtMs: 1000,
    startedAtMs: 1000,
    endedAtMs: 2000,
    durationMs: 1000,
    sampleRate: 16000,
    channels: 1,
    transcript: "hello world",
    title: "Hello World",
    notes: "some notes",
    categories: ["capture"],
    ...overrides,
  };
}

function makeRecord(overrides: Partial<RealtimeObjectRecord> = {}): RealtimeObjectRecord {
  return {
    id: "rec-1",
    itemId: "item-1",
    text: "hello world",
    updatedAtMs: 1000,
    title: "Hello World",
    notes: "some notes",
    categories: ["capture"],
    inferenceState: "ready",
    hasAudioFile: false,
    clipId: null,
    ...overrides,
  };
}

// ── filterAndSortClips ────────────────────────────────────────────────────────

describe("filterAndSortClips", () => {
  const clips = [
    makeClip({ id: "a", title: "Zebra", createdAtMs: 3000, categories: ["meeting"] }),
    makeClip({ id: "b", title: "Apple", createdAtMs: 1000, categories: ["debug"] }),
    makeClip({ id: "c", title: "Mango", createdAtMs: 2000, categories: ["capture"] }),
  ];

  test("returns all when no query and no category filter", () => {
    const result = filterAndSortClips({ clips, searchQuery: "", categoryFilter: "all", sortBy: "newest" });
    expect(result).toHaveLength(3);
  });

  test("filters by title text", () => {
    const result = filterAndSortClips({ clips, searchQuery: "apple", categoryFilter: "all", sortBy: "newest" });
    expect(result.map(c => c.id)).toEqual(["b"]);
  });

  test("filters by category", () => {
    const result = filterAndSortClips({ clips, searchQuery: "", categoryFilter: "debug", sortBy: "newest" });
    expect(result.map(c => c.id)).toEqual(["b"]);
  });

  test("sorts newest first", () => {
    const result = filterAndSortClips({ clips, searchQuery: "", categoryFilter: "all", sortBy: "newest" });
    expect(result.map(c => c.id)).toEqual(["a", "c", "b"]);
  });

  test("sorts oldest first", () => {
    const result = filterAndSortClips({ clips, searchQuery: "", categoryFilter: "all", sortBy: "oldest" });
    expect(result.map(c => c.id)).toEqual(["b", "c", "a"]);
  });

  test("sorts by title A-Z", () => {
    const result = filterAndSortClips({ clips, searchQuery: "", categoryFilter: "all", sortBy: "title" });
    expect(result.map(c => c.id)).toEqual(["b", "c", "a"]);
  });

  test("returns empty for no matches", () => {
    const result = filterAndSortClips({ clips, searchQuery: "xyz", categoryFilter: "all", sortBy: "newest" });
    expect(result).toHaveLength(0);
  });
});

// ── filterAndSortRecords ──────────────────────────────────────────────────────

describe("filterAndSortRecords", () => {
  const records = [
    makeRecord({ id: "a", title: "Zebra", updatedAtMs: 3000, categories: ["meeting"], text: "standup sync" }),
    makeRecord({ id: "b", title: "Apple", updatedAtMs: 1000, categories: ["debug"], text: "fix bug" }),
    makeRecord({ id: "c", title: "Mango", updatedAtMs: 2000, categories: ["capture"], text: "capture audio" }),
  ];

  test("returns all when no query and no category filter", () => {
    const result = filterAndSortRecords({ records, searchQuery: "", categoryFilter: "all", sortBy: "newest" });
    expect(result).toHaveLength(3);
  });

  test("filters by title text (case-insensitive)", () => {
    const result = filterAndSortRecords({ records, searchQuery: "APPLE", categoryFilter: "all", sortBy: "newest" });
    expect(result.map(r => r.id)).toEqual(["b"]);
  });

  test("filters by transcript text", () => {
    const result = filterAndSortRecords({ records, searchQuery: "bug", categoryFilter: "all", sortBy: "newest" });
    expect(result.map(r => r.id)).toEqual(["b"]);
  });

  test("filters by notes text", () => {
    const recs = [
      makeRecord({ id: "x", notes: "important action item", categories: ["capture"] }),
      makeRecord({ id: "y", notes: "unrelated note", categories: ["capture"] }),
    ];
    const result = filterAndSortRecords({ records: recs, searchQuery: "action", categoryFilter: "all", sortBy: "newest" });
    expect(result.map(r => r.id)).toEqual(["x"]);
  });

  test("filters by category text embedded in search", () => {
    const result = filterAndSortRecords({ records, searchQuery: "meeting", categoryFilter: "all", sortBy: "newest" });
    expect(result.map(r => r.id)).toEqual(["a"]);
  });

  test("filters by category dropdown", () => {
    const result = filterAndSortRecords({ records, searchQuery: "", categoryFilter: "debug", sortBy: "newest" });
    expect(result.map(r => r.id)).toEqual(["b"]);
  });

  test("category filter + text search are ANDed", () => {
    const result = filterAndSortRecords({ records, searchQuery: "capture", categoryFilter: "capture", sortBy: "newest" });
    expect(result.map(r => r.id)).toEqual(["c"]);
  });

  test("category filter excludes non-matching", () => {
    const result = filterAndSortRecords({ records, searchQuery: "", categoryFilter: "debug", sortBy: "newest" });
    expect(result.every(r => r.categories.includes("debug"))).toBe(true);
  });

  test("sorts newest first by updatedAtMs", () => {
    const result = filterAndSortRecords({ records, searchQuery: "", categoryFilter: "all", sortBy: "newest" });
    expect(result.map(r => r.id)).toEqual(["a", "c", "b"]);
  });

  test("sorts oldest first by updatedAtMs", () => {
    const result = filterAndSortRecords({ records, searchQuery: "", categoryFilter: "all", sortBy: "oldest" });
    expect(result.map(r => r.id)).toEqual(["b", "c", "a"]);
  });

  test("sorts by title A-Z", () => {
    const result = filterAndSortRecords({ records, searchQuery: "", categoryFilter: "all", sortBy: "title" });
    expect(result.map(r => r.id)).toEqual(["b", "c", "a"]);
  });

  test("returns empty for no matches", () => {
    const result = filterAndSortRecords({ records, searchQuery: "zzznomatch", categoryFilter: "all", sortBy: "newest" });
    expect(result).toHaveLength(0);
  });

  test("handles empty records list", () => {
    const result = filterAndSortRecords({ records: [], searchQuery: "hello", categoryFilter: "all", sortBy: "newest" });
    expect(result).toHaveLength(0);
  });

  test("suppresses no-audio style records by default", () => {
    const recs = [
      makeRecord({ id: "ok", title: "Meaningful clip", categories: ["capture"] }),
      makeRecord({ id: "silence", title: "No Audio Content", categories: ["silence"] }),
    ];
    const result = filterAndSortRecords({ records: recs, searchQuery: "", categoryFilter: "all", sortBy: "newest" });
    expect(result.map(r => r.id)).toEqual(["ok"]);
  });

  test("includeSuppressed keeps no-audio records", () => {
    const recs = [
      makeRecord({ id: "ok", title: "Meaningful clip", categories: ["capture"] }),
      makeRecord({ id: "silence", title: "No Audio Content", categories: ["silence"] }),
    ];
    const result = filterAndSortRecords({
      records: recs,
      searchQuery: "",
      categoryFilter: "all",
      sortBy: "newest",
      includeSuppressed: true,
    });
    expect(result).toHaveLength(2);
  });
});

// ── extractClipCategories ─────────────────────────────────────────────────────

describe("extractClipCategories", () => {
  test("returns sorted unique categories", () => {
    const clips = [
      makeClip({ categories: ["meeting", "capture"] }),
      makeClip({ id: "b", categories: ["debug", "capture"] }),
    ];
    expect(extractClipCategories(clips)).toEqual(["capture", "debug", "meeting"]);
  });

  test("returns empty for no clips", () => {
    expect(extractClipCategories([])).toEqual([]);
  });

  test("ignores blank/whitespace categories", () => {
    const clips = [makeClip({ categories: ["  ", "capture", ""] })];
    expect(extractClipCategories(clips)).toEqual(["capture"]);
  });
});

// ── extractRecordCategories ───────────────────────────────────────────────────

describe("extractRecordCategories", () => {
  test("returns sorted unique categories", () => {
    const records = [
      makeRecord({ categories: ["meeting", "capture"] }),
      makeRecord({ id: "b", categories: ["debug", "capture"] }),
    ];
    expect(extractRecordCategories(records)).toEqual(["capture", "debug", "meeting"]);
  });

  test("returns empty for no records", () => {
    expect(extractRecordCategories([])).toEqual([]);
  });

  test("ignores blank/whitespace categories", () => {
    const records = [makeRecord({ categories: ["  ", "capture", ""] })];
    expect(extractRecordCategories(records)).toEqual(["capture"]);
  });
});

// ── selectClip ────────────────────────────────────────────────────────────────

describe("selectClip", () => {
  test("returns null for empty list", () => {
    expect(selectClip([], "clip-1")).toBeNull();
  });

  test("returns matching clip by id", () => {
    const clips = [makeClip({ id: "a" }), makeClip({ id: "b" })];
    expect(selectClip(clips, "b")?.id).toBe("b");
  });

  test("falls back to first clip when id not found", () => {
    const clips = [makeClip({ id: "a" }), makeClip({ id: "b" })];
    expect(selectClip(clips, "missing")?.id).toBe("a");
  });
});
