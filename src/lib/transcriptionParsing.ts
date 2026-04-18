/**
 * Pure transcription response parsing utilities.
 * Ported from the current GJS app to establish parity in Tauri.
 */
import { buildOpenAiEndpoint } from "./openaiCompat";

export const NON_SPEECH_TOKEN = /^\s*\[(?:blank_audio|silence|[a-z][a-z _-]{0,31})\]\s*$/i;

export interface TranscriptionSegmentResult {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptionSegmentResult[];
}

/**
 * Build the ordered list of transcription endpoint URLs using Lemonade's
 * OpenAI-compatible /api/v1 contract.
 */
export function buildTranscriptionEndpoints(baseUrl: string): string[] {
  return [buildOpenAiEndpoint(baseUrl, "audio/transcriptions")];
}

/**
 * Extract a normalized TranscriptionResult from a raw server response string.
 * Handles JSON ({text, transcript, output_text}) and plain-text fallback.
 * Filters [BLANK_AUDIO] / [silence] tokens.
 */
export function extractTranscriptionResult(payload: string): TranscriptionResult {
  const raw = payload.trim();
  if (raw.length === 0) {
    return { text: "", segments: [] };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const candidates: unknown[] = [parsed["text"], parsed["transcript"], parsed["output_text"]];
    const text = pickFirstText(candidates);
    const segments = extractSegments(parsed);
    if (text.length > 0) {
      return { text, segments };
    }
  } catch {
    if (!NON_SPEECH_TOKEN.test(raw)) {
      return { text: raw, segments: [] };
    }
  }

  return { text: "", segments: [] };
}

function pickFirstText(candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === "string") {
      const trimmed = c.trim();
      if (trimmed.length > 0 && !NON_SPEECH_TOKEN.test(trimmed)) {
        return trimmed;
      }
    }
  }
  return "";
}

function extractSegments(parsed: Record<string, unknown>): TranscriptionSegmentResult[] {
  const directWords = parseSegmentArray(parsed["words"]);
  if (directWords.length > 0) {
    return directWords;
  }

  const nestedWords = parseNestedWords(parsed["segments"]);
  if (nestedWords.length > 0) {
    return nestedWords;
  }

  const directSegments = parseSegmentArray(parsed["segments"]);
  if (directSegments.length > 0) {
    return directSegments;
  }

  return [];
}

function parseNestedWords(value: unknown): TranscriptionSegmentResult[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const words: TranscriptionSegmentResult[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    words.push(...parseSegmentArray(record["words"]));
  }

  return words;
}

function parseSegmentArray(value: unknown): TranscriptionSegmentResult[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const segments: TranscriptionSegmentResult[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const text = pickFirstText([record["word"], record["text"], record["token"]]);
    if (!text) {
      continue;
    }

    const start = readTimestamp(record, ["start_ms", "start", "t0", "from"]);
    const end = readTimestamp(record, ["end_ms", "end", "t1", "to"]);
    if (start === null || end === null || end < start) {
      continue;
    }

    segments.push({ startMs: start, endMs: end, text });
  }

  return segments;
}

function readTimestamp(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "number" || Number.isNaN(value)) {
      continue;
    }
    if (key.endsWith("_ms")) {
      return Math.round(value);
    }
    if (key === "t0" || key === "t1") {
      return Math.round(value * 10);
    }
    if (!Number.isInteger(value) || value <= 600) {
      return Math.round(value * 1000);
    }
    return Math.round(value);
  }
  return null;
}
