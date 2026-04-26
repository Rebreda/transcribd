import { z } from "zod";
import {
  DEFAULT_LLM_RESPONSE_FORMAT,
  DEFAULT_LLM_TEMPERATURE,
  DEFAULT_REALTIME_PREFIX_PADDING_MS,
  DEFAULT_REALTIME_SILENCE_DURATION_MS,
  DEFAULT_REALTIME_TURN_DETECTION_TYPE,
  DEFAULT_REALTIME_VAD_THRESHOLD,
  DEFAULT_TRANSCRIPTION_RESPONSE_FORMAT,
  DEFAULT_TRANSCRIPTION_TEMPERATURE,
  LLM_CLASSIFY_SYSTEM_PROMPT,
} from "./constants";

export const realtimeSessionOptionsSchema = z.object({
  turnDetectionType: z.enum(["server_vad", "none"]).default(DEFAULT_REALTIME_TURN_DETECTION_TYPE),
  vadThreshold: z.coerce.number().min(0).max(1).default(DEFAULT_REALTIME_VAD_THRESHOLD),
  silenceDurationMs: z.coerce.number().int().min(200).max(10_000).default(DEFAULT_REALTIME_SILENCE_DURATION_MS),
  prefixPaddingMs: z.coerce.number().int().min(0).max(5_000).default(DEFAULT_REALTIME_PREFIX_PADDING_MS),
});

export const transcriptionRequestOptionsSchema = z.object({
  language: z.string().trim().max(24).default(""),
  prompt: z.string().trim().max(2_000).default(""),
  responseFormat: z.enum(["json", "verbose_json", "text"]).default(DEFAULT_TRANSCRIPTION_RESPONSE_FORMAT),
  temperature: z.coerce.number().min(0).max(1).default(DEFAULT_TRANSCRIPTION_TEMPERATURE),
});

export const llmInferenceOptionsSchema = z.object({
  temperature: z.coerce.number().min(0).max(2).default(DEFAULT_LLM_TEMPERATURE),
  responseFormat: z.enum(["json_object", "text"]).default(DEFAULT_LLM_RESPONSE_FORMAT),
  systemPrompt: z.string().trim().min(1).max(2_000).default(LLM_CLASSIFY_SYSTEM_PROMPT),
});

export type RealtimeSessionOptions = z.infer<typeof realtimeSessionOptionsSchema>;
export type TranscriptionRequestOptions = z.infer<typeof transcriptionRequestOptionsSchema>;
export type LlmInferenceOptions = z.infer<typeof llmInferenceOptionsSchema>;

export function parseRealtimeSessionOptions(value: unknown): RealtimeSessionOptions {
  const parsed = realtimeSessionOptionsSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  return realtimeSessionOptionsSchema.parse({});
}

export function parseTranscriptionRequestOptions(value: unknown): TranscriptionRequestOptions {
  const parsed = transcriptionRequestOptionsSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  return transcriptionRequestOptionsSchema.parse({});
}

export function parseLlmInferenceOptions(value: unknown): LlmInferenceOptions {
  const parsed = llmInferenceOptionsSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  return llmInferenceOptionsSchema.parse({});
}
