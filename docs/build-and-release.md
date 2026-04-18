# Build And Release

This document covers practical build commands for local development and Linux packaging.

## Standard Commands

From repository root:

```bash
npm install
npm run test
npm run build
```

## Desktop Builds (No Bundle)

```bash
npm run tauri:build
```

This command is configured to:

- set `CARGO_BUILD_JOBS=1`
- run `tauri build --no-bundle`

Use this for quick local binary validation.

## Clean Desktop Build

```bash
rm -rf dist src-tauri/target && CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=1 npm run tauri:build
```

This removes `dist` and `src-tauri/target`, disables incremental Rust builds, and rebuilds.

## Linux Bundle Builds

Bundle both configured targets (`deb` + `rpm`):

```bash
npm run tauri:bundle
```

Build only RPM:

```bash
npm run tauri:bundle -- --bundles rpm
```

Build only DEB:

```bash
npm run tauri:bundle -- --bundles deb
```

Bundle artifacts are written under:

- `src-tauri/target/release/bundle/`

## Fedora Packaging Notes

Common required packages:

- `rpm-build`
- `webkit2gtk4.1-devel`
- `javascriptcoregtk4.1-devel`
- `libsoup3-devel`
- `openssl-devel`
- `gcc-c++`

If packaging fails, confirm Tauri Linux prerequisites first:

https://v2.tauri.app/start/prerequisites/

## Release Tips

- Keep `version` aligned in `package.json` and `src-tauri/tauri.conf.json`.
- Run tests/build before cutting bundles.
- Prefer clean build for final release artifacts.
- Archive checksums and artifact names in release notes.
