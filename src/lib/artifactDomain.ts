import { buildFallbackTitle } from "./metadata";
import type { Artifact, ManifestClip, RealtimeTranscriptRecord } from "./appTypes";

export type RealtimeRecordMetadata = {
  title: string;
  notes: string;
  categories: string[];
  inferenceState: "pending" | "ready" | "error";
};

export function normalizeTranscriptKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function mapClipToArtifact(clip: ManifestClip): Artifact {
  return {
    id: `clip-${clip.id}`,
    source: "clip",
    text: clip.transcript,
    title: clip.title,
    notes: clip.notes,
    categories: clip.categories,
    createdAtMs: clip.createdAtMs,
    updatedAtMs: clip.endedAtMs,
    inferenceState: "ready",
    hasAudioFile: true,
    clipId: clip.id,
    fileName: clip.fileName,
    itemId: "",
    startedAtMs: clip.startedAtMs,
    endedAtMs: clip.endedAtMs,
    durationMs: clip.durationMs,
  };
}

export function buildClipByTranscriptMap(clips: ManifestClip[]): Map<string, ManifestClip> {
  const map = new Map<string, ManifestClip>();
  for (const clip of clips) {
    const key = normalizeTranscriptKey(clip.transcript);
    if (!map.has(key)) {
      map.set(key, clip);
    }
  }
  return map;
}

export function buildRealtimeArtifacts(input: {
  realtimeRecords: RealtimeTranscriptRecord[];
  clipByTranscript: Map<string, ManifestClip>;
  metadataByRecordId: Record<string, RealtimeRecordMetadata>;
}): Artifact[] {
  const { realtimeRecords, clipByTranscript, metadataByRecordId } = input;

  return realtimeRecords
    .filter(record => record.isFinal)
    .map(record => {
      const matchedClip = clipByTranscript.get(normalizeTranscriptKey(record.text));
      if (matchedClip) {
        return {
          id: record.id,
          source: "clip",
          itemId: record.itemId,
          text: record.text,
          createdAtMs: matchedClip.createdAtMs,
          updatedAtMs: record.updatedAtMs,
          title: matchedClip.title,
          notes: matchedClip.notes,
          categories: matchedClip.categories,
          inferenceState: "ready" as const,
          hasAudioFile: true,
          clipId: matchedClip.id,
          fileName: matchedClip.fileName,
          startedAtMs: matchedClip.startedAtMs,
          endedAtMs: matchedClip.endedAtMs,
          durationMs: matchedClip.durationMs,
        };
      }

      const meta = metadataByRecordId[record.id];
      const fallbackTitle = buildFallbackTitle(record.text);

      return {
        id: record.id,
        source: "realtime",
        itemId: record.itemId,
        text: record.text,
        createdAtMs: record.updatedAtMs,
        updatedAtMs: record.updatedAtMs,
        title: meta?.title ?? fallbackTitle,
        notes: meta?.notes ?? "Inferring metadata for live object...",
        categories: meta?.categories ?? ["capture"],
        inferenceState: meta?.inferenceState ?? ("pending" as const),
        hasAudioFile: false,
        clipId: null,
        fileName: "",
        startedAtMs: record.updatedAtMs,
        endedAtMs: record.updatedAtMs,
        durationMs: 0,
      };
    });
}

export function buildWaveformBars(id: string | null, count = 64): number[] {
  if (!id) {
    return [];
  }

  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }

  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    const wave = Math.abs(Math.sin((i + 1) * 0.45 + hash * 0.0002));
    const noise = ((hash >>> (i % 24)) & 15) / 30;
    bars.push(Math.min(1, 0.18 + wave * 0.6 + noise));
  }

  return bars;
}

export function mergeArtifacts(items: Artifact[]): Artifact[] {
  const byKey = new Map<string, Artifact>();

  for (const artifact of items) {
    const key = artifact.hasAudioFile
      ? `clip:${artifact.clipId ?? artifact.id}`
      : (() => {
          const keyBase = normalizeTranscriptKey(artifact.text);
          return keyBase.length > 0 ? keyBase : artifact.id;
        })();

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, artifact);
      continue;
    }

    if (existing.hasAudioFile !== artifact.hasAudioFile) {
      byKey.set(key, artifact.hasAudioFile ? artifact : existing);
      continue;
    }

    if (artifact.updatedAtMs > existing.updatedAtMs) {
      byKey.set(key, artifact);
    }
  }

  return [...byKey.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

export function buildArtifactExportJson(artifacts: Artifact[], exportedAtMs = Date.now()): string {
  const exportData = artifacts.map(artifact => ({
    id: artifact.id,
    source: artifact.source,
    transcript: artifact.text,
    title: artifact.title,
    notes: artifact.notes,
    categories: artifact.categories,
    createdAtMs: artifact.createdAtMs,
    updatedAtMs: artifact.updatedAtMs,
    hasAudioFile: artifact.hasAudioFile,
    fileName: artifact.fileName,
    startedAtMs: artifact.startedAtMs,
    endedAtMs: artifact.endedAtMs,
    durationMs: artifact.durationMs,
  }));

  return JSON.stringify(
    { exportedAtMs, count: exportData.length, clips: exportData },
    null,
    2,
  );
}