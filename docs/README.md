# Docs

This folder contains deeper documentation for how Transcribd works and how to contribute.

## Start Here

- [how-it-works.md](how-it-works.md): Product behavior and user-facing flows.
- [architecture.md](architecture.md): Code structure, data flow, and runtime model.
- [contributing.md](contributing.md): Day-to-day contribution guide.
- [build-and-release.md](build-and-release.md): Build, package, and release commands.

## Repo At A Glance

- Frontend: React + TypeScript + Vite (`src/`)
- Desktop shell/backend: Tauri v2 + Rust (`src-tauri/`)
- Scripts: debugging helpers (`scripts/`)
- Tests: Vitest for TypeScript modules in `src/lib/`

## Main Features

- Realtime microphone capture and transcription
- Upload transcription workflow
- Local manifest and transcript object persistence
- Optional LLM-based metadata enrichment
