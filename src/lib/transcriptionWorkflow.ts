import { buildChatEndpoints, tryParseMetadata } from "./metadata";
import type { ClipMetadata } from "./appTypes";
import { extractTranscriptionResult } from "./transcriptionParsing";

export async function transcribePcmFallback(input: {
  pcmWavBytes: Uint8Array;
  model: string;
  apiKey: string;
  endpoints: string[];
}): Promise<string> {
  const { pcmWavBytes, model, apiKey, endpoints } = input;
  const wavBlob = new Blob([new Uint8Array(pcmWavBytes)], { type: "audio/wav" });

  const headers = new Headers();
  if (apiKey.trim().length > 0) {
    headers.set("Authorization", `Bearer ${apiKey.trim()}`);
  }

  for (const endpoint of endpoints) {
    const formData = new FormData();
    formData.append("model", model.trim());
    formData.append("file", wavBlob, "realtime-fallback.wav");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: formData,
      });
      const body = await response.text();
      if (!response.ok) {
        continue;
      }

      const parsed = extractTranscriptionResult(body);
      if (parsed.text.trim().length > 0) {
        return parsed.text.trim();
      }
    } catch {
      // Try next endpoint.
    }
  }

  return "";
}

export async function inferClipMetadataWithLlm(input: {
  transcript: string;
  titleFallback: string;
  llmModel: string;
  llmBaseUrl: string;
  llmApiKey: string;
}): Promise<ClipMetadata> {
  const { transcript, titleFallback, llmModel, llmBaseUrl, llmApiKey } = input;
  const requestBody = {
    model: llmModel.trim() || "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You classify transcript clips. Return strict JSON with keys: title (string), notes (string), categories (array of 1-4 short lowercase tags).",
      },
      {
        role: "user",
        content: `Transcript:\n${transcript}`,
      },
    ],
  };

  const headers = new Headers({ "Content-Type": "application/json" });
  if (llmApiKey.trim().length > 0) {
    headers.set("Authorization", `Bearer ${llmApiKey.trim()}`);
  }

  const chatEndpoints = buildChatEndpoints(llmBaseUrl.trim());
  for (const endpoint of chatEndpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) {
        continue;
      }

      const raw = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = raw.choices?.[0]?.message?.content ?? "";
      const parsed = tryParseMetadata(content);
      if (parsed) {
        return parsed;
      }
    } catch {
      // Try next endpoint.
    }
  }

  return {
    title: titleFallback,
    notes: "Auto-generated fallback metadata.",
    categories: ["capture"],
  };
}
