import type { RealtimeObjectRecord, TranscriptObject } from "./appTypes";
import { buildFallbackTitle } from "./metadata";

export function createPendingTranscriptObject(input: {
  id: string;
  source: "realtime" | "upload";
  itemId: string;
  transcript: string;
  startedAtMs: number;
  endedAtMs: number;
  createdAtMs: number;
}): TranscriptObject {
  const title = buildFallbackTitle(input.transcript);

  return {
    id: input.id,
    source: input.source,
    itemId: input.itemId,
    transcript: input.transcript,
    startedAtMs: input.startedAtMs,
    endedAtMs: input.endedAtMs,
    createdAtMs: input.createdAtMs,
    updatedAtMs: input.createdAtMs,
    title,
    notes: "Queued for classification and persistence.",
    categories: ["capture"],
    inferenceState: "pending",
    fileState: "pending",
    fileError: "",
    clipId: null,
    fileName: "",
    transcriptFileName: "",
    objectFileName: "",
  };
}

export function mapTranscriptObjectToRealtimeRecord(object: TranscriptObject): RealtimeObjectRecord {
  return {
    id: object.id,
    itemId: object.itemId,
    text: object.transcript,
    updatedAtMs: object.updatedAtMs,
    title: object.title,
    notes: object.notes,
    categories: object.categories,
    inferenceState:
      object.inferenceState === "processing"
        ? "pending"
        : object.inferenceState === "ready" && object.fileState === "saved"
          ? "from-clip"
          : object.inferenceState,
    hasAudioFile: object.fileState === "saved",
    clipId: object.clipId,
  };
}
