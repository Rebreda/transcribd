import type { RealtimeEndpointResult, RealtimeMessage } from "./appTypes";
import { buildOpenAiEndpoint, normalizeOpenAiHttpBase } from "./openaiCompat";

export async function discoverRealtimeEndpoint(baseUrl: string, apiKey: string, model: string): Promise<RealtimeEndpointResult> {
  const healthUrl = buildOpenAiEndpoint(baseUrl, "health");
  const httpBase = normalizeOpenAiHttpBase(baseUrl);
  const base = new URL(httpBase);

  const headers = new Headers();
  if (apiKey.length > 0) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }

  try {
    const response = await fetch(healthUrl, { headers });
    if (!response.ok) {
      return {
        ok: false,
        error: `Health check failed (${response.status}) at ${healthUrl}`,
      };
    }

    const payload = (await response.json()) as { websocket_port?: number };
    if (typeof payload.websocket_port !== "number") {
      return {
        ok: false,
        error: `Health response missing websocket_port at ${healthUrl}`,
      };
    }

    const wsProtocol = base.protocol === "https:" ? "wss:" : "ws:";
    const query = new URLSearchParams({ model: model || "Whisper-Base" });
    if (apiKey.length > 0) {
      query.set("api_key", apiKey);
    }
    const wsUrl = `${wsProtocol}//${base.hostname}:${payload.websocket_port}/realtime?${query.toString()}`;

    return {
      ok: true,
      url: wsUrl,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `Failed to discover realtime endpoint via ${healthUrl}: ${detail}`,
    };
  }
}

export function extractRealtimeText(message: RealtimeMessage): string {
  const asRecord = message as Record<string, unknown>;
  const response = asRecord["response"] as Record<string, unknown> | undefined;
  const output = Array.isArray(response?.["output"]) ? response?.["output"] as Array<Record<string, unknown>> : [];
  const outputContents = output.flatMap(entry => {
    const content = entry["content"];
    return Array.isArray(content) ? content as Array<Record<string, unknown>> : [];
  });

  const candidates: unknown[] = [
    message.delta,
    message.transcript,
    asRecord["text"],
    asRecord["output_text"],
    message.item?.delta,
    message.item?.text,
    message.item?.transcript,
    message.data?.delta,
    message.data?.text,
    message.data?.transcript,
    ...(message.item?.content ?? []).flatMap(entry => [entry.delta, entry.text, entry.transcript]),
    ...outputContents.flatMap(entry => [entry["text"], entry["transcript"], entry["delta"]]),
    ...collectNestedTextCandidates(message),
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return "";
}

function collectNestedTextCandidates(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null || typeof value !== "object") {
    return [];
  }

  const keysOfInterest = new Set(["text", "transcript", "delta", "output_text", "content"]);
  const candidates: string[] = [];

  if (Array.isArray(value)) {
    for (const item of value) {
      candidates.push(...collectNestedTextCandidates(item, depth + 1));
    }
    return candidates;
  }

  const record = value as Record<string, unknown>;
  for (const [key, nestedValue] of Object.entries(record)) {
    if (typeof nestedValue === "string" && keysOfInterest.has(key)) {
      const trimmed = nestedValue.trim();
      if (trimmed.length > 0) {
        candidates.push(trimmed);
      }
      continue;
    }

    if (typeof nestedValue === "object" && nestedValue !== null) {
      candidates.push(...collectNestedTextCandidates(nestedValue, depth + 1));
    }
  }

  return candidates;
}
