import Adw from "gi://Adw";
import Gdk from "gi://Gdk?version=4.0";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk?version=4.0";
import Soup from "gi://Soup?version=3.0";

import { Settings } from "./application.js";
import { OpenAICompatibleClient } from "./openaiClient.js";

interface WsHealthResponse {
    status: string;
    websocket_port?: number;
}

interface WsMessage {
    type: string;
    transcript?: string;
    delta?: string;
    error?: { message?: string };
    session?: { model?: string; turn_detection?: Record<string, unknown> };
    audio?: string;
    item?: {
        transcript?: string;
        text?: string;
        delta?: string;
        content?: Array<{
            transcript?: string;
            text?: string;
            delta?: string;
        }>;
    };
    data?: {
        transcript?: string;
        text?: string;
        delta?: string;
    };
}

const NON_SPEECH_TOKEN = /^\s*\[(?:blank_audio|silence)\]\s*$/i;

export class TranscriberService extends GObject.Object {
    private session: Soup.Session;
    private wsConnection: Soup.WebsocketConnection | null = null;
    private segmentStartMs: number | null = null;
    private recordingStartMs: number | null = null;


    static {
        GObject.registerClass(
            {
                Signals: {
                    "transcription-partial": {
                        param_types: [GObject.TYPE_STRING],
                    },
                    "transcription-done": {
                        param_types: [GObject.TYPE_STRING],
                    },
                    "transcription-error": {
                        param_types: [GObject.TYPE_STRING],
                    },
                    "transcription-segment": {
                        param_types: [GObject.TYPE_DOUBLE, GObject.TYPE_DOUBLE, GObject.TYPE_STRING],
                    },
                    connected: {},
                    disconnected: {},
                },
            },
            this,
        );
    }

    constructor() {
        super();
        this.session = new Soup.Session();
    }

    public setRecordingStart(startMs: number): void {
        this.recordingStartMs = startMs;
        this.segmentStartMs = null;
    }

    public get serverUrl(): string {
        return Settings.get_string("transcription-server-url");
    }

    public get model(): string {
        return Settings.get_string("transcription-model");
    }

    public get apiKey(): string {
        return Settings.get_string("transcription-api-key");
    }

    public async startSession(): Promise<void> {
        if (this.wsConnection) return;

        // Discover WebSocket port from the health endpoint
        const baseUrl = this.serverUrl;
        const healthUrl = `${baseUrl}/health`;
        console.log(`[Transcriber] Contacting health endpoint: ${healthUrl}`);
        const msg = Soup.Message.new("GET", healthUrl);
        if (!msg) {
            this.emit("transcription-error", `Invalid server URL: ${healthUrl}`);
            return;
        }

        msg.request_headers.append("Authorization", `Bearer ${this.apiKey}`);

        let wsPort: number;
        try {
            const bytes = await this.session.send_and_read_async(
                msg,
                GLib.PRIORITY_DEFAULT,
                null,
            );
            const decoder = new TextDecoder("utf-8");
            const data = decoder.decode(bytes.get_data() ?? new Uint8Array());
            const health = JSON.parse(data) as WsHealthResponse;
            if (typeof health.websocket_port !== "number") {
                this.emit(
                    "transcription-error",
                    "Server did not return a WebSocket port. Check that the server supports realtime transcription.",
                );
                return;
            }
            wsPort = health.websocket_port;
            console.log(`[Transcriber] Health OK, WebSocket port: ${wsPort}`);
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error(`[Transcriber] Health request failed: ${errMsg}`);
            this.emit(
                "transcription-error",
                `Failed to contact server: ${errMsg}`,
            );
            return;
        }

        // Connect WebSocket
        const model = encodeURIComponent(this.model);
        const wsUrl = `ws://127.0.0.1:${wsPort}/realtime?model=${model}`;
        console.log(`[Transcriber] Connecting WebSocket: ${wsUrl}`);
        const wsMsg = Soup.Message.new("GET", wsUrl);
        if (!wsMsg) {
            this.emit("transcription-error", `Invalid WebSocket URL: ${wsUrl}`);
            return;
        }

        try {
            const conn = await this.session.websocket_connect_async(
                wsMsg,
                null,
                [],
                GLib.PRIORITY_DEFAULT,
                null,
            );
            this.wsConnection = conn;
            console.log(`[Transcriber] WebSocket connected to ${wsUrl}`);
            this.emit("connected");

            // Send initial session.update to configure the model
            this._sendJson({
                type: "session.update",
                session: {
                    model: this.model,
                    input_audio_format: "pcm16",
                    input_audio_transcription: {
                        model: this.model,
                    },
                    turn_detection: {
                        type: "server_vad",
                        threshold: 0.45,
                        silence_duration_ms: 450,
                        prefix_padding_ms: 300,
                    },
                },
            });

            conn.connect("message", (_conn: Soup.WebsocketConnection, _dataType: Soup.WebsocketDataType, rawData: GLib.Bytes) => {
                const raw = rawData.get_data();
                if (!raw) return;
                const text = new TextDecoder("utf-8").decode(raw);
                this._handleMessage(text);
            });

            conn.connect("closed", () => {
                console.log(`[Transcriber] WebSocket closed`);
                this.wsConnection = null;
                this.emit("disconnected");
            });

            conn.connect("error", (_conn: Soup.WebsocketConnection, err: GLib.Error) => {
                this.emit("transcription-error", err.message);
            });
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error(`[Transcriber] WebSocket connection failed: ${errMsg}`);
            this.emit(
                "transcription-error",
                `WebSocket connection failed: ${errMsg}`,
            );
        }
    }

    public appendChunk(data: GLib.Bytes): void {
        if (!this.wsConnection) return;
        const raw = data.get_data();
        if (!raw) return;
        const b64 = GLib.base64_encode(raw);
        this._sendJson({ type: "input_audio_buffer.append", audio: b64 });
    }

    public commit(): void {
        if (!this.wsConnection) return;
        this._sendJson({ type: "input_audio_buffer.commit" });
    }

    public endSession(): void {
        if (!this.wsConnection) return;
        try {
            this.wsConnection.close(Soup.WebsocketCloseCode.NORMAL, null);
        } catch (_e) {
            // ignore close errors
        }
        this.wsConnection = null;
    }

    public async transcribeFileHttp(file: Gio.File): Promise<string> {
        const client = new OpenAICompatibleClient({
            baseUrl: this.serverUrl,
            apiKey: this.apiKey,
            session: this.session,
        });
        const text = await client.transcribeFile(file, this.model);
        console.log(
            `[Transcriber] HTTP transcription (${text.length}) via OpenAI-compatible client`,
        );
        return text;
    }

    private _sendJson(obj: WsMessage | Record<string, unknown>): void {
        if (!this.wsConnection) return;
        try {
            this.wsConnection.send_text(JSON.stringify(obj));
        } catch (err) {
            this.emit(
                "transcription-error",
                `WebSocket send error: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    private _handleMessage(text: string): void {
        let msg: WsMessage;
        try {
            msg = JSON.parse(text) as WsMessage;
        } catch (_e) {
            return;
        }
        console.log(`[Transcriber] WS message type: ${msg.type}`);

        switch (msg.type) {
            case "conversation.item.input_audio_transcription.delta":
            {
                const deltaText = this._extractTranscriptionText(msg, "delta");
                if (deltaText.length > 0) {
                    console.log(
                        `[Transcriber] Delta text (${deltaText.length}): ${deltaText.slice(0, 80)}`,
                    );
                    this.emit("transcription-partial", deltaText);
                }
                break;
            }
            case "input_audio_buffer.speech_started":
                if (this.recordingStartMs !== null) {
                    this.segmentStartMs = Date.now() - this.recordingStartMs;
                }
                break;
            case "conversation.item.input_audio_transcription.completed":
            {
                const doneText = this._extractTranscriptionText(
                    msg,
                    "transcript",
                );
                if (doneText.length > 0) {
                    console.log(
                        `[Transcriber] Completed text (${doneText.length}): ${doneText.slice(0, 120)}`,
                    );
                    this.emit("transcription-done", doneText);
                    // Emit segment with timing info
                    const endMs = this.recordingStartMs !== null
                        ? Date.now() - this.recordingStartMs
                        : 0;
                    const startMs = this.segmentStartMs ?? 0;
                    this.emit("transcription-segment", startMs, endMs, doneText);
                    this.segmentStartMs = null;
                } else {
                    console.log(
                        `[Transcriber] Completed event had no transcript payload: ${text.slice(0, 200)}`,
                    );
                }
                break;
            }
            case "error":
                this.emit(
                    "transcription-error",
                    msg.error?.message ?? "Unknown transcription error",
                );
                break;
            default:
                break;
        }
    }

    private _extractTranscriptionText(
        msg: WsMessage,
        kind: "delta" | "transcript",
    ): string {
        const key = kind;
        const candidates: unknown[] = [
            msg[key],
            msg.item?.[key],
            msg.item?.text,
            msg.item?.transcript,
            msg.data?.[key],
            msg.data?.text,
            msg.data?.transcript,
            ...(msg.item?.content ?? []).flatMap((entry) => [
                entry[key],
                entry.text,
                entry.transcript,
            ]),
        ];

        for (const c of candidates) {
            if (typeof c === "string") {
                const trimmed = c.trim();
                if (trimmed.length > 0 && !NON_SPEECH_TOKEN.test(trimmed))
                    return c;
            }
        }

        return "";
    }

}

/**
 * Inject text at the current cursor position.
 * Tries ydotool, then xdotool, then falls back to clipboard + toast.
 */
export function injectText(
    text: string,
    window: Gtk.Window,
): void {
    const ydotool = GLib.find_program_in_path("ydotool");
    if (ydotool) {
        try {
            const [ok] = GLib.spawn_async(
                null,
                [ydotool, "type", "--", text],
                null,
                GLib.SpawnFlags.DEFAULT,
                null,
            );
            if (ok) return;
        } catch (_e) {
            // fall through
        }
    }

    const xdotool = GLib.find_program_in_path("xdotool");
    if (xdotool) {
        try {
            const [ok] = GLib.spawn_async(
                null,
                [xdotool, "type", "--", text],
                null,
                GLib.SpawnFlags.DEFAULT,
                null,
            );
            if (ok) return;
        } catch (_e) {
            // fall through
        }
    }

    // Fallback: copy to clipboard and show a toast
    const display = Gdk.Display.get_default();
    if (display) {
        const clipboard = display.get_clipboard();
        const enc = new TextEncoder();
        const bytes = GLib.Bytes.new(enc.encode(text));
        const contentProvider = Gdk.ContentProvider.new_for_bytes(
            "text/plain;charset=utf-8",
            bytes,
        );
        clipboard.set_content(contentProvider);
    }

    const toast = Adw.Toast.new(_("Transcription copied — press Ctrl+V to paste"));
    toast.timeout = 4;
    // If the window is an AdwApplicationWindow it will have add_toast
    if ("add_toast" in window && typeof (window as unknown as Record<string, unknown>)["add_toast"] === "function") {
        (window as unknown as { add_toast: (t: Adw.Toast) => void }).add_toast(toast);
    }
}

/**
 * Ask the OpenAI-compatible chat API to suggest a short title for a recording
 * based on its transcript. Returns a trimmed string, or throws on failure.
 */
export async function suggestTitle(
    transcript: string,
    serverUrl: string,
    apiKey: string,
): Promise<string> {
    const base = serverUrl.trim().replace(/\/+$/, "");
    // Try {base}/chat/completions first, then strip /api prefix variants
    const root = base.replace(/\/(api\/)?v1$/i, "");
    const urls = [
        `${base}/chat/completions`,
        `${root}/v1/chat/completions`,
        `${root}/chat/completions`,
    ].filter((u, i, a) => a.indexOf(u) === i);

    const bodyJson = JSON.stringify({
        messages: [
            {
                role: "system",
                content:
                    "You produce extremely short, descriptive titles for audio recordings. " +
                    "Reply with ONLY the title — no quotes, no punctuation at the end, maximum 6 words.",
            },
            {
                role: "user",
                content: `Suggest a title for this recording transcript:\n\n${transcript.slice(0, 1200)}`,
            },
        ],
        max_tokens: 24,
        temperature: 0.3,
    });

    const encoder = new TextEncoder();
    const session = new Soup.Session();

    let lastError = "No response";
    for (const url of urls) {
        const msg = Soup.Message.new("POST", url);
        if (!msg) continue;
        msg.request_headers.append("Authorization", `Bearer ${apiKey}`);
        msg.set_request_body_from_bytes(
            "application/json",
            GLib.Bytes.new(encoder.encode(bodyJson)),
        );
        try {
            const bytes = await session.send_and_read_async(
                msg,
                GLib.PRIORITY_DEFAULT,
                null,
            );
            if (msg.statusCode < 200 || msg.statusCode >= 300) {
                lastError = `HTTP ${msg.statusCode} from ${url}`;
                continue;
            }
            const decoded = new TextDecoder("utf-8").decode(
                bytes.get_data() ?? new Uint8Array(),
            );
            const resp = JSON.parse(decoded) as {
                choices?: Array<{ message?: { content?: string } }>;
            };
            const title = resp.choices?.[0]?.message?.content?.trim();
            if (title && title.length > 0) return title;
            lastError = `No title in response from ${url}`;
        } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
        }
    }
    throw new Error(lastError);
}
