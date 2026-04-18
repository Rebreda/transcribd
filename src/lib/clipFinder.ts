import type { ClipSort, ManifestClip, RealtimeObjectRecord } from "./appTypes";

export function filterAndSortClips(input: {
  clips: ManifestClip[];
  searchQuery: string;
  categoryFilter: string;
  sortBy: ClipSort;
}): ManifestClip[] {
  const { clips, searchQuery, categoryFilter, sortBy } = input;
  const query = searchQuery.trim().toLowerCase();

  let filtered = clips;

  if (query.length > 0) {
    filtered = filtered.filter(clip => {
      const haystack = [
        clip.title,
        clip.notes,
        clip.transcript,
        clip.fileName,
        clip.categories.join(" "),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }

  if (categoryFilter !== "all") {
    filtered = filtered.filter(clip => clip.categories.some(category => category === categoryFilter));
  }

  const sorted = [...filtered];
  if (sortBy === "title") {
    sorted.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sortBy === "oldest") {
    sorted.sort((a, b) => a.createdAtMs - b.createdAtMs);
  } else {
    sorted.sort((a, b) => b.createdAtMs - a.createdAtMs);
  }

  return sorted;
}

export function extractClipCategories(clips: ManifestClip[]): string[] {
  const values = new Set<string>();
  for (const clip of clips) {
    for (const category of clip.categories) {
      const clean = category.trim();
      if (clean.length > 0) {
        values.add(clean);
      }
    }
  }

  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

export function selectClip(clips: ManifestClip[], selectedClipId: string): ManifestClip | null {
  if (clips.length === 0) {
    return null;
  }

  const first = clips[0];
  return clips.find(clip => clip.id === selectedClipId) ?? first ?? null;
}

// ── Record filtering (operates on RealtimeObjectRecord[]) ──────────────────

/**
 * Filters and sorts the unified live/saved record list.
 * This is the single source of truth for what the recordings sidebar shows.
 */
export function filterAndSortRecords(input: {
  records: RealtimeObjectRecord[];
  searchQuery: string;
  categoryFilter: string;
  sortBy: ClipSort;
}): RealtimeObjectRecord[] {
  const { records, searchQuery, categoryFilter, sortBy } = input;
  const query = searchQuery.trim().toLowerCase();

  let filtered = records;

  if (query.length > 0) {
    filtered = filtered.filter(record => {
      const haystack = [record.title, record.notes, record.text, record.categories.join(" ")]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  if (categoryFilter !== "all") {
    filtered = filtered.filter(record => record.categories.includes(categoryFilter));
  }

  const sorted = [...filtered];
  if (sortBy === "title") {
    sorted.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sortBy === "oldest") {
    sorted.sort((a, b) => a.updatedAtMs - b.updatedAtMs);
  } else {
    // newest (default)
    sorted.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }

  return sorted;
}

/**
 * Extracts the sorted unique category set from the live/saved record list.
 * Use this instead of extractClipCategories when Tauri manifest may not be available.
 */
export function extractRecordCategories(records: RealtimeObjectRecord[]): string[] {
  const values = new Set<string>();
  for (const record of records) {
    for (const category of record.categories) {
      const clean = category.trim();
      if (clean.length > 0) {
        values.add(clean);
      }
    }
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}
