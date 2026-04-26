import type { RealtimeMessage } from "./appTypes";

export function mergeTranscriptText(existing: string, nextChunk: string): string {
  const trimmedNext = nextChunk.trim();
  if (trimmedNext.length === 0) {
    return existing.trim();
  }

  const trimmedExisting = existing.trim();
  if (trimmedExisting.length === 0) {
    return trimmedNext;
  }

  if (trimmedNext === trimmedExisting || trimmedNext.startsWith(trimmedExisting)) {
    return trimmedNext;
  }

  if (trimmedExisting.endsWith(trimmedNext)) {
    return trimmedExisting;
  }

  return `${trimmedExisting} ${trimmedNext}`;
}

export function calculateRms(buffer: Float32Array): number {
  if (buffer.length === 0) {
    return 0;
  }

  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const sample = buffer[i] ?? 0;
    sum += sample * sample;
  }

  return Math.sqrt(sum / buffer.length);
}

export function parseRealtimeFrame(raw: string): RealtimeMessage {
  const trimmed = raw.trim();
  if (trimmed.startsWith("data:")) {
    const dataPayload = trimmed
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trim())
      .join("\n");
    return JSON.parse(dataPayload) as RealtimeMessage;
  }

  return JSON.parse(trimmed) as RealtimeMessage;
}
