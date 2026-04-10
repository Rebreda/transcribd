# Architecture Overview

High-level map of Transcribd internals.

## Runtime Stack

- GNOME app runtime via GJS
- UI with Gtk4 + libadwaita
- Audio with GStreamer
- Networking with Soup3
- App settings and files via Gio/GLib
- Source language: TypeScript compiled to JS

## Core Modules

- `src/application.ts`
  - App bootstrap
  - Global actions, settings, startup lifecycle

- `src/window.ts`
  - Main window orchestration
  - Recorder/list/detail coordination
  - Signal wiring and persistence flow

- `src/recorder.ts` and `src/recorderWidget.ts`
  - Audio recording control and recorder UI

- `src/recording.ts`, `src/recordingList.ts`, `src/recordingListWidget.ts`, `src/row.ts`
  - Recording model, list model, list UI, row UI

- `src/detailView.ts`
  - Expanded recording details and playback interactions

- `src/transcriber.ts`
  - Realtime transcription session logic (WebSocket)

- `src/openaiClient.ts`
  - OpenAI-compatible HTTP client for file transcription

## Transcription Flows

### Live Recording (Realtime WS)

1. App discovers server/port (health endpoint flow when configured).
2. WebSocket session is established.
3. Audio chunks are streamed.
4. Delta/completed transcript events are parsed.
5. UI is updated and transcript persisted for the recording.

### Existing File Transcription (HTTP)

1. User triggers transcription from the recording row/detail UI.
2. File is uploaded as multipart/form-data to OpenAI-compatible endpoint.
3. Response text is extracted and normalized.
4. Transcript is stored on the corresponding recording model.

## Build and Resource Model

Meson composes final app resources from templates:
- `data/*.in*` for desktop/metainfo/gschema
- `data/*.gresource.xml` for UI assets
- `src/*.gresource.xml.in` for compiled JS modules

Profile option:
- `-Dprofile=development` appends `.Devel` to app ID and enables dev-target output names.

## Design Constraints

- Maintain compatibility with GNOME desktop expectations.
- Keep network integration tolerant of OpenAI-compatible endpoint differences.
- Avoid regressing transcription UX for both live and batch modes.
- Preserve translation friendliness for user-visible strings.

## Known Integration Hotspots

- App/resource ID and path consistency (`io.github.rebreda.Transcribd...`)
- GSettings schema generation and runtime lookup
- Meson template/file naming drift after rebranding
- Multipart payload compatibility with local STT backends
