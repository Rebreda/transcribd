# How Transcribd Works

This document explains the app from a user and product behavior perspective.

## User Areas

The app has three primary pages:

- Home: live capture, clip browsing, and timeline playback
- Upload: file-based transcription requests
- Settings: API endpoints, model selection, microphone selection, and LLM options

Navigation is shown in a left sidebar and can be collapsed.

## Realtime Capture Flow

1. User enables always-on capture or starts realtime manually.
2. The app opens a websocket session to the configured realtime backend.
3. Microphone audio chunks are streamed to the backend.
4. Realtime events are received and shown in the live feed.
5. Finalized transcript segments are turned into local transcript objects.
6. Objects are enriched (optionally with LLM metadata) and persisted as clips.

If LLM metadata fails, the app falls back to local heuristics for title and categories.

## Upload Transcription Flow

1. User picks an audio file.
2. App tries configured transcription endpoints in order.
3. On first successful response, result text/json is parsed and displayed.
4. If all endpoints fail, status and error details are shown.

## Local Persistence

The app stores two related concepts:

- Clips (manifest): audio clip records for browsing and playback
- Transcript objects: processing metadata and state for live segments

Transcript objects are kept in browser localStorage for quick state recovery.
Clip files and manifest are persisted through Tauri commands on the desktop side.

## Metadata Enrichment

When enabled, transcript text is sent to a chat-compatible endpoint.
Expected response is strict JSON with:

- `title`: string
- `notes`: string
- `categories`: array of short lowercase tags

If parsing fails or endpoints fail, fallback metadata is used.

## Error Handling Philosophy

- Try multiple compatible endpoints when possible.
- Keep capture flow running even if one processing task fails.
- Prefer saving core clip data over blocking on metadata inference.
- Surface practical status messages in UI (`manifestStatus`, upload status, realtime error).
