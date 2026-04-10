import Adw from "gi://Adw";
import Gdk from "gi://Gdk?version=4.0";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk?version=4.0";
import Soup from "gi://Soup?version=3.0";

import { Settings } from "./application.js";

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
}

export class TranscriberService extends GObject.Object {
    private session: Soup.Session;
    private wsConnection: Soup.WebsocketConnection | null = null;


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
        } catch (err) {
            this.emit(
                "transcription-error",
                `Failed to contact server: ${err instanceof Error ? err.message : String(err)}`,
            );
            return;
        }

        // Connect WebSocket
        const model = encodeURIComponent(this.model);
        const wsUrl = `ws://127.0.0.1:${wsPort}/realtime?model=${model}`;
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
            this.emit("connected");

            // Send initial session.update to configure the model
            this._sendJson({
                type: "session.update",
                session: {
                    model: this.model,
                    turn_detection: {
                        threshold: 0.01,
                        silence_duration_ms: 800,
                        prefix_padding_ms: 250,
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
                this.wsConnection = null;
                this.emit("disconnected");
            });

            conn.connect("error", (_conn: Soup.WebsocketConnection, err: GLib.Error) => {
                this.emit("transcription-error", err.message);
            });
        } catch (err) {
            this.emit(
                "transcription-error",
                `WebSocket connection failed: ${err instanceof Error ? err.message : String(err)}`,
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

        switch (msg.type) {
            case "conversation.item.input_audio_transcription.delta":
                if (msg.delta) this.emit("transcription-partial", msg.delta);
                break;
            case "conversation.item.input_audio_transcription.completed":
                if (msg.transcript)
                    this.emit("transcription-done", msg.transcript);
                break;
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
