import type { TranscriptObject } from "./appTypes";
import { MAX_TRANSCRIPT_OBJECTS, STORAGE_KEY_TRANSCRIPT_OBJECTS } from "./constants";

type StoredShape = {
  objects?: unknown;
};

export function loadTranscriptObjects(): TranscriptObject[] {
  if (!isBrowserStorageAvailable()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_TRANSCRIPT_OBJECTS);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as StoredShape;
    if (!Array.isArray(parsed.objects)) {
      return [];
    }

    const objects: TranscriptObject[] = [];
    for (const candidate of parsed.objects) {
      const normalized = normalizeTranscriptObject(candidate);
      if (normalized) {
        objects.push(normalized);
      }
    }

    return objects.sort((a, b) => b.updatedAtMs - a.updatedAtMs).slice(0, MAX_TRANSCRIPT_OBJECTS);
  } catch {
    return [];
  }
}

export function persistTranscriptObjects(objects: TranscriptObject[]): void {
  if (!isBrowserStorageAvailable()) {
    return;
  }

  const trimmed = [...objects]
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    .slice(0, MAX_TRANSCRIPT_OBJECTS);

  window.localStorage.setItem(STORAGE_KEY_TRANSCRIPT_OBJECTS, JSON.stringify({ objects: trimmed }));
}

function isBrowserStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeTranscriptObject(value: unknown): TranscriptObject | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Partial<TranscriptObject>;
  const id = typeof item.id === "string" ? item.id : "";
  const source = item.source === "upload" ? "upload" : "realtime";
  const transcript = typeof item.transcript === "string" ? item.transcript : "";

  if (id.length === 0 || transcript.trim().length === 0) {
    return null;
  }

  const itemId = typeof item.itemId === "string" ? item.itemId : "";
  const startedAtMs = typeof item.startedAtMs === "number" ? item.startedAtMs : Date.now();
  const endedAtMs = typeof item.endedAtMs === "number" ? item.endedAtMs : startedAtMs;
  const createdAtMs = typeof item.createdAtMs === "number" ? item.createdAtMs : startedAtMs;
  const updatedAtMs = typeof item.updatedAtMs === "number" ? item.updatedAtMs : createdAtMs;
  const title = typeof item.title === "string" ? item.title : "Untitled Clip";
  const notes = typeof item.notes === "string" ? item.notes : "";
  const categories = Array.isArray(item.categories)
    ? item.categories
        .filter((entry: unknown): entry is string => typeof entry === "string")
        .map((entry: string) => entry.trim())
        .filter((entry: string) => entry.length > 0)
    : [];

  const inferenceState =
    item.inferenceState === "processing" || item.inferenceState === "ready" || item.inferenceState === "error"
      ? item.inferenceState
      : "pending";

  const fileState =
    item.fileState === "saved" || item.fileState === "error" || item.fileState === "skipped"
      ? item.fileState
      : "pending";

  return {
    id,
    source,
    itemId,
    transcript,
    startedAtMs,
    endedAtMs,
    createdAtMs,
    updatedAtMs,
    title,
    notes,
    categories,
    inferenceState,
    fileState,
    fileError: typeof item.fileError === "string" ? item.fileError : "",
    clipId: typeof item.clipId === "string" ? item.clipId : null,
    fileName: typeof item.fileName === "string" ? item.fileName : "",
    transcriptFileName: typeof item.transcriptFileName === "string" ? item.transcriptFileName : "",
    objectFileName: typeof item.objectFileName === "string" ? item.objectFileName : "",
  };
}
