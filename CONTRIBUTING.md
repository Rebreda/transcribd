# Contributing to Transcribd

Thanks for contributing.

## Project Scope

Transcribd is a GNOME desktop recorder with local AI transcription support (OpenAI-compatible HTTP and realtime WebSocket flows).

Credit and continuity:
- This project is a fork of Vocalis: https://gitlab.gnome.org/World/vocalis
- Keep upstream attribution intact in docs and metadata.

## Development Setup

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for full setup and troubleshooting.

Fast path:

```bash
npm install
meson setup build -Dprofile=development
ninja -C build
GSETTINGS_SCHEMA_DIR=$PWD/build/data ninja -C build run
```

## Branch and PR Workflow

1. Create a topic branch from `main`.
2. Keep commits small and focused.
3. Run checks locally before opening a PR.
4. Open a PR with clear testing notes.

## Local Validation Checklist

Run these before submitting:

```bash
npm run typecheck
npm run lint
npm run test:local-api
ninja -C build
```

Manual smoke checks:
- App starts and records audio.
- Live transcription updates while recording.
- Existing clip transcription works from the recording row.
- No new warnings in terminal for the touched workflow.

## Commit Guidance

Recommended style:
- `feat: add X`
- `fix: handle Y`
- `docs: update Z`
- `refactor: simplify W`

Use imperative tense in the subject line and explain behavior changes in the body.

## Coding Conventions

- TypeScript with strict checks enabled.
- Preserve existing style in touched files.
- Avoid unrelated refactors in feature/fix PRs.
- Keep public behavior stable unless the PR is explicitly breaking.

## UI and UX Changes

For UI PRs, include:
- Before/after screenshots (or a short screen recording).
- Notes on keyboard navigation impact.
- Notes on strings that may require translation updates.

## Translation Notes

Strings are managed via gettext (`po/`).
If you add user-facing text, ensure it is translatable and can be extracted by existing tooling.

## Security and Privacy

Do not commit API keys, tokens, or private endpoint credentials.
Use local environment variables or preferences for developer-only values.

## Questions

- Open a GitHub issue for bugs/feature requests.
- For architecture context, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
