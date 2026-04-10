import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gst from "gi://Gst";
import Soup from "gi://Soup?version=3.0";

const NON_SPEECH_TOKEN = /^\s*\[(?:blank_audio|silence)\]\s*$/i;

export interface TranscriptionSegmentResult {
    startMs: number;
    endMs: number;
    text: string;
}

export interface TranscriptionResult {
    text: string;
    segments: TranscriptionSegmentResult[];
}

export interface OpenAICompatibleClientOptions {
    baseUrl: string;
    apiKey: string;
    session?: Soup.Session;
}

/**
 * Minimal OpenAI-compatible client for GJS environments.
 * Keeps request/endpoint logic in one place so callers use an SDK-like API.
 */
export class OpenAICompatibleClient {
    private baseUrl: string;
    private apiKey: string;
    private session: Soup.Session;

    constructor(opts: OpenAICompatibleClientOptions) {
        this.baseUrl = opts.baseUrl.trim();
        this.apiKey = opts.apiKey;
        this.session = opts.session ?? new Soup.Session();
    }

    public async transcribeFile(
        file: Gio.File,
        model: string,
    ): Promise<TranscriptionResult> {
        // Lemonade only supports WAV format — convert first
        const { wavBytes, tempPath } = await this.convertToWav(file);

        try {
            const boundary = `----vocalis-${GLib.uuid_string_random()}`;
            const encoder = new TextEncoder();
            const parts: Uint8Array[] = [];

            const appendField = (name: string, value: string): void => {
                parts.push(
                    encoder.encode(
                        `--${boundary}\r\n` +
                            `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
                            `${value}\r\n`,
                    ),
                );
            };

            appendField("model", model);
            appendField("response_format", "json");
            appendField("timestamp_granularities[]", "word");
            appendField("word_timestamps", "true");
            parts.push(
                encoder.encode(
                    `--${boundary}\r\n` +
                        `Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n` +
                        `Content-Type: audio/wav\r\n\r\n`,
                ),
            );
            parts.push(wavBytes);
            parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));
            const body = this.concatBytes(parts);

            const endpoints = this.buildTranscriptionEndpoints();
            let lastError = "Unknown transcription error";

            for (const endpoint of endpoints) {
                const msg = Soup.Message.new("POST", endpoint);
                if (!msg) continue;

            msg.request_headers.append("Authorization", `Bearer ${this.apiKey}`);
            msg.set_request_body_from_bytes(
                `multipart/form-data; boundary=${boundary}`,
                GLib.Bytes.new(body),
            );

            try {
                const responseBytes = await this.session.send_and_read_async(
                    msg,
                    GLib.PRIORITY_DEFAULT,
                    null,
                );
                const decoded = new TextDecoder("utf-8").decode(
                    responseBytes.get_data() ?? new Uint8Array(),
                );
                console.log(
                    `[OpenAIClient] HTTP status ${msg.statusCode} from ${endpoint}`,
                );
                if (msg.statusCode >= 200 && msg.statusCode < 300) {
                    const extracted = this.extractTranscriptionResult(decoded);
                    if (extracted.text.length > 0) return extracted;
                }
                lastError =
                    `HTTP ${msg.statusCode} from ${endpoint}: ${decoded.slice(0, 200)}`;
            } catch (err) {
                lastError = err instanceof Error ? err.message : String(err);
            }
        }

        throw new Error(lastError);
        } finally {
            if (tempPath) {
                try {
                    Gio.File.new_for_path(tempPath).delete(null);
                } catch (_e) { /* ignore cleanup errors */ }
            }
        }
    }

    private async convertToWav(
        file: Gio.File,
    ): Promise<{ wavBytes: Uint8Array; tempPath: string }> {
        const srcUri = file.get_uri();
        if (!srcUri) throw new Error("Recording file has no local URI");

        const tempPath = GLib.build_filenamev([
            GLib.get_tmp_dir(),
            `vocalis-${GLib.uuid_string_random()}.wav`,
        ]);
        const escapedUri = srcUri.replace(/(["\\])/g, "\\$1");
        const escapedTempPath = tempPath.replace(/(["\\])/g, "\\$1");
        const pipeline = Gst.parse_launch(
            `uridecodebin uri="${escapedUri}" ! ` +
                `audioconvert ! ` +
                `audioresample ! ` +
                `audio/x-raw,format=S16LE,rate=16000,channels=1 ! ` +
                `wavenc ! ` +
                `filesink location="${escapedTempPath}" sync=false`,
        ) as Gst.Element;

        pipeline.set_state(Gst.State.PLAYING);

        await new Promise<void>((resolve, reject) => {
            const bus = pipeline.get_bus();
            if (!bus) {
                reject(new Error("No pipeline bus"));
                return;
            }
            bus.add_signal_watch();

            const timeoutId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                60,
                () => {
                    pipeline.set_state(Gst.State.NULL);
                    reject(new Error("WAV conversion timed out"));
                    return GLib.SOURCE_REMOVE;
                },
            );

            bus.connect("message", (_bus: Gst.Bus, msg: Gst.Message) => {
                if (msg.type === Gst.MessageType.EOS) {
                    GLib.source_remove(timeoutId);
                    pipeline.set_state(Gst.State.NULL);
                    resolve();
                } else if (msg.type === Gst.MessageType.ERROR) {
                    GLib.source_remove(timeoutId);
                    pipeline.set_state(Gst.State.NULL);
                    const [err] = msg.parse_error();
                    reject(
                        new Error(err ? err.message : "Unknown GStreamer error"),
                    );
                }
            });
        });

        const wavFile = Gio.File.new_for_path(tempPath);
        const [loaded] = await wavFile.load_bytes_async(null);
        const wavBytes = loaded.get_data();
        if (!wavBytes || wavBytes.length === 0) {
            throw new Error("Converted WAV file is empty");
        }

        return { wavBytes, tempPath };
    }

    private buildTranscriptionEndpoints(): string[] {
        const rawBase = this.baseUrl.replace(/\/+$/, "");
        const root = rawBase.replace(/\/(api\/)?v1$/i, "");
        const candidates = [
            `${rawBase}/audio/transcriptions`,
            `${root}/api/v1/audio/transcriptions`,
        ];

        const unique: string[] = [];
        for (const url of candidates) {
            if (!unique.includes(url)) unique.push(url);
        }
        return unique;
    }

    private extractTranscriptionResult(payload: string): TranscriptionResult {
        const raw = payload.trim();
        if (raw.length === 0) return { text: "", segments: [] };

        try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const candidates: unknown[] = [
                parsed["text"],
                parsed["transcript"],
                parsed["output_text"],
            ];
            const text = this.pickFirstText(candidates);
            const segments = this.extractSegments(parsed);
            if (text.length > 0) {
                return { text, segments };
            }
        } catch (_err) {
            if (!NON_SPEECH_TOKEN.test(raw)) {
                return { text: raw, segments: [] };
            }
        }

        return { text: "", segments: [] };
    }

    private pickFirstText(candidates: unknown[]): string {
        for (const c of candidates) {
            if (typeof c === "string") {
                const trimmed = c.trim();
                if (trimmed.length > 0 && !NON_SPEECH_TOKEN.test(trimmed)) {
                    return trimmed;
                }
            }
        }
        return "";
    }

    private extractSegments(parsed: Record<string, unknown>): TranscriptionSegmentResult[] {
        const directWords = this.parseSegmentArray(parsed["words"]);
        if (directWords.length > 0) return directWords;

        const nestedWords = this.parseNestedWords(parsed["segments"]);
        if (nestedWords.length > 0) return nestedWords;

        const directSegments = this.parseSegmentArray(parsed["segments"]);
        if (directSegments.length > 0) return directSegments;

        return [];
    }

    private parseNestedWords(value: unknown): TranscriptionSegmentResult[] {
        if (!Array.isArray(value)) return [];

        const words: TranscriptionSegmentResult[] = [];
        for (const entry of value) {
            if (typeof entry !== "object" || entry === null) continue;
            const record = entry as Record<string, unknown>;
            words.push(...this.parseSegmentArray(record["words"]));
        }

        return words;
    }

    private parseSegmentArray(value: unknown): TranscriptionSegmentResult[] {
        if (!Array.isArray(value)) return [];

        const segments: TranscriptionSegmentResult[] = [];
        for (const entry of value) {
            if (typeof entry !== "object" || entry === null) continue;
            const record = entry as Record<string, unknown>;
            const text = this.pickFirstText([
                record["word"],
                record["text"],
                record["token"],
            ]);
            if (!text) continue;

            const start = this.readTimestamp(record, ["start_ms", "start", "t0", "from"]);
            const end = this.readTimestamp(record, ["end_ms", "end", "t1", "to"]);
            if (start === null || end === null || end < start) continue;

            segments.push({ startMs: start, endMs: end, text });
        }

        return segments;
    }

    private readTimestamp(record: Record<string, unknown>, keys: string[]): number | null {
        for (const key of keys) {
            const value = record[key];
            if (typeof value !== "number" || Number.isNaN(value)) continue;
            if (key.endsWith("_ms")) return Math.round(value);
            if (key === "t0" || key === "t1") return Math.round(value * 10);
            if (!Number.isInteger(value) || value <= 600) return Math.round(value * 1000);
            return Math.round(value);
        }
        return null;
    }

    private concatBytes(parts: Uint8Array[]): Uint8Array {
        const total = parts.reduce((sum, p) => sum + p.length, 0);
        const out = new Uint8Array(total);
        let offset = 0;
        for (const part of parts) {
            out.set(part, offset);
            offset += part.length;
        }
        return out;
    }
}
