import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { CacheDir } from "./application.js";

export type DateFilterMode = "all" | "today" | "week" | "month" | "year";

export interface SearchFilters {
    searchTerm: string;
    dateFilter: DateFilterMode;
    categories?: string[];
    speakers?: string[];
    tags?: string[];
}

export interface SearchableRecording {
    uri: string;
    cacheKey: string;
    name: string | null;
    category: string;
    transcription: string;
    timeCreated: GLib.DateTime;
    timeModified: GLib.DateTime;
    duration: number;
    tags?: string[];
    speakers?: string[];
}

interface PersistedEntry {
    uri: string;
    cacheKey: string;
    name: string;
    category: string;
    transcription: string;
    createdUnix: number;
    modifiedUnix: number;
    durationMs: number;
    tags: string[];
    speakers: string[];
}

interface PersistedIndex {
    version: number;
    entries: PersistedEntry[];
}

/** Tokenize text into lowercase word/digit runs for prefix matching. */
function tokenize(text: string): string[] {
    return text.toLowerCase().match(/\p{L}+|\p{N}+/gu) ?? [];
}

/**
 * Returns true when every token from `term` is a prefix of at least one token
 * in the combined entry fields — matching the FTS `token* AND ...` behaviour.
 */
function matchesSearchTerm(entry: PersistedEntry, term: string): boolean {
    const needles = tokenize(term);
    if (needles.length === 0) return true;

    const hayTokens = tokenize(
        [entry.name, entry.category, entry.transcription, ...entry.tags, ...entry.speakers].join(" "),
    );

    return needles.every(needle => hayTokens.some(hay => hay.startsWith(needle)));
}

const DATE_CUTOFF_SECONDS: Record<string, number> = {
    today: 86_400,
    week: 7 * 86_400,
    month: 30 * 86_400,
    year: 365 * 86_400,
};

export class SearchIndex {
    private static instance: SearchIndex | null = null;

    private readonly indexFile: Gio.File | null = null;

    private entries = new Map<string, PersistedEntry>();
    private loadPromise: Promise<void> | null = null;
    private writeChain: Promise<void> = Promise.resolve();

    private constructor() {
        const path = CacheDir.get_child("search-index.json").get_path();
        this.indexFile = path ? Gio.File.new_for_path(path) : null;
    }

    public static getDefault(): SearchIndex {
        if (!this.instance) this.instance = new SearchIndex();
        return this.instance;
    }

    public async upsertRecording(recording: SearchableRecording): Promise<void> {
        await this._ensureLoaded();

        this.entries.set(recording.uri, {
            uri: recording.uri,
            cacheKey: recording.cacheKey,
            name: recording.name ?? "",
            category: recording.category,
            transcription: recording.transcription,
            createdUnix: recording.timeCreated.to_unix(),
            modifiedUnix: recording.timeModified.to_unix(),
            durationMs: Math.max(0, Math.floor(recording.duration / 1_000_000)),
            tags: recording.tags ?? [],
            speakers: recording.speakers ?? [],
        });

        this._schedulePersist();
    }

    public async deleteRecording(uri: string): Promise<void> {
        await this._ensureLoaded();

        if (!this.entries.has(uri)) return;
        this.entries.delete(uri);

        this._schedulePersist();
    }

    public async search(filters: SearchFilters): Promise<Set<string> | null> {
        await this._ensureLoaded();
        await this.writeChain;

        const now = Math.floor(Date.now() / 1_000);
        const cutoffSecs = filters.dateFilter !== "all"
            ? (DATE_CUTOFF_SECONDS[filters.dateFilter] ?? null)
            : null;
        const cutoff = cutoffSecs !== null ? now - cutoffSecs : null;

        const results = new Set<string>();

        for (const entry of this.entries.values()) {
            if (filters.searchTerm && !matchesSearchTerm(entry, filters.searchTerm)) continue;

            const categories = filters.categories ?? [];
            if (categories.length > 0 &&
                !categories.some(cat => entry.category.toLowerCase() === cat.toLowerCase())) continue;

            if (cutoff !== null && entry.createdUnix < cutoff) continue;

            const speakers = filters.speakers ?? [];
            if (speakers.length > 0 &&
                !speakers.every(selected =>
                    entry.speakers.some(s => s.toLowerCase() === selected.toLowerCase()))) continue;

            const tags = filters.tags ?? [];
            if (tags.length > 0 &&
                !tags.every(selected =>
                    entry.tags.some(t => t.toLowerCase() === selected.toLowerCase()))) continue;

            results.add(entry.uri);
        }

        return results;
    }

    private async _ensureLoaded(): Promise<void> {
        if (!this.loadPromise) {
            this.loadPromise = this._load();
        }
        await this.loadPromise;
    }

    private async _load(): Promise<void> {
        if (!this.indexFile) return;

        try {
            const [bytes] = await this.indexFile.load_bytes_async(null);
            const text = new TextDecoder("utf-8").decode(bytes.get_data() ?? new Uint8Array());
            const data = JSON.parse(text) as PersistedIndex;
            for (const entry of data.entries ?? []) {
                this.entries.set(entry.uri, entry);
            }
        } catch (_e) {
            // No existing index — start fresh.
        }
    }

    private _schedulePersist(): void {
        this.writeChain = this.writeChain.then(async () => {
            if (!this.indexFile) return;

            try {
                const data: PersistedIndex = {
                    version: 1,
                    entries: [...this.entries.values()],
                };
                await this.indexFile.replace_contents_async(
                    new TextEncoder().encode(JSON.stringify(data)),
                    null,
                    false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION,
                    null,
                );
            } catch (err) {
                console.error(
                    "[SearchIndex] Persist failed:",
                    err instanceof Error ? err.message : String(err),
                );
            }
        });
    }
}
