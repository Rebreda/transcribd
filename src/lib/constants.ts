// ── Audio pipeline ──────────────────────────────────────────────────────────
// Capture sample rate sent to the transcription server.
export const AUDIO_SAMPLE_RATE = 16000;
export const AUDIO_CHANNELS = 1;
// Minimum encoded PCM byte count before we treat a clip as non-trivial (~100 ms).
export const MIN_CLIP_BYTES = 3200;
// Pre-roll prepended to each clip so the first word is never clipped.
export const PRE_ROLL_MS = 1200;
// Hard ceiling on a single realtime clip before a forced commit.
export const MAX_CLIP_SECONDS = 90;

// ── Realtime VAD ────────────────────────────────────────────────────────────
// How often to force-commit a segment when VAD has been silent (ms).
export const FORCE_COMMIT_INTERVAL_MS = 4500;
// Minimum number of 100 ms audio chunks before a force-commit fires.
export const FORCE_COMMIT_MIN_CHUNKS = 20;

// ── Object pipeline ─────────────────────────────────────────────────────────
// Maximum transcript objects kept in memory and in localStorage.
export const MAX_TRANSCRIPT_OBJECTS = 240;
// Maximum live records shown in the UI at once.
export const MAX_REALTIME_DISPLAY = 120;
// Deduplication window: records within this span may be merged by text key.
export const DEDUP_WINDOW_MS = 12_000;

// ── LocalStorage keys ───────────────────────────────────────────────────────
export const STORAGE_KEY_NAV_COLLAPSED = "transcribd.navCollapsed";
export const STORAGE_KEY_TRANSCRIPT_OBJECTS = "vocalis.transcriptObjects.v1";

// ── Server / API defaults ───────────────────────────────────────────────────
export const DEFAULT_SERVER_BASE_URL = "http://localhost:13305/api/v1";
export const DEFAULT_WHISPER_MODEL = "Whisper-Base";
export const DEFAULT_LLM_MODEL = "Gemma-4-E4B-it-GGUF";

// ── LLM prompts ─────────────────────────────────────────────────────────────
export const LLM_CLASSIFY_SYSTEM_PROMPT =
  "You classify transcript clips. Return strict JSON with keys: title (string), notes (string), categories (array of 1-4 short lowercase tags).";
