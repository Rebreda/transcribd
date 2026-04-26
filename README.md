# Transcribd

Transcribd is an always-on, privacy-preserving audio platform that transcribes and enriches your discourse. If you've ever wished you could have rememebered what you said in a past conversation, consider this the tool for you. 

Using VAD and LLMs, transcribd is able to very efficently capture, record and save audio data in real time without blowing up your CPU or storage. 

## Prerequisites for installing from source

Install Tauri prerequisites:
https://v2.tauri.app/start/prerequisites/

Fedora packages typically required for desktop builds:

- webkit2gtk4.1-devel
- javascriptcoregtk4.1-devel
- libsoup3-devel
- libappindicator-gtk3-devel
- librsvg2-devel
- openssl-devel
- patchelf
- gcc
- gcc-c++
- make

Rust toolchain is also required.

## Development

1. Install dependencies:

```bash
npm install
```

2. Run tests:

```bash
npm run test
```

3. Run web dev server:

```bash
npm run dev
```

4. Run Tauri desktop app:

```bash
npm run tauri:dev
```

## Build

Web build:

```bash
npm run build
```

Desktop build:

```bash
npm run tauri:build
```

This default desktop build is intentionally throttled for local machines: it limits Cargo to one job and skips OS package bundling.

Full Linux package build:

```bash
npm run tauri:bundle
```

Default Linux bundle targets are `deb` and `rpm`.

Note on AppImage: on newer Fedora toolchains, linuxdeploy can fail while stripping shared libraries with `.relr.dyn` sections. If you need AppImage output, build it in an environment with compatible linuxdeploy/binutils tooling.
