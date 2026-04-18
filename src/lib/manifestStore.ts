import { invoke } from "@tauri-apps/api/core";
import type { Manifest, ManifestClip } from "./appTypes";

type PersistClipPayload = {
  audioBase64: string;
  transcript: string;
  title: string;
  notes: string;
  categories: string[];
  startedAtMs: number;
  endedAtMs: number;
  sampleRate: number;
  channels: number;
};

type Backend = "tauri" | "web";

const STORAGE_KEY = "transcribd.web.manifest.v1";

type LoadManifestResult = {
  manifest: Manifest;
  backend: Backend;
};

type PersistClipResult = {
  clip: ManifestClip;
  backend: Backend;
};

export async function loadManifestSafe(): Promise<LoadManifestResult> {
  if (isTauriRuntime()) {
    try {
      const manifest = await invoke<Manifest>("get_manifest");
      return { manifest, backend: "tauri" };
    } catch {
      // Fall through to web storage if Tauri command bridge is unavailable.
    }
  }

  return { manifest: loadWebManifest(), backend: "web" };
}

export async function persistClipSafe(payload: PersistClipPayload): Promise<PersistClipResult> {
  if (isTauriRuntime()) {
    try {
      const clip = await invoke<ManifestClip>("persist_clip", { payload });
      return { clip, backend: "tauri" };
    } catch {
      // Fall through to web storage if Tauri command bridge is unavailable.
    }
  }

  const clip = persistWebClip(payload);
  return { clip, backend: "web" };
}

function isTauriRuntime(): boolean {
  const globalValue = globalThis as { __TAURI_INTERNALS__?: unknown };
  return typeof globalValue.__TAURI_INTERNALS__ !== "undefined";
}

function defaultManifest(): Manifest {
  return { version: 1, updatedAtMs: Date.now(), clips: [] };
}

function loadWebManifest(): Manifest {
  if (!hasLocalStorage()) {
    return defaultManifest();
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return defaultManifest();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Manifest>;
    const clips = Array.isArray(parsed.clips) ? parsed.clips as ManifestClip[] : [];
    return {
      version: typeof parsed.version === "number" ? parsed.version : 1,
      updatedAtMs: typeof parsed.updatedAtMs === "number" ? parsed.updatedAtMs : Date.now(),
      clips,
    };
  } catch {
    return defaultManifest();
  }
}

function saveWebManifest(manifest: Manifest): void {
  if (!hasLocalStorage()) {
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(manifest));
}

function persistWebClip(payload: PersistClipPayload): ManifestClip {
  const manifest = loadWebManifest();
  const now = Date.now();
  const clipId = `web-${now}-${Math.random().toString(36).slice(2, 8)}`;

  const clip: ManifestClip = {
    id: clipId,
    fileName: `${clipId}.wav`,
    createdAtMs: now,
    startedAtMs: payload.startedAtMs,
    endedAtMs: payload.endedAtMs,
    durationMs: Math.max(0, payload.endedAtMs - payload.startedAtMs),
    sampleRate: payload.sampleRate,
    channels: payload.channels,
    transcript: payload.transcript,
    title: payload.title,
    notes: payload.notes,
    categories: payload.categories,
  };

  const updated: Manifest = {
    ...manifest,
    updatedAtMs: now,
    clips: [...manifest.clips, clip],
  };
  saveWebManifest(updated);
  return clip;
}

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}
