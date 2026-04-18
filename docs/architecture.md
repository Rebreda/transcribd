# Architecture

This project is a Tauri desktop app with a React/TypeScript frontend.

## High-Level Layers

- UI Layer (`src/components/`): page-level and panel components
- App State/Orchestration (`src/App.tsx`): top-level state, workflows, and page routing
- Domain Utilities (`src/lib/`): parsing, metadata helpers, storage adapters, queueing
- Hooks (`src/hooks/`): realtime capture and timeline playback logic
- Desktop Backend (`src-tauri/src/main.rs`): file persistence and native bridge commands

## Frontend Structure

- `src/App.tsx`
  - Owns cross-page state and workflow orchestration
  - Connects settings context, realtime capture, storage, and page rendering
- `src/context/AppConfigContext.tsx`
  - Stores app config values (base URLs, keys, models, flags, selected mic)
- `src/components/HomePage.tsx`
  - Live capture status, clip list, waveform/timeline, realtime records
- `src/components/UploadPage.tsx`
  - File picker and transcription request/response surface
- `src/components/SettingsPage.tsx`
  - Config management and device/permission actions

## Realtime Data Path

1. `useRealtimeCapture` opens websocket and streams audio chunks.
2. Realtime events are normalized into UI records.
3. Final transcript segments are converted into `TranscriptObject` entries.
4. `SerialTaskQueue` ensures object processing runs in order.
5. Processed results are persisted through `persistClipSafe` (Tauri invoke).

## Persistence Model

- `manifestStore.ts`
  - Loads and persists clip manifest through the Tauri command layer
- `transcriptObjectStore.ts`
  - Saves/restores transcript processing records from localStorage
- Rust side writes audio files and associated transcript/object files under app data directory

## Endpoint Compatibility

The app intentionally supports multiple endpoint shapes:

- Transcription endpoint candidates from base URL (`transcriptionParsing.ts`)
- Chat endpoint candidates from base URL (`metadata.ts` and helpers)

This allows use with different OpenAI-compatible services.

## Testing

Unit tests are focused on deterministic library logic (`src/lib/*.test.ts`), including:

- transcription parsing
- OpenAI compatibility helpers
- serial queue behavior
- transcript object mapping helpers
