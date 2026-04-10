/* exported Recording */
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gst from "gi://Gst";
import GstPbutils from "gi://GstPbutils";

import { CacheDir } from "./application.js";
import { EncodingProfiles } from "./recorder.js";

function isNumArray(input: unknown): input is number[] {
    return Array.isArray(input) && input.every((i) => typeof i === "number");
}

export interface TranscriptionSegment {
    startMs: number;
    endMs: number;
    text: string;
}

export class Recording extends GObject.Object {
    private _file: Gio.File;
    private _peaks: number[];
    private loadedPeaks: number[];
    private _extension?: string;
    private _timeModified: GLib.DateTime;
    private _timeCreated: GLib.DateTime;
    private _duration?: number;
    private _transcription = "";
    private _category = "";
    private _segments: TranscriptionSegment[] = [];
    private _cacheKey: string;

    public pipeline?: Gst.Bin | null;

    static {
        GObject.registerClass(
            {
                Signals: {
                    "peaks-updated": {},
                    "peaks-loading": {},
                },
                Properties: {
                    duration: GObject.ParamSpec.int(
                        "duration",
                        "Recording Duration",
                        "Recording duration in nanoseconds",
                        GObject.ParamFlags.READWRITE |
                            GObject.ParamFlags.CONSTRUCT,
                        0,
                        GLib.MAXINT16,
                        0,
                    ),
                    name: GObject.ParamSpec.string(
                        "name",
                        "Recording Name",
                        "Recording name in string",
                        GObject.ParamFlags.READWRITE |
                            GObject.ParamFlags.CONSTRUCT,
                        "",
                    ),
                    transcription: GObject.ParamSpec.string(
                        "transcription",
                        "Transcription",
                        "Transcribed text for this recording",
                        GObject.ParamFlags.READWRITE |
                            GObject.ParamFlags.CONSTRUCT,
                        "",
                    ),
                    category: GObject.ParamSpec.string(
                        "category",
                        "Category",
                        "Recording category tag",
                        GObject.ParamFlags.READWRITE |
                            GObject.ParamFlags.CONSTRUCT,
                        "",
                    ),
                },
            },
            this,
        );
    }

    constructor(file: Gio.File) {
        super();

        this._file = file;
        this._peaks = [];
        this.loadedPeaks = [];

        const info = file.query_info(
            "time::created,time::modified,standard::content-type,id::file",
            0,
            null,
        );
        const contentType = info.get_attribute_string("standard::content-type");
        const rawFileId =
            info.get_attribute_string("id::file") ?? this._file.get_uri();
        this._cacheKey =
            GLib.compute_checksum_for_string(
                GLib.ChecksumType.SHA256,
                rawFileId,
                -1,
            ) ??
            rawFileId;

        for (const profile of EncodingProfiles) {
            if (profile.contentType === contentType) {
                this._extension = profile.extension;
                break;
            }
        }

        const timeModified = info.get_attribute_uint64("time::modified");
        const timeCreated = info.get_attribute_uint64("time::created");
        this._timeModified = GLib.DateTime.new_from_unix_local(timeModified);
        this._timeCreated = GLib.DateTime.new_from_unix_local(timeCreated);

        const discoverer = new GstPbutils.Discoverer();
        discoverer.start();
        discoverer.connect(
            "discovered",
            (
                _discoverer: GstPbutils.Discoverer,
                audioInfo: GstPbutils.DiscovererInfo,
            ) => {
                this._duration = audioInfo.get_duration();
                this.notify("duration");
            },
        );

        discoverer.discover_uri_async(this.uri);

        // Attempt to load any previously saved transcription + metadata
        void this.loadTranscription();
        void this.loadMetadata();
        void this.loadSegments();
    }

    public get name(): string | null {
        return this._file.get_basename();
    }

    public set name(filename: string | null) {
        if (filename && filename !== this.name) {
            this._file = this._file.set_display_name(filename, null);
            this.notify("name");
        }
    }

    public get extension(): string | undefined {
        return this._extension;
    }

    public get timeModified(): GLib.DateTime {
        return this._timeModified;
    }

    public get timeCreated(): GLib.DateTime {
        return this._timeCreated;
    }

    public get duration(): number {
        if (this._duration) return this._duration;
        else return 0;
    }

    public get file(): Gio.File {
        return this._file;
    }

    public get uri(): string {
        return this._file.get_uri();
    }

    public set peaks(data: number[]) {
        if (data.length > 0) {
            this._peaks = data;
            this.emit("peaks-updated");
            const enc = new TextEncoder();
            const contents = enc.encode(JSON.stringify(data));
            this.waveformCache.replace_contents_async(
                contents,
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null,
                null,
            );
        }
    }

    public get peaks(): number[] {
        return this._peaks;
    }

    public async delete(): Promise<void> {
        await this._file.trash_async(GLib.PRIORITY_HIGH, null);
        const waveformCaches = [
            this.waveformCache,
            this.legacyWaveformCache,
        ];
        for (const cache of waveformCaches) {
            try {
                if (cache.query_exists(null)) {
                    await cache.trash_async(GLib.PRIORITY_DEFAULT, null);
                }
            } catch (_err) {
                // Ignore missing cache files.
            }
        }

        const transcriptCaches = [
            this.transcriptionCache,
            this.legacyTranscriptionCache,
        ];
        for (const cache of transcriptCaches) {
            try {
                if (cache.query_exists(null)) {
                    await cache.trash_async(GLib.PRIORITY_DEFAULT, null);
                }
            } catch (_err) {
                // Ignore missing cache files.
            }
        }

        for (const cache of [this.metadataCache, this.segmentsCache]) {
            try {
                if (cache.query_exists(null)) {
                    await cache.trash_async(GLib.PRIORITY_DEFAULT, null);
                }
            } catch (_err) { /* ignore */ }
        }
    }

    public save(dest: Gio.File): void {
        void this.file.copy_async(
            dest,
            Gio.FileCopyFlags.NONE,
            GLib.PRIORITY_DEFAULT,
            null,
            null,
            (obj: Gio.File | null, res: Gio.AsyncResult) => {
                if (obj?.copy_finish(res)) log("Exporting file: done");
            },
        );
    }

    public get waveformCache(): Gio.File {
        return CacheDir.get_child(`${this._cacheKey}_data`);
    }

    private get legacyWaveformCache(): Gio.File {
        return CacheDir.get_child(`${this.name}_data`);
    }

    public get transcriptionCache(): Gio.File {
        return CacheDir.get_child(`${this._cacheKey}.transcript`);
    }

    private get legacyTranscriptionCache(): Gio.File {
        return CacheDir.get_child(`${this.name}.transcript`);
    }

    public get metadataCache(): Gio.File {
        return CacheDir.get_child(`${this._cacheKey}.meta`);
    }

    public get segmentsCache(): Gio.File {
        return CacheDir.get_child(`${this._cacheKey}.segments`);
    }

    public get transcription(): string {
        return this._transcription;
    }

    public set transcription(value: string) {
        this._transcription = value;
        this.notify("transcription");
    }

    public async loadTranscription(): Promise<void> {
        const candidates = [
            this.transcriptionCache,
            this.legacyTranscriptionCache,
        ];

        try {
            for (const cache of candidates) {
                if (!cache.query_exists(null)) continue;
                const bytes = (await cache.load_bytes_async(null))[0];
                if (bytes) {
                    const data = bytes.get_data();
                    if (data) {
                        this.transcription = new TextDecoder("utf-8").decode(
                            data,
                        );
                        break;
                    }
                }
            }
        } catch (_err) {
            // No transcript file yet — that's fine
        }
    }

    public get category(): string {
        return this._category;
    }

    public set category(value: string) {
        this._category = value;
        this.notify("category");
    }

    public async loadMetadata(): Promise<void> {
        try {
            if (!this.metadataCache.query_exists(null)) return;
            const bytes = (await this.metadataCache.load_bytes_async(null))[0];
            if (!bytes) return;
            const data = bytes.get_data();
            if (!data) return;
            const json = JSON.parse(
                new TextDecoder("utf-8").decode(data),
            ) as Record<string, unknown>;
            if (typeof json["category"] === "string") {
                this._category = json["category"];
                this.notify("category");
            }
        } catch (_err) { /* no metadata yet */ }
    }

    public async saveCategory(cat: string): Promise<void> {
        this.category = cat;
        let current: Record<string, unknown> = {};
        try {
            if (this.metadataCache.query_exists(null)) {
                const bytes = (await this.metadataCache.load_bytes_async(null))[0];
                if (bytes) {
                    const data = bytes.get_data();
                    if (data) current = JSON.parse(new TextDecoder("utf-8").decode(data)) as Record<string, unknown>;
                }
            }
        } catch (_) { /* ignore */ }
        current["category"] = cat;
        await this.metadataCache.replace_contents_async(
            new TextEncoder().encode(JSON.stringify(current)),
            null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null,
        );
    }

    public get segments(): TranscriptionSegment[] {
        return this._segments.slice();
    }

    public async loadSegments(): Promise<void> {
        try {
            if (!this.segmentsCache.query_exists(null)) return;
            const bytes = (await this.segmentsCache.load_bytes_async(null))[0];
            if (!bytes) return;
            const data = bytes.get_data();
            if (!data) return;
            const parsed = JSON.parse(
                new TextDecoder("utf-8").decode(data),
            ) as unknown;
            if (Array.isArray(parsed)) {
                this._segments = (parsed as unknown[]).filter(
                    (s): s is TranscriptionSegment =>
                        typeof s === "object" && s !== null &&
                        typeof (s as Record<string, unknown>)["startMs"] === "number" &&
                        typeof (s as Record<string, unknown>)["endMs"] === "number" &&
                        typeof (s as Record<string, unknown>)["text"] === "string",
                );
            }
        } catch (_err) { /* no segments yet */ }
    }

    public async saveSegments(segs: TranscriptionSegment[]): Promise<void> {
        this._segments = [...segs];
        await this.segmentsCache.replace_contents_async(
            new TextEncoder().encode(JSON.stringify(segs)),
            null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null,
        );
    }

    public async saveTranscription(text: string): Promise<void> {
        this.transcription = text;
        const enc = new TextEncoder();
        const contents = enc.encode(text);
        await this.transcriptionCache.replace_contents_async(
            contents,
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null,
        );
    }

    public async loadPeaks(): Promise<void> {
        const caches = [this.waveformCache, this.legacyWaveformCache];

        try {
            let bytes: GLib.Bytes | null = null;
            for (const cache of caches) {
                if (!cache.query_exists(null)) continue;
                bytes = (await cache.load_bytes_async(null))[0];
                if (bytes) break;
            }
            const decoder = new TextDecoder("utf-8");
            if (bytes) {
                const data = bytes.get_data();
                if (data) {
                    const parsedJSON: unknown = JSON.parse(
                        decoder.decode(data),
                    );
                    if (isNumArray(parsedJSON)) {
                        this._peaks = parsedJSON;
                        this.emit("peaks-updated");
                    } else {
                        throw new GLib.NumberParserError({
                            message: "Failed to parse waveform",
                            code: GLib.NumberParserError.INVALID,
                        });
                    }
                }
            }
        } catch (error) {
            if (error instanceof GLib.Error) {
                log(`Error reading waveform data file: ${error.message}`);
                if (
                    error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND) ||
                    error.matches(
                        GLib.NumberParserError,
                        GLib.NumberParserError.INVALID,
                    )
                ) {
                    this.emit("peaks-loading");
                    this.generatePeaks();
                }
            }
        }
    }

    private generatePeaks(): void {
        this.pipeline = Gst.parse_launch(
            "uridecodebin name=uridecodebin ! audioconvert ! audio/x-raw,channels=1 ! level name=level ! fakesink name=faked",
        ) as Gst.Bin;

        const uridecodebin = this.pipeline.get_by_name("uridecodebin");
        uridecodebin?.set_property("uri", this.uri);

        const fakesink = this.pipeline.get_by_name("faked");
        fakesink?.set_property("qos", false);
        fakesink?.set_property("sync", true);

        const bus = this.pipeline.get_bus();
        this.pipeline.set_state(Gst.State.PLAYING);
        bus?.add_signal_watch();

        bus?.connect("message", (_bus: Gst.Bus, message: Gst.Message) => {
            switch (message.type) {
                case Gst.MessageType.ELEMENT: {
                    const s = message.get_structure();
                    if (s && s.has_name("level")) {
                        const peakVal = s.get_value(
                            "peak",
                        ) as unknown as GObject.ValueArray;

                        if (peakVal) {
                            const peak = peakVal.get_nth(0) as number;
                            this.loadedPeaks.push(Math.pow(10, peak / 20));
                        }
                    }
                    break;
                }
                case Gst.MessageType.EOS:
                    this.peaks = this.loadedPeaks;
                    this.pipeline?.set_state(Gst.State.NULL);
                    this.pipeline = null;
                    break;
            }
        });
    }
}
