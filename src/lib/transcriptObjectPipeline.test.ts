import { describe, expect, test } from "vitest";
import { createPendingTranscriptObject, mapTranscriptObjectToRealtimeRecord } from "./transcriptObjectPipeline";

describe("createPendingTranscriptObject", () => {
  test("creates a queued object with fallback metadata", () => {
    const object = createPendingTranscriptObject({
      id: "obj-1",
      source: "realtime",
      itemId: "item-1",
      transcript: "Discuss launch notes and blockers",
      startedAtMs: 100,
      endedAtMs: 200,
      createdAtMs: 300,
    });

    expect(object.id).toBe("obj-1");
    expect(object.inferenceState).toBe("pending");
    expect(object.fileState).toBe("pending");
    expect(object.title.length).toBeGreaterThan(0);
    expect(object.categories).toEqual(["capture"]);
  });
});

describe("mapTranscriptObjectToRealtimeRecord", () => {
  test("maps processing to pending for UI", () => {
    const record = mapTranscriptObjectToRealtimeRecord({
      id: "obj-2",
      source: "realtime",
      itemId: "",
      transcript: "hello",
      startedAtMs: 1,
      endedAtMs: 2,
      createdAtMs: 3,
      updatedAtMs: 4,
      title: "Hello",
      notes: "Working",
      categories: ["capture"],
      inferenceState: "processing",
      fileState: "pending",
      fileError: "",
      clipId: null,
      fileName: "",
      transcriptFileName: "",
      objectFileName: "",
    });

    expect(record.inferenceState).toBe("pending");
    expect(record.hasAudioFile).toBe(false);
  });

  test("maps ready+saved to from-clip", () => {
    const record = mapTranscriptObjectToRealtimeRecord({
      id: "obj-3",
      source: "realtime",
      itemId: "",
      transcript: "done",
      startedAtMs: 1,
      endedAtMs: 2,
      createdAtMs: 3,
      updatedAtMs: 4,
      title: "Done",
      notes: "Saved",
      categories: ["meeting"],
      inferenceState: "ready",
      fileState: "saved",
      fileError: "",
      clipId: "clip-1",
      fileName: "clip-1.wav",
      transcriptFileName: "obj-3.txt",
      objectFileName: "obj-3.json",
    });

    expect(record.inferenceState).toBe("from-clip");
    expect(record.hasAudioFile).toBe(true);
    expect(record.clipId).toBe("clip-1");
  });
});
