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

export async function loadManifestSafe(): Promise<LoadManifestResult> {
  ensureTauriRuntime();

  try {
    const manifest = await invoke<Manifest>("get_manifest");
    return { manifest };
  } catch (error) {
    throw new Error(describeInvokeError("load manifest", error));
  }
}

export async function persistClipSafe(payload: PersistClipPayload): Promise<PersistClipResult> {
  ensureTauriRuntime();

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

function ensureTauriRuntime(): void {
  if (!isTauriRuntime()) {
    throw new Error("native storage is only available inside the Tauri desktop runtime");
  }
}

function describeInvokeError(action: string, error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return `failed to ${action}: ${error.message}`;
  }

  return `failed to ${action}: ${String(error)}`;
}
