import type { ClipMetadata } from "./appTypes";
import { buildOpenAiEndpoint } from "./openaiCompat";

export function buildChatEndpoints(baseUrl: string): string[] {
  return [buildOpenAiEndpoint(baseUrl, "chat/completions")];
}

export function tryParseMetadata(raw: string): ClipMetadata | null {
  const parsed = tryParseJson(raw);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const data = parsed as {
    title?: unknown;
    notes?: unknown;
    categories?: unknown;
  };

  const title = typeof data.title === "string" ? data.title.trim() : "";
  const notes = typeof data.notes === "string" ? data.notes.trim() : "";
  const categories = Array.isArray(data.categories)
    ? data.categories.filter((item): item is string => typeof item === "string").map(item => item.trim()).filter(Boolean)
    : [];

  if (title.length === 0) {
    return null;
  }

  return {
    title,
    notes: notes || "Auto-classified by LLM manager.",
    categories: categories.slice(0, 4),
  };
}

export function buildFallbackTitle(transcript: string): string {
  const clean = transcript.trim().replace(/\s+/g, " ");
  if (clean.length === 0) {
    return "Untitled Clip";
  }

  const title = clean.slice(0, 56).trim();
  return title.length < clean.length ? `${title}...` : title;
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}
