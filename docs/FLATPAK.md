# Flatpak Build and CI

This project now uses GitHub Actions for Flatpak builds.

## Manifest

Current development manifest:
- `app.rebreda.Transcribd.Devel.json`

## Build Flatpak Locally

1. Install prerequisites:

```bash
sudo dnf install -y flatpak flatpak-builder
```

2. Add Flathub remote:

```bash
flatpak --user remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
```

3. Install SDK/runtime:

```bash
flatpak --user install -y flathub org.gnome.Sdk//48 org.gnome.Platform//48
```

4. Build repo and bundle:

```bash
flatpak-builder --user --force-clean --repo=repo flatpak-build app.rebreda.Transcribd.Devel.json
flatpak build-bundle repo transcribd-devel.flatpak app.rebreda.Transcribd.Devel
```

5. Install and run locally:

```bash
flatpak --user install -y ./transcribd-devel.flatpak
flatpak run app.rebreda.Transcribd.Devel
```

## GitHub Actions Workflow

Workflow file:
- `.github/workflows/flatpak.yml`

Triggers:
- Pull requests
- Pushes to `main`
- Manual dispatch

Output artifact:
- `transcribd-devel.flatpak`

## Release on Tag Push

The workflow also publishes to GitHub Releases when you push a tag starting with `v`.

Example:

```bash
git tag v1.0.1
git push origin v1.0.1
```

On that tag push, GitHub Actions will:
1. Build `transcribd-devel.flatpak`.
2. Create or update a GitHub Release for the tag.
3. Attach `transcribd-devel.flatpak` to the release.

## Optional: Publish Strategy

For broader distribution later, you can also publish to:
- Flathub, or
- your own OSTree repo/bucket.

## Troubleshooting

### Runtime or extension install issues

If extension installation fails in CI, keep the build green by:
- relying on runtime deps from `flathub`, and
- pinning extension versions only when required by your toolchain.

### Manifest mismatch

If the workflow fails with app ID or module mismatch:
1. Verify app ID in `app.rebreda.Transcribd.Devel.json`.
2. Verify module name and source URL in the same manifest.
3. Re-run the workflow after manifest changes.

### Build fails on stale state

Clear local build output and retry:

```bash
rm -rf flatpak-build repo .flatpak-builder
```
