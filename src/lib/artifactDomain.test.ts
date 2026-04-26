import { describe, expect, it } from "vitest";
import type { Artifact, ManifestClip, RealtimeTranscriptRecord } from "./appTypes";
import {
  buildArtifactExportJson,
  buildClipByTranscriptMap,
  buildRealtimeArtifacts,
  buildWaveformBars,
  mapClipToArtifact,
  mergeArtifacts,
  normalizeTranscriptKey,
} from "./artifactDomain";

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
    notes: "notes",
    categories: ["capture"],
    ...overrides,
  };
}

function makeRealtimeRecord(overrides: Partial<RealtimeTranscriptRecord> = {}): RealtimeTranscriptRecord {
  return {
    id: "rec-1",
    itemId: "item-1",
    text: "hello world",
    isFinal: true,
    updatedAtMs: 3000,
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "a-1",
    source: "realtime",
    text: "hello world",
    title: "Hello",
    notes: "note",
    categories: ["capture"],
    createdAtMs: 1000,
    updatedAtMs: 2000,
    inferenceState: "ready",
    hasAudioFile: false,
    clipId: null,
    fileName: "",
    itemId: "",
    startedAtMs: 1000,
    endedAtMs: 2000,
    durationMs: 1000,
    ...overrides,
  };
}

describe("normalizeTranscriptKey", () => {
  it("trims, lowercases, and collapses whitespace", () => {
    expect(normalizeTranscriptKey("  Hello   World ")).toBe("hello world");
  });
});

describe("mapClipToArtifact", () => {
  it("maps persisted clip fields to artifact fields", () => {
    const clip = makeClip({ id: "abc", endedAtMs: 3333 });
    const artifact = mapClipToArtifact(clip);
    expect(artifact.id).toBe("clip-abc");
    expect(artifact.source).toBe("clip");
    expect(artifact.updatedAtMs).toBe(3333);
    expect(artifact.hasAudioFile).toBe(true);
  });
});

describe("buildClipByTranscriptMap", () => {
  it("keeps first clip for duplicate normalized transcript", () => {
    const first = makeClip({ id: "first", transcript: "Hello   world" });
    const second = makeClip({ id: "second", transcript: "hello world" });
    const map = buildClipByTranscriptMap([first, second]);
    expect(map.get("hello world")?.id).toBe("first");
  });
});

describe("buildRealtimeArtifacts", () => {
  it("converts matched realtime record into clip artifact", () => {
    const clip = makeClip({ id: "stored" });
    const record = makeRealtimeRecord({ text: "hello world" });
    const artifacts = buildRealtimeArtifacts({
      realtimeRecords: [record],
      clipByTranscript: new Map([["hello world", clip]]),
      metadataByRecordId: {},
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.source).toBe("clip");
    expect(artifacts[0]?.clipId).toBe("stored");
  });

  it("falls back to realtime artifact when no clip match exists", () => {
    const record = makeRealtimeRecord({ id: "r-2", text: "different text" });
    const artifacts = buildRealtimeArtifacts({
      realtimeRecords: [record],
      clipByTranscript: new Map(),
      metadataByRecordId: {
        "r-2": {
          title: "Realtime Title",
          notes: "Realtime Notes",
          categories: ["meeting"],
          inferenceState: "ready",
        },
      },
    });

    expect(artifacts[0]?.source).toBe("realtime");
    expect(artifacts[0]?.title).toBe("Realtime Title");
    expect(artifacts[0]?.categories).toEqual(["meeting"]);
  });
});

describe("buildWaveformBars", () => {
  it("returns deterministic bars for a selected id", () => {
    const a = buildWaveformBars("abc", 8);
    const b = buildWaveformBars("abc", 8);
    expect(a).toEqual(b);
    expect(a).toHaveLength(8);
  });

  it("returns empty bars when no id is selected", () => {
    expect(buildWaveformBars(null)).toEqual([]);
  });
});

describe("mergeArtifacts", () => {
  it("prefers audio-backed artifact over non-audio duplicate key", () => {
    const nonAudio = makeArtifact({ id: "r1", text: "clip:clip-1", hasAudioFile: false, updatedAtMs: 3000 });
    const audio = makeArtifact({
      id: "clip-1",
      source: "clip",
      text: "different text",
      hasAudioFile: true,
      clipId: "clip-1",
      fileName: "clip.wav",
      updatedAtMs: 1000,
    });

    const merged = mergeArtifacts([nonAudio, audio]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.hasAudioFile).toBe(true);
  });

  it("keeps latest updated artifact when same type", () => {
    const older = makeArtifact({ id: "x-1", text: "same", updatedAtMs: 1000 });
    const newer = makeArtifact({ id: "x-2", text: "same", updatedAtMs: 4000 });
    const merged = mergeArtifacts([older, newer]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("x-2");
  });
});

describe("buildArtifactExportJson", () => {
  it("builds a stable export envelope", () => {
    const json = buildArtifactExportJson([makeArtifact({ id: "a" })], 1234);
    const parsed = JSON.parse(json) as { exportedAtMs: number; count: number; clips: Array<{ id: string }> };
    expect(parsed.exportedAtMs).toBe(1234);
    expect(parsed.count).toBe(1);
    expect(parsed.clips[0]?.id).toBe("a");
  });
});
