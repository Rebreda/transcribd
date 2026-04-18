import { invoke } from "@tauri-apps/api/core";
import type { Manifest, ManifestClip } from "./appTypes";

type PersistClipPayload = {
  objectId: string;
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

type LoadManifestResult = {
  manifest: Manifest;
};

type PersistClipResult = {
  clip: ManifestClip;
};

// ── In-memory fallback (used when running outside Tauri) ─────────────────────
const memoryManifest: Manifest = { version: 1, updatedAtMs: Date.now(), clips: [] };

export async function loadManifestSafe(): Promise<LoadManifestResult> {
  if (!isTauriRuntime()) {
    return { manifest: memoryManifest };
  }

  try {
    const manifest = await invoke<Manifest>("get_manifest");
    return { manifest };
  } catch (error) {
    throw new Error(describeInvokeError("load manifest", error));
  }
}

export async function persistClipSafe(payload: PersistClipPayload): Promise<PersistClipResult> {
  if (!isTauriRuntime()) {
    const clip: ManifestClip = {
      id: payload.objectId,
      fileName: `${payload.objectId}.wav`,
      createdAtMs: Date.now(),
      startedAtMs: payload.startedAtMs,
      endedAtMs: payload.endedAtMs,
      durationMs: payload.endedAtMs - payload.startedAtMs,
      sampleRate: payload.sampleRate,
      channels: payload.channels,
      transcript: payload.transcript,
      title: payload.title,
      notes: payload.notes,
      categories: payload.categories,
    };
    memoryManifest.clips.push(clip);
    memoryManifest.updatedAtMs = Date.now();
    return { clip };
  }

  try {
    const clip = await invoke<ManifestClip>("persist_clip", { payload });
    return { clip };
  } catch (error) {
    throw new Error(describeInvokeError("persist clip", error));
  }
}

function isTauriRuntime(): boolean {
  const globalValue = globalThis as { __TAURI_INTERNALS__?: unknown };
  return typeof globalValue.__TAURI_INTERNALS__ !== "undefined";
}

function describeInvokeError(action: string, error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return `failed to ${action}: ${error.message}`;
  }

  return `failed to ${action}: ${String(error)}`;
}
