import type { ClipMetadata } from "./appTypes";

/**
 * Generates a stable, human-readable object ID from a creation timestamp
 * plus a short random suffix to avoid collisions within the same millisecond.
 */
export function buildObjectId(createdAtMs: number): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `obj-${createdAtMs}-${random}`;
}

/**
 * Normalises a live record's transcript text into a deduplication key.
 * Strips leading/trailing whitespace and collapses internal runs of whitespace.
 */
export function normalizeLiveRecordKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Builds a neutral timestamp-based title used before LLM inference completes.
 */
export function buildObjectFallbackTitle(timestampMs: number): string {
  const time = new Date(timestampMs).toLocaleTimeString();
  return `Live Capture ${time}`;
}

/**
 * Derives lightweight heuristic metadata from the raw transcript text.
 * Used immediately after capture so the UI shows something useful while
 * the LLM inference request is in flight (or when LLM is disabled).
 */
export function buildLocalFallbackMetadata(transcript: string, timestampMs: number): ClipMetadata {
  const text = transcript.trim();
  const normalized = text.toLowerCase();

  const categories: string[] = ["capture"];

  if (normalized.includes("?") || normalized.startsWith("what") || normalized.startsWith("why")) {
    categories.push("question");
  }
  if (/(todo|follow up|follow-up|action|next step)/i.test(text)) {
    categories.push("action");
  }
  if (/(test|testing|debug|bug|issue|fix)/i.test(text)) {
    categories.push("debug");
  }
  if (/(meeting|standup|sync|roadmap|plan)/i.test(text)) {
    categories.push("meeting");
  }

  const uniqueCategories = Array.from(new Set(categories)).slice(0, 4);

  let title = buildObjectFallbackTitle(timestampMs);
  if (uniqueCategories.includes("question")) {
    title = `Question ${new Date(timestampMs).toLocaleTimeString()}`;
  } else if (uniqueCategories.includes("action")) {
    title = `Action Item ${new Date(timestampMs).toLocaleTimeString()}`;
  }

  return {
    title,
    notes: "Locally categorized while LLM metadata is unavailable.",
    categories: uniqueCategories,
  };
}
