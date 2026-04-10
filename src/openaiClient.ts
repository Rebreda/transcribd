import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gst from "gi://Gst";
import Soup from "gi://Soup?version=3.0";

const NON_SPEECH_TOKEN = /^\s*\[(?:blank_audio|silence)\]\s*$/i;

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

    public async transcribeFile(file: Gio.File, model: string): Promise<string> {
        // Lemonade only supports WAV format — convert first
        const { wavBytes, tempPath } = await this.convertToWav(file);

        try {
            const boundary = `----vocalis-${GLib.uuid_string_random()}`;
            const encoder = new TextEncoder();

            const preamble = encoder.encode(
                `--${boundary}\r\n` +
                    `Content-Disposition: form-data; name="model"\r\n\r\n` +
                    `${model}\r\n` +
                    `--${boundary}\r\n` +
                    `Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n` +
                    `Content-Type: audio/wav\r\n\r\n`,
            );
            const epilogue = encoder.encode(`\r\n--${boundary}--\r\n`);
            const body = this.concatBytes([preamble, wavBytes, epilogue]);

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
                    const extracted = this.extractTranscription(decoded);
                    if (extracted.length > 0) return extracted;
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
        const srcPath = file.get_path();
        if (!srcPath) throw new Error("Recording file has no local path");

        const tempPath = GLib.build_filenamev([
            GLib.get_tmp_dir(),
            `vocalis-${GLib.uuid_string_random()}.wav`,
        ]);

        const pipeline = new Gst.Pipeline({ name: "wav-convert" });
        const src = Gst.ElementFactory.make("filesrc", "src");
        const decode = Gst.ElementFactory.make("decodebin", "decode");
        const convert = Gst.ElementFactory.make("audioconvert", "aconv");
        const resample = Gst.ElementFactory.make("audioresample", "aresample");
        const capsfilt = Gst.ElementFactory.make("capsfilter", "caps");
        const wavenc = Gst.ElementFactory.make("wavenc", "wavenc");
        const sink = Gst.ElementFactory.make("filesink", "sink");

        if (
            !src || !decode || !convert || !resample || !capsfilt || !wavenc || !sink
        ) {
            throw new Error(
                "Failed to create GStreamer elements for WAV conversion",
            );
        }

        src.set_property("location", srcPath);
        sink.set_property("location", tempPath);
        sink.set_property("sync", false);

        const caps = Gst.Caps.from_string(
            "audio/x-raw,format=S16LE,rate=16000,channels=1",
        );
        capsfilt.set_property("caps", caps);

        for (const el of [src, decode, convert, resample, capsfilt, wavenc, sink]) {
            pipeline.add(el);
        }

        src.link(decode);
        convert.link(resample);
        resample.link(capsfilt);
        capsfilt.link(wavenc);
        wavenc.link(sink);

        decode.connect("pad-added", (_elem: Gst.Element, pad: Gst.Pad) => {
            const sinkPad = convert.get_static_pad("sink");
            if (sinkPad && !sinkPad.is_linked()) {
                pad.link(sinkPad);
            }
        });

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

    private extractTranscription(payload: string): string {
        const raw = payload.trim();
        if (raw.length === 0) return "";

        try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const candidates: unknown[] = [
                parsed["text"],
                parsed["transcript"],
                parsed["output_text"],
            ];
            for (const c of candidates) {
                if (typeof c === "string") {
                    const trimmed = c.trim();
                    if (trimmed.length > 0 && !NON_SPEECH_TOKEN.test(trimmed)) {
                        return trimmed;
                    }
                }
            }
        } catch (_err) {
            if (!NON_SPEECH_TOKEN.test(raw)) return raw;
        }

        return "";
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
