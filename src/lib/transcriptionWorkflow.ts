import { buildChatEndpoints, tryParseMetadata } from "./metadata";
import type { ClipMetadata } from "./appTypes";
import { extractTranscriptionResult } from "./transcriptionParsing";
import {
  parseLlmInferenceOptions,
  parseTranscriptionRequestOptions,
  type LlmInferenceOptions,
  type TranscriptionRequestOptions,
} from "./apiSchemas";

export async function transcribePcmFallback(input: {
  pcmWavBytes: Uint8Array;
  model: string;
  apiKey: string;
  endpoints: string[];
  options?: TranscriptionRequestOptions;
}): Promise<string> {
  const { pcmWavBytes, model, apiKey, endpoints, options } = input;
  const resolvedOptions = parseTranscriptionRequestOptions(options ?? {});
  const wavBlob = new Blob([new Uint8Array(pcmWavBytes)], { type: "audio/wav" });

  const headers = new Headers();
  if (apiKey.trim().length > 0) {
    headers.set("Authorization", `Bearer ${apiKey.trim()}`);
  }

  for (const endpoint of endpoints) {
    const formData = new FormData();
    formData.append("model", model.trim());
    formData.append("file", wavBlob, "realtime-fallback.wav");
    if (resolvedOptions.language.length > 0) {
      formData.append("language", resolvedOptions.language);
    }
    if (resolvedOptions.prompt.length > 0) {
      formData.append("prompt", resolvedOptions.prompt);
    }
    formData.append("response_format", resolvedOptions.responseFormat);
    formData.append("temperature", String(resolvedOptions.temperature));

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
  llmOptions?: LlmInferenceOptions;
}): Promise<ClipMetadata> {
  const { transcript, titleFallback, llmModel, llmBaseUrl, llmApiKey, llmOptions } = input;
  const resolvedLlmOptions = parseLlmInferenceOptions(llmOptions ?? {});
  const requestBody = {
    model: llmModel.trim() || "gpt-4o-mini",
    temperature: resolvedLlmOptions.temperature,
    response_format: { type: resolvedLlmOptions.responseFormat },
    messages: [
      {
        role: "system",
        content: resolvedLlmOptions.systemPrompt,
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
