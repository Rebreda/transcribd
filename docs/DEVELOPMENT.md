# Development Guide

This guide is for contributors working on Transcribd locally.

## Toolchain

Required:
- Linux desktop environment (GNOME recommended)
- Node.js + npm
- meson
- ninja
- gjs
- gtk4
- libadwaita
- glib2 tools
- gstreamer + gstreamer-pbutils

## Initial Setup

```bash
npm install
meson setup build -Dprofile=development
ninja -C build
```

## Running the App

Use the schema directory from the build output in development:

```bash
GSETTINGS_SCHEMA_DIR=$PWD/build/data ninja -C build run
```

## Useful Commands

Build:

```bash
ninja -C build
```

Typecheck:

```bash
npm run typecheck
```

Lint:

```bash
npm run lint
```

Auto-fix lint issues:

```bash
npm run lint:fix
```

Local API integration tests:

```bash
npm run test:local-api
```

## Rebuild from Clean State

If Meson references stale files or old app IDs:

```bash
rm -rf build
meson setup build -Dprofile=development
ninja -C build
```

## Transcription Development

Default local server URLs used in current docs/config:
- Lemonade-style: `http://localhost:8080/api/v1`
- Alternate default found in schema templates may differ by branch history

If API tests fail, verify:
1. The local server is up.
2. Endpoint path compatibility (`/api/v1`, `/v1`, etc.).
3. Model availability for realtime and/or chat tests.

## Troubleshooting

### Error: icon file does not exist

Example:
`ERROR: File icons/app.rebreda.Transcribd.svg does not exist`

Actions:
1. Confirm files in `data/icons/`.
2. Confirm file names referenced in `data/meson.build`.
3. Re-run clean setup (`rm -rf build` + `meson setup ...`).

### Error: GSettings schema not found

Example:
`GSettings schema app.rebreda.Transcribd.Devel not found`

Actions:
1. Build resources with `ninja -C build`.
2. Run with `GSETTINGS_SCHEMA_DIR=$PWD/build/data`.

### Runtime template/resource load failures

If a `resource:///...` path fails, verify:
1. App/resource prefixes match current application ID.
2. `data/*.gresource.xml` and `src/*.gresource.xml.in` prefixes are aligned.
3. Build output regenerated after changes.

## Directory Map

- `src/`: TypeScript application code
- `data/ui/`: Gtk UI templates
- `data/icons/`: App and symbolic icons
- `data/*.in*`: Build-time templates for desktop/appdata/gschema
- `tests/`: Local API integration tests
- `po/`: gettext translations

## CI Notes

Primary CI should be GitHub Actions.
Flatpak workflow is documented in `docs/FLATPAK.md` and implemented in `.github/workflows/flatpak.yml`.
If changing pipeline behavior, keep the manifest, app ID, and module names in sync.
