# Contributing

Thanks for contributing.

## Development Setup

1. Install system prerequisites for Tauri (see root README).
2. Install JS dependencies:

```bash
npm install
```

3. Run tests:

```bash
npm run test
```

4. Run desktop dev app:

```bash
npm run tauri:dev
```

## Daily Workflow

- Create a focused branch per change.
- Keep commits small and explain behavior changes.
- Add or update tests for deterministic logic in `src/lib/`.
- Validate with:

```bash
npm run test
npm run build
```

## Coding Guidelines

- TypeScript strictness: prefer explicit, narrow types over `any`.
- Keep UI components presentational where possible.
- Put parsing, normalization, and transformation logic in `src/lib/`.
- For async pipelines, avoid hidden race conditions; prefer serialized processing where order matters.

## Working On Realtime Features

- Treat network and transcription events as unreliable/partial.
- Handle duplicate and out-of-order events safely.
- Keep fallback behavior user-visible and non-blocking.

## Docs And UX Changes

- Update root README for any developer-command changes.
- Update docs in `docs/` when architecture or flow changes.
- Include short notes/screenshots in PRs for UI behavior changes when possible.

## Pull Request Checklist

- [ ] Tests pass (`npm run test`)
- [ ] Build passes (`npm run build`)
- [ ] New behavior documented
- [ ] No unrelated refactors mixed into the PR
