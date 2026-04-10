# Transcribd

An audio recorder with built-in AI transcription via local Lemonade/OpenAI-compatible STT servers.

**Credit:** This project is based on [Vocalis](https://gitlab.gnome.org/World/vocalis) by the GNOME project.

<a href="https://flathub.org/apps/details/org.gnome.SoundRecorder">
<img src="https://flathub.org/assets/badges/flathub-badge-i-en.png" width="190px" />
</a>

<div align="center">
![screenshot](data/resources/screenshots/screenshot1.png)
</div>

### Useful links

Report issues: [GitHub Issues](https://github.com/rebreda/transcribd/issues)

Translate: https://wiki.gnome.org/TranslationProject

You can also join us in [#sound-recorder:gnome.org on Matrix](https://matrix.to/#/#sound-recorder:gnome.org)

### Features

- **Live Transcription**: Real-time speech-to-text while recording via WebSocket
- **Batch Transcription**: Transcribe existing audio files via HTTP multipart upload
- **Local STT Support**: Works with Lemonade, OpenAI-compatible, or any Whisper-based API
- **Multiple Audio Formats**: Opus, FLAC, MP3, MOV
- **Simple Interface**: Modern GNOME app with Gtk4 and Libadwaita

### Hacking on Transcribd

To build the development version of Transcribd and hack on the code
see the [general guide](https://wiki.gnome.org/Newcomers/BuildProject)
for building GNOME apps with Flatpak and GNOME Builder.

### Contributor Quick Start

Use this if you want to get productive quickly on Linux.

1. Install system dependencies (GNOME + build tools): `meson`, `ninja`, `gjs`, `gtk4`, `libadwaita`, `gstreamer`, `glib2`, Node.js.
2. Install JS dependencies:

```bash
npm install
```

3. Configure the development build:

```bash
meson setup build -Dprofile=development
```

4. Build:

```bash
ninja -C build
```

5. Run in development mode:

```bash
GSETTINGS_SCHEMA_DIR=$PWD/build/data ninja -C build run
```

6. Validate code before opening a PR:

```bash
npm run typecheck
npm run lint
npm run test:local-api
```

If `meson setup` fails because the build dir is stale, recreate it:

```bash
rm -rf build
meson setup build -Dprofile=development
```

### Developer Docs

- [Contributing Guide](CONTRIBUTING.md)
- [Development Guide](docs/DEVELOPMENT.md)
- [Architecture Overview](docs/ARCHITECTURE.md)

### Configuration

Set the transcription server URL in the app preferences:
- Default: `http://localhost:8080/api/v1`
- For Lemonade: `http://localhost:13305/api/v1`

Run the test suite to validate your setup:
```bash
npm run test:local-api
```

