import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gst from "gi://Gst";
import Soup from "gi://Soup?version=3.0";

import {
    buildTranscriptionEndpoints,
    extractTranscriptionResult,
    type TranscriptionResult,
} from "./transcriptionParsing.js";

export type {
    TranscriptionResult,
    TranscriptionSegmentResult,
} from "./transcriptionParsing.js";

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

            const endpoints = buildTranscriptionEndpoints(this.baseUrl);
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
                    const extracted = extractTranscriptionResult(decoded);
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
