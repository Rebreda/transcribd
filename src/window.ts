/* exported Window */
/*
 * Copyright 2013 Meg Ford
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public
 * License along with this library; if not, see <http://www.gnu.org/licenses/>.
 *
 * Author: Meg Ford <megford@gnome.org>
 *
 */

import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gst from "gi://Gst";
import Gtk from "gi://Gtk?version=4.0";

import { Settings } from "./application.js";
import { Recorder } from "./recorder.js";
import { RecordingList } from "./recordingList.js";
import { RecordingsListWidget } from "./recordingListWidget.js";
import { RecorderWidget } from "./recorderWidget.js";
import { Recording } from "./recording.js";
import { Row } from "./row.js";
import { TranscriberService, injectText } from "./transcriber.js";

enum WindowState {
    Empty,
    List,
    Recorder,
}

export class Window extends Adw.ApplicationWindow {
    private _mainStack!: Gtk.Stack;
    private _emptyPage!: Adw.StatusPage;
    private _column!: Adw.Clamp;
    private _toastOverlay!: Adw.ToastOverlay;
    private _toolbarView!: Adw.ToolbarView;

    private recorder: Recorder;
    private recorderWidget: RecorderWidget;
    private player: Gst.Element;
    private recordingList: RecordingList;
    private itemsSignalId: number;
    private recordingListWidget: RecordingsListWidget;

    private toastUndo: boolean;
    private undoToasts: Adw.Toast[];
    private undoSignalID: number | null;
    private undoAction: Gio.SimpleAction;

    private transcriberService: TranscriberService | null = null;
    private dictationMode = false;
    private audioChunkHandlerId: number | null = null;
    private partialHandlerId: number | null = null;
    private doneHandlerId: number | null = null;
    private errorHandlerId: number | null = null;
    private pendingTranscript = "";
    private isTranscribingRecording = false;

    private _state: WindowState;

    static {
        GObject.registerClass(
            {
                Template: "resource:///app/drey/Vocalis/ui/window.ui",
                InternalChildren: [
                    "mainStack",
                    "emptyPage",
                    "column",
                    "toastOverlay",
                    "toolbarView",
                ],
            },
            this,
        );
    }

    constructor(params: Partial<Adw.ApplicationWindow.ConstructorProps>) {
        super(params);

        this.iconName = pkg.name;
        this._state = WindowState.Empty;

        this.recorder = new Recorder();
        this.recorderWidget = new RecorderWidget(this.recorder);
        this._mainStack.add_named(this.recorderWidget, "recorder");

        const player = Gst.ElementFactory.make("playbin", "player");
        if (!player) {
            throw new Error("Failed to create playbin element");
        }
        this.player = player;

        this.recordingList = new RecordingList();
        this.itemsSignalId = this.recordingList.connect("items-changed", () => {
            if (this.state !== WindowState.Recorder) {
                if (this.recordingList.get_n_items() === 0)
                    this.state = WindowState.Empty;
                else this.state = WindowState.List;
            }
        });

        this.recordingListWidget = new RecordingsListWidget(
            this.recordingList,
            this.player,
        );

        this.recordingListWidget.connect(
            "row-deleted",
            (_listBox: Gtk.ListBox, recording: Recording, index: number) => {
                this.recordingList.remove(index);
                let message: string;
                if (recording.name) {
                    message = _('"%s" deleted').format(recording.name);
                } else {
                    message = _("Recording deleted");
                }
                this.sendNotification(message, recording, index);
            },
        );

        this.recordingListWidget.connect(
            "row-transcribe",
            (_listBox: Gtk.ListBox, recording: Recording) => {
                void this.transcribeExistingRecording(recording);
            },
        );

        this.toastUndo = false;
        this.undoSignalID = null;
        this.undoToasts = [];
        this.undoAction = new Gio.SimpleAction({ name: "undo" });
        this.add_action(this.undoAction);

        const openMenuAction = new Gio.SimpleAction({
            name: "open-primary-menu",
            state: new GLib.Variant("b", true),
        });
        openMenuAction.connect("activate", (action) => {
            const state = action.get_state()?.get_boolean();
            action.state = new GLib.Variant("b", !state);
        });
        this.add_action(openMenuAction);
        this._column.set_child(this.recordingListWidget);

        this.recorderWidget.connect(
            "started",
            this.onRecorderStarted.bind(this),
        );
        this.recorderWidget.connect(
            "canceled",
            this.onRecorderCanceled.bind(this),
        );
        this.recorderWidget.connect(
            "stopped",
            this.onRecorderStopped.bind(this),
        );
        this.insert_action_group("recorder", this.recorderWidget.actionsGroup);

        const dictateAction = new Gio.SimpleAction({ name: "dictate" });
        dictateAction.connect("activate", () => {
            this.dictationMode = true;
            this.recorderWidget.actionsGroup.activate_action("start", null);
        });
        this.recorderWidget.actionsGroup.add_action(dictateAction);

        this._emptyPage.icon_name = `${pkg.name}-symbolic`;
    }

    public override vfunc_close_request(): boolean {
        this.dismissUndoToasts();
        this.recordingList.cancellable.cancel();
        if (this.itemsSignalId)
            this.recordingList.disconnect(this.itemsSignalId);

        for (let i = 0; i < this.recordingList.get_n_items(); i++) {
            const recording = this.recordingList.get_item(i) as Recording;
            if (recording.pipeline)
                recording.pipeline.set_state(Gst.State.NULL);
        }

        this.recorder.stop();
        return false;
    }

    dismissUndoToasts() {
        this.undoToasts.forEach((toast) => toast.dismiss());
    }

    private onRecorderStarted(): void {
        this.player.set_state(Gst.State.NULL);

        const activeRow = this.recordingListWidget.activeRow;
        if (activeRow && activeRow.editMode) activeRow.editMode = false;

        this.state = WindowState.Recorder;

        if (Settings.get_boolean("transcription-enabled")) {
            this.pendingTranscript = "";
            try {
                this.transcriberService = new TranscriberService();

                this.partialHandlerId = this.transcriberService.connect(
                    "transcription-partial",
                    (_service: TranscriberService, text: string) => {
                        this.pendingTranscript += text;
                        this.recorderWidget.appendTranscription(text);
                    },
                );
                this.doneHandlerId = this.transcriberService.connect(
                    "transcription-done",
                    (_service: TranscriberService, text: string) => {
                        // Some backends provide only completed chunks, so keep this as a fallback.
                        if (text.length > 0) {
                            this.pendingTranscript +=
                                (this.pendingTranscript ? " " : "") + text;
                            this.recorderWidget.appendTranscription(
                                this.pendingTranscript.endsWith(" ")
                                    ? text
                                    : ` ${text}`,
                            );
                        }
                    },
                );
                this.errorHandlerId = this.transcriberService.connect(
                    "transcription-error",
                    (_service: TranscriberService, error: string) => {
                        const toast = Adw.Toast.new(
                            _('Transcription error: %s').format(error),
                        );
                        this._toastOverlay.add_toast(toast);
                    },
                );
                this.audioChunkHandlerId = this.recorder.connect(
                    "audio-chunk",
                    (_recorder: Recorder, chunk: GLib.Bytes) => {
                        this.transcriberService?.appendChunk(chunk);
                    },
                );

                void this.transcriberService.startSession();
            } catch (e) {
                console.error("Failed to start transcription session:", e);
                this.transcriberService = null;
            }
        }
    }

    private onRecorderCanceled(): void {
        this._cleanupTranscriberService();
        this.dictationMode = false;
        if (this.recordingList.get_n_items() === 0)
            this.state = WindowState.Empty;
        else this.state = WindowState.List;
    }

    private onRecorderStopped(
        _widget: RecorderWidget,
        recording: Recording,
    ): void {
        const isDictation = this.dictationMode;
        const finalTranscript =
            this.pendingTranscript.trim() ||
            this.recorderWidget.consumeTranscription().trim();
        this._cleanupTranscriberService();
        this.dictationMode = false;

        if (finalTranscript) {
            console.log(
                `[Window] Saving live transcript (${finalTranscript.length} chars) for ${recording.name}`,
            );
            void recording.saveTranscription(finalTranscript);
            if (isDictation) {
                injectText(finalTranscript, this);
            }
        } else {
            console.log("[Window] No live transcript text to save on stop");
        }

        this.recordingList.insert(0, recording);
        const row = this.recordingListWidget.list.get_row_at_index(0) as Row;
        row.editMode = true;
        this.state = WindowState.List;
    }

    private _cleanupTranscriberService(): void {
        if (this.audioChunkHandlerId !== null) {
            this.recorder.disconnect(this.audioChunkHandlerId);
            this.audioChunkHandlerId = null;
        }
        if (this.transcriberService) {
            const service = this.transcriberService;
            this.transcriberService = null;
            if (this.partialHandlerId !== null) {
                this._safeDisconnect(service, this.partialHandlerId);
                this.partialHandlerId = null;
            }
            if (this.doneHandlerId !== null) {
                this._safeDisconnect(service, this.doneHandlerId);
                this.doneHandlerId = null;
            }
            if (this.errorHandlerId !== null) {
                this._safeDisconnect(service, this.errorHandlerId);
                this.errorHandlerId = null;
            }
            service.commit();
            service.endSession();
        }
        this.pendingTranscript = "";
    }

    private _safeDisconnect(obj: GObject.Object, id: number): void {
        if (id <= 0) return;
        try {
            if (GObject.signal_handler_is_connected(obj, id)) {
                obj.disconnect(id);
            }
        } catch (_err) {
            // Ignore stale handler IDs.
        }
    }

    private _wait(ms: number): Promise<void> {
        return new Promise((resolve) => {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                resolve();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    private _streamRecordingAudio(
        recording: Recording,
        onChunk: (chunk: GLib.Bytes) => void,
    ): Promise<void> {
        const pipeline = Gst.parse_launch(
            "uridecodebin name=src ! audioconvert ! audioresample ! audio/x-raw,format=S16LE,rate=16000,channels=1 ! appsink name=file-transcription-sink sync=false async=false max-buffers=200 drop=true",
        ) as Gst.Pipeline;

        const src = pipeline.get_by_name("src");
        src?.set_property("uri", recording.uri);

        const appsink = pipeline.get_by_name("file-transcription-sink");
        if (!appsink) {
            pipeline.set_state(Gst.State.NULL);
            throw new Error("Failed to create appsink for file transcription");
        }

        const bus = pipeline.get_bus();

        return new Promise((resolve, reject) => {
            let settled = false;
            let pollId: number | null = null;
            let busHandlerId: number | null = null;

            const cleanup = () => {
                if (pollId !== null) {
                    GLib.source_remove(pollId);
                    pollId = null;
                }
                if (bus && busHandlerId !== null) {
                    bus.disconnect(busHandlerId);
                    bus.remove_signal_watch();
                    busHandlerId = null;
                }
                pipeline.set_state(Gst.State.NULL);
            };

            const finishOk = () => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve();
            };

            const finishErr = (err: string) => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(new Error(err));
            };

            if (bus) {
                bus.add_signal_watch();
                busHandlerId = bus.connect(
                    "message",
                    (_bus: Gst.Bus, message: Gst.Message) => {
                        switch (message.type) {
                            case Gst.MessageType.EOS:
                                finishOk();
                                break;
                            case Gst.MessageType.ERROR:
                                finishErr(message.parse_error().toString());
                                break;
                            default:
                                break;
                        }
                    },
                );
            }

            pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
                const sample = appsink.emit("try-pull-sample", 0) as unknown as
                    | Gst.Sample
                    | null;
                if (!sample) return GLib.SOURCE_CONTINUE;

                const buffer = sample.get_buffer();
                if (!buffer) return GLib.SOURCE_CONTINUE;

                const [ok, mapInfo] = buffer.map(Gst.MapFlags.READ);
                if (ok) {
                    const chunkBytes = GLib.Bytes.new(
                        mapInfo.data as unknown as Uint8Array,
                    );
                    onChunk(chunkBytes);
                    buffer.unmap(mapInfo);
                }

                return GLib.SOURCE_CONTINUE;
            });

            const result = pipeline.set_state(Gst.State.PLAYING);
            if (result === Gst.StateChangeReturn.FAILURE) {
                finishErr("Failed to start decode pipeline for transcription");
            }
        });
    }

    private async transcribeExistingRecording(recording: Recording): Promise<void> {
        if (this.isTranscribingRecording) {
            this._toastOverlay.add_toast(
                Adw.Toast.new(_("A transcription job is already running")),
            );
            return;
        }

        this.isTranscribingRecording = true;
        this._toastOverlay.add_toast(
            Adw.Toast.new(_("Transcribing recording…")),
        );

        const service = new TranscriberService();
        let combinedText = "";
        let partialId: number | null = null;
        let doneId: number | null = null;
        let errorId: number | null = null;

        try {
            partialId = service.connect(
                "transcription-partial",
                (_service: TranscriberService, text: string) => {
                    combinedText += text;
                },
            );

            doneId = service.connect(
                "transcription-done",
                (_service: TranscriberService, text: string) => {
                    if (text.length > 0)
                        combinedText += (combinedText ? " " : "") + text;
                },
            );

            errorId = service.connect(
                "transcription-error",
                (_service: TranscriberService, error: string) => {
                    this._toastOverlay.add_toast(
                        Adw.Toast.new(
                            _('Transcription error: %s').format(error),
                        ),
                    );
                },
            );

            await service.startSession();
            await this._streamRecordingAudio(recording, (chunk) => {
                service.appendChunk(chunk);
            });

            service.commit();
            await this._wait(1200);
            service.endSession();

            const text = combinedText.trim();
            if (text.length > 0) {
                console.log(
                    `[Window] Saving file transcription (${text.length} chars) for ${recording.name}`,
                );
                await recording.saveTranscription(text);
                this._toastOverlay.add_toast(
                    Adw.Toast.new(_("Transcription saved")),
                );
            } else {
                this._toastOverlay.add_toast(
                    Adw.Toast.new(
                        _("Transcription completed, but no text was returned"),
                    ),
                );
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._toastOverlay.add_toast(
                Adw.Toast.new(_('Transcription failed: %s').format(msg)),
            );
        } finally {
            if (partialId !== null) this._safeDisconnect(service, partialId);
            if (doneId !== null) this._safeDisconnect(service, doneId);
            if (errorId !== null) this._safeDisconnect(service, errorId);
            service.endSession();
            this.isTranscribingRecording = false;
        }
    }

    private sendNotification(
        message: string,
        recording: Recording,
        index: number,
    ): void {
        const toast = Adw.Toast.new(message);
        toast.connect("dismissed", () => {
            if (!this.toastUndo) void recording.delete();

            this.toastUndo = false;
            this.undoToasts = this.undoToasts.filter(
                (undoToast) => undoToast.title !== toast.title,
            );
        });

        if (this.undoSignalID !== null)
            this.undoAction.disconnect(this.undoSignalID);

        this.undoSignalID = this.undoAction.connect("activate", () => {
            this.recordingList.insert(index, recording);
            this.toastUndo = true;
        });

        toast.set_action_name("win.undo");
        toast.set_button_label(_("Undo"));
        this._toastOverlay.add_toast(toast);
        this.undoToasts.push(toast);
    }

    public set state(state: WindowState) {
        let visibleChild: string;
        let isHeaderVisible = true;

        switch (state) {
            case WindowState.Recorder:
                visibleChild = "recorder";
                isHeaderVisible = false;
                break;
            case WindowState.List:
                visibleChild = "recordings";
                break;
            case WindowState.Empty:
                visibleChild = "empty";
                break;
        }

        this._mainStack.visible_child_name = visibleChild;
        this._toolbarView.reveal_top_bars = isHeaderVisible;
        this._state = state;
    }

    public get state(): WindowState {
        return this._state;
    }
}
