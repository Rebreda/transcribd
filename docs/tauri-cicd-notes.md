# Tauri CI/CD Notes

This document captures practical CI/CD patterns to apply in this repository now and later.

## Current Policy

- Validation CI runs on every push and pull request.
- Release publishing is intentionally separate and should only be added after validation remains stable.
- Local pre-bundle validation remains: `npm run test` then `npm run build`.

## Baseline Workflow

Validation workflow path:

- `.github/workflows/ci-validate.yml`

Checks performed:

1. Install dependencies (`npm ci`)
2. Run tests (`npm run test`)
3. Run typecheck + build (`npm run build`)

## Why This Split

Separating validation from release keeps failures obvious and prevents packaging/deployment from hiding basic regressions.

- Validation workflow: fast, deterministic, merge gate.
- Release workflow: artifact production, optional signing, publishing.

## Tauri-Oriented Best Practices

1. Keep `beforeBuildCommand` equivalent checks green before any `tauri build` command.
2. Keep release jobs tag-triggered and independent from pull-request validation.
3. Use explicit artifact naming for Linux bundles (deb/rpm/appimage) when release automation is added.
4. Prefer matrix jobs only after baseline validation is stable to control CI time and noise.
5. Keep Tauri CLI and Rust crate versions aligned to avoid config/runtime mismatch issues.

## Recommended Next Step (Future)

Add a dedicated release workflow (for example `release.yml`) triggered on version tags that:

1. Builds bundles with `npm run tauri:bundle`
2. Uploads artifacts to GitHub Releases
3. Optionally uses `tauri-apps/tauri-action` for standardized artifact collection and updater metadata

Do not enable this until the validation workflow has been stable for at least several merges.
