import type { RealtimeEndpointResult, RealtimeMessage } from "./appTypes";

export async function discoverRealtimeEndpoint(baseUrl: string, apiKey: string, model: string): Promise<RealtimeEndpointResult> {
  const root = baseUrl.replace(/\/+$/, "").replace(/\/(api\/)?v1$/i, "");
  const healthCandidates = [
    `${baseUrl.replace(/\/+$/, "")}/health`,
    `${root}/api/v1/health`,
    `${root}/v1/health`,
    `${root}/health`,
  ].filter((value, index, arr) => arr.indexOf(value) === index);

  const headers = new Headers();
  if (apiKey.length > 0) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }

  const attempts: string[] = [];

  for (const candidate of healthCandidates) {
    try {
      const response = await fetch(candidate, { headers });
      if (!response.ok) {
        attempts.push(`${response.status} ${candidate}`);
        continue;
      }

      const payload = (await response.json()) as { websocket_port?: number };
      if (typeof payload.websocket_port !== "number") {
        attempts.push(`No websocket_port in ${candidate}`);
        continue;
      }

      return {
        ok: true,
        url: `ws://127.0.0.1:${payload.websocket_port}/realtime?model=${encodeURIComponent(model || "Whisper-Base")}`,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      attempts.push(`ERR ${candidate}: ${detail}`);
    }
  }

  return {
    ok: false,
    error: `Failed to discover realtime endpoint: ${attempts.join(" | ")}`,
  };
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
