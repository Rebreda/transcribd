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
    const wsUrl = `${wsProtocol}//${base.hostname}:${payload.websocket_port}/realtime?model=${encodeURIComponent(model || "Whisper-Base")}`;

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
  const candidates: unknown[] = [
    message.delta,
    message.transcript,
    message.item?.delta,
    message.item?.text,
    message.item?.transcript,
    message.data?.delta,
    message.data?.text,
    message.data?.transcript,
    ...(message.item?.content ?? []).flatMap(entry => [entry.delta, entry.text, entry.transcript]),
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
