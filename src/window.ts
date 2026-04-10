/* exported Window */
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
import { RecordingDetailView } from "./detailView.js";
import { Recording, TranscriptionSegment } from "./recording.js";
import {
    suggestCategory,
    TranscriberService,
    injectText,
    suggestCategoryFallback,
    suggestTitle,
    suggestTitleFallback,
} from "./transcriber.js";

export class Window extends Adw.ApplicationWindow {
    private _toastOverlay!: Adw.ToastOverlay;
    private _sidebarContent!: Gtk.Box;
    private _contentStack!: Gtk.Stack;
    private _detailContainer!: Gtk.Box;
    private _recorderContainer!: Gtk.Box;
    private _emptyPage!: Adw.StatusPage;
    private _searchEntry!: Gtk.SearchEntry;

    private recorder: Recorder;
    private recorderWidget: RecorderWidget;
    private player: Gst.Element;
    private recordingList: RecordingList;
    private itemsSignalId: number;
    private recordingListWidget: RecordingsListWidget;
    private detailView: RecordingDetailView;

    private toastUndo = false;
    private undoToasts: Adw.Toast[] = [];
    private undoSignalID: number | null = null;
    private undoAction: Gio.SimpleAction;

    private transcriberService: TranscriberService | null = null;
    private dictationMode = false;
    private audioChunkHandlerId: number | null = null;
    private partialHandlerId: number | null = null;
    private doneHandlerId: number | null = null;
    private errorHandlerId: number | null = null;
    private segmentHandlerId: number | null = null;
    private pendingTranscript = "";
    private pendingSegments: TranscriptionSegment[] = [];
    private isTranscribingRecording = false;

    static {
        GObject.registerClass(
            {
                Template: "resource:///app/rebreda/Transcribd/ui/window.ui",
                InternalChildren: [
                    "toastOverlay",
                    "sidebarContent",
                    "contentStack",
                    "detailContainer",
                    "recorderContainer",
                    "emptyPage",
                    "searchEntry",
                ],
            },
            this,
        );
    }

    constructor(params: Partial<Adw.ApplicationWindow.ConstructorProps>) {
        super(params);

        this.iconName = pkg.name;

        // Player
        const player = Gst.ElementFactory.make("playbin", "player");
        if (!player) {
            throw new Error("Failed to create playbin element");
        }
        this.player = player;

        // Recorder
        this.recorder = new Recorder();
        this.recorderWidget = new RecorderWidget(this.recorder);
        this._recorderContainer.append(this.recorderWidget);

        // Recording list model
        this.recordingList = new RecordingList();
        this.itemsSignalId = this.recordingList.connect("items-changed", () => {
            this._updateEmpty();
        });

        // Sidebar list widget
        this.recordingListWidget = new RecordingsListWidget(this.recordingList);
        this._sidebarContent.append(this.recordingListWidget);

        // Detail view
        this.detailView = new RecordingDetailView(this.player);
        this._detailContainer.append(this.detailView);

        // Undo action
        this.undoAction = new Gio.SimpleAction({ name: "undo" });
        this.add_action(this.undoAction);

        // Open primary menu action (for menu button binding)
        const openMenuAction = new Gio.SimpleAction({
            name: "open-primary-menu",
            state: new GLib.Variant("b", true),
        });
        openMenuAction.connect("activate", (action) => {
            const state = action.get_state()?.get_boolean();
            action.state = new GLib.Variant("b", !state);
        });
        this.add_action(openMenuAction);

        // Search
        this._searchEntry.connect("search-changed", (_entry: Gtk.SearchEntry) => {
            this.recordingListWidget.filterBySearch(
                this._searchEntry.get_text(),
            );
        });

        // Row selection → show detail
        this.recordingListWidget.connect(
            "row-selected",
            (_widget: RecordingsListWidget, recording: Recording) => {
                this.detailView.recording = recording;
                this._contentStack.visible_child_name = "detail";
            },
        );

        // Row deleted from detail view
        this.detailView.connect(
            "deleted",
            (_view: RecordingDetailView, recording: Recording) => {
                this._deleteRecording(recording);
            },
        );

        // Row deleted from list (row swipe/right-click if exposed)
        this.recordingListWidget.connect(
            "row-deleted",
            (_widget: RecordingsListWidget, recording: Recording, index: number) => {
                this.recordingList.remove(index);
                if (this.detailView.recording === recording) {
                    this.detailView.recording = null;
                    this._updateEmpty();
                }
                this._sendDeleteToast(recording, index);
            },
        );

        // Transcribe from detail view
        this.detailView.connect(
            "transcribe",
            (_view: RecordingDetailView, recording: Recording) => {
                void this.transcribeExistingRecording(recording);
            },
        );

        // Recorder signals
        this.recorderWidget.connect("started", this._onRecorderStarted.bind(this));
        this.recorderWidget.connect("canceled", this._onRecorderCanceled.bind(this));
        this.recorderWidget.connect("stopped", this._onRecorderStopped.bind(this));
        this.insert_action_group("recorder", this.recorderWidget.actionsGroup);

        // Dictate action
        const dictateAction = new Gio.SimpleAction({ name: "dictate" });
        dictateAction.connect("activate", () => {
            this.dictationMode = true;
            this.recorderWidget.actionsGroup.activate_action("start", null);
        });
        this.recorderWidget.actionsGroup.add_action(dictateAction);

        this._emptyPage.icon_name = `${pkg.name}-symbolic`;
        this._updateEmpty();
    }

    public override vfunc_close_request(): boolean {
        this.dismissUndoToasts();
        this.recordingList.cancellable.cancel();
        if (this.itemsSignalId) {
            this.recordingList.disconnect(this.itemsSignalId);
        }
        this.player.set_state(Gst.State.NULL);
        for (let i = 0; i < this.recordingList.get_n_items(); i++) {
            const recording = this.recordingList.get_item(i) as Recording;
            if (recording.pipeline) recording.pipeline.set_state(Gst.State.NULL);
        }
        this.recorder.stop();
        this.detailView.cleanup();
        return false;
    }

    private _updateEmpty(): void {
        // Only switch to empty when we're not in recorder mode
        if (this._contentStack.visible_child_name === "recorder") return;
        if (
            this.recordingList.get_n_items() === 0 &&
            this._contentStack.visible_child_name !== "detail"
        ) {
            this._contentStack.visible_child_name = "empty";
        } else if (this.recordingList.get_n_items() === 0) {
            this._contentStack.visible_child_name = "empty";
            this.detailView.recording = null;
        }
    }

    dismissUndoToasts(): void {
        this.undoToasts.forEach((toast) => toast.dismiss());
    }

    private _onRecorderStarted(): void {
        this.player.set_state(Gst.State.NULL);
        this._contentStack.visible_child_name = "recorder";

        if (Settings.get_boolean("transcription-enabled")) {
            this.pendingTranscript = "";
            this.pendingSegments = [];
            try {
                this.transcriberService = new TranscriberService();
                this.transcriberService.setRecordingStart(Date.now());

                this.partialHandlerId = this.transcriberService.connect(
                    "transcription-partial",
                    (_service: TranscriberService, text: string) => {
                        this.pendingTranscript = this._appendTranscriptChunk(
                            this.pendingTranscript,
                            text,
                        );
                        this.recorderWidget.appendTranscription(text);
                    },
                );
                this.doneHandlerId = this.transcriberService.connect(
                    "transcription-done",
                    (_service: TranscriberService, text: string) => {
                        if (text.length > 0) {
                            const before = this.pendingTranscript;
                            this.pendingTranscript = this._appendTranscriptChunk(
                                this.pendingTranscript,
                                text,
                            );
                            if (this.pendingTranscript !== before) {
                                const withSpace = before.length > 0 ? ` ${text}` : text;
                                this.recorderWidget.appendTranscription(withSpace);
                            }
                        }
                    },
                );
                this.segmentHandlerId = this.transcriberService.connect(
                    "transcription-segment",
                    (
                        _service: TranscriberService,
                        startMs: number,
                        endMs: number,
                        text: string,
                    ) => {
                        this.pendingSegments.push({ startMs, endMs, text });
                    },
                );
                this.errorHandlerId = this.transcriberService.connect(
                    "transcription-error",
                    (_service: TranscriberService, error: string) => {
                        this._toastOverlay.add_toast(
                            Adw.Toast.new(_("Transcription error: %s").format(error)),
                        );
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

    private _onRecorderCanceled(): void {
        this._cleanupTranscriberService();
        this.dictationMode = false;
        this._contentStack.visible_child_name =
            this.recordingList.get_n_items() > 0 ? "empty" : "empty";
        this._updateEmpty();
    }

    private async _onRecorderStopped(
        _widget: RecorderWidget,
        recording: Recording,
    ): Promise<void> {
        const isDictation = this.dictationMode;
        await this._flushRealtimeTranscription();
        const finalTranscript =
            this.pendingTranscript.trim() ||
            this.recorderWidget.consumeTranscription().trim();
        const segments = [...this.pendingSegments];
        this._cleanupTranscriberService();
        this.dictationMode = false;

        if (finalTranscript) {
            console.log(
                `[Window] Saving live transcript (${finalTranscript.length} chars) for ${recording.name}`,
            );
            void recording.saveTranscription(finalTranscript);
            void this._autoAnnotateRecording(recording, finalTranscript);
            if (isDictation) injectText(finalTranscript, this);
        }

        if (segments.length > 0) {
            void recording.saveSegments(segments);
        }

        this.recordingList.insert(0, recording);

        // Show the new recording in detail view
        this.detailView.recording = recording;
        this._contentStack.visible_child_name = "detail";

        // Select the row in the sidebar
        const row = this.recordingListWidget.list.get_row_at_index(0);
        if (row) {
            this.recordingListWidget.list.select_row(row);
        }
    }

    private _cleanupTranscriberService(): void {
        if (this.audioChunkHandlerId !== null) {
            this.recorder.disconnect(this.audioChunkHandlerId);
            this.audioChunkHandlerId = null;
        }
        if (this.transcriberService) {
            const service = this.transcriberService;
            this.transcriberService = null;
            for (const id of [
                this.partialHandlerId,
                this.doneHandlerId,
                this.errorHandlerId,
                this.segmentHandlerId,
            ]) {
                if (id !== null) {
                    this._safeDisconnect(service, id);
                }
            }
            this.partialHandlerId = null;
            this.doneHandlerId = null;
            this.errorHandlerId = null;
            this.segmentHandlerId = null;
            service.endSession();
        }
        this.pendingTranscript = "";
        this.pendingSegments = [];
    }

    private async _flushRealtimeTranscription(): Promise<void> {
        const service = this.transcriberService;
        if (!service) return;

        await new Promise<void>((resolve) => {
            let resolved = false;
            const tempIds: number[] = [];

            const finish = (): void => {
                if (resolved) return;
                resolved = true;
                if (timeoutId > 0) GLib.source_remove(timeoutId);
                for (const id of tempIds) {
                    this._safeDisconnect(service, id);
                }
                resolve();
            };

            const timeoutId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                1500,
                () => {
                    finish();
                    return GLib.SOURCE_REMOVE;
                },
            );

            tempIds.push(service.connect("transcription-done", () => finish()));
            tempIds.push(service.connect("transcription-error", () => finish()));

            service.commit();
        });
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

    private _appendTranscriptChunk(existing: string, chunk: string): string {
        const next = chunk.trim();
        if (next.length === 0) return existing;
        const existingTrimmed = existing.trimEnd();
        if (existingTrimmed.endsWith(next)) return existing;
        if (existing.length === 0) return next;
        return `${existing} ${next}`;
    }

    private _deleteRecording(recording: Recording): void {
        let idx = -1;
        for (let i = 0; i < this.recordingList.get_n_items(); i++) {
            if (this.recordingList.get_item(i) === recording) {
                idx = i;
                break;
            }
        }
        if (idx < 0) return;
        this.recordingList.remove(idx);
        this.detailView.recording = null;
        this._updateEmpty();
        this._sendDeleteToast(recording, idx);
    }

    private async transcribeExistingRecording(
        recording: Recording,
    ): Promise<void> {
        if (this.isTranscribingRecording) {
            this._toastOverlay.add_toast(
                Adw.Toast.new(_("A transcription job is already running")),
            );
            return;
        }

        this.isTranscribingRecording = true;
        this._toastOverlay.add_toast(Adw.Toast.new(_("Transcribing recording…")));

        const service = new TranscriberService();
        try {
            const result = await service.transcribeFileHttp(recording.file);
            const text = result.text.trim();
            if (text.length > 0) {
                await recording.saveTranscription(text);
                if (result.segments.length > 0) {
                    await recording.saveSegments(result.segments);
                }
                await this._autoAnnotateRecording(recording, text);
                this._toastOverlay.add_toast(
                    Adw.Toast.new(_("Transcription saved")),
                );
            } else {
                this._toastOverlay.add_toast(
                    Adw.Toast.new(
                        _("Transcription completed, but speech was not detected"),
                    ),
                );
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._toastOverlay.add_toast(
                Adw.Toast.new(_("Transcription failed: %s").format(msg)),
            );
        } finally {
            this.isTranscribingRecording = false;
        }
    }

    private async _autoAnnotateRecording(
        recording: Recording,
        transcript: string,
    ): Promise<void> {
        if (!Settings.get_boolean("transcription-enabled")) return;

        if (/^Recording \d+$/.test(recording.name ?? "")) {
            try {
                const title = await suggestTitle(
                    transcript,
                    Settings.get_string("inference-server-url"),
                    Settings.get_string("inference-api-key"),
                    Settings.get_string("inference-model"),
                );
                const clean = title
                    .replace(/^["']|["']$/g, "")
                    .replace(/\.$/, "")
                    .trim();
                if (clean.length > 0 && /^Recording \d+$/.test(recording.name ?? "")) {
                    recording.name = clean;
                }
            } catch (e) {
                console.error(
                    "[Window] Auto-name failed:",
                    e instanceof Error ? e.message : String(e),
                );
                const fallbackTitle = suggestTitleFallback(transcript);
                if (fallbackTitle.length > 0 && /^Recording \d+$/.test(recording.name ?? "")) {
                    recording.name = fallbackTitle;
                }
            }
        }

        if ((recording.category ?? "").trim().length === 0) {
            try {
                const category = await suggestCategory(
                    transcript,
                    Settings.get_string("inference-server-url"),
                    Settings.get_string("inference-api-key"),
                    Settings.get_string("inference-model"),
                );
                const cleanCategory = category
                    .replace(/^["']|["']$/g, "")
                    .replace(/\.$/, "")
                    .trim();
                if (cleanCategory.length > 0) {
                    await recording.saveCategory(cleanCategory);
                    return;
                }
            } catch (_e) {
                const fallbackCategory = suggestCategoryFallback(transcript);
                if (fallbackCategory.length > 0) {
                    await recording.saveCategory(fallbackCategory);
                }
            }
        }
    }

    private _sendDeleteToast(recording: Recording, index: number): void {
        const message = recording.name
            ? _('"%s" deleted').format(recording.name)
            : _("Recording deleted");
        const toast = Adw.Toast.new(message);

        toast.connect("dismissed", () => {
            if (!this.toastUndo) void recording.delete();
            this.toastUndo = false;
            this.undoToasts = this.undoToasts.filter((t) => t !== toast);
        });

        if (this.undoSignalID !== null) {
            this.undoAction.disconnect(this.undoSignalID);
        }
        this.undoSignalID = this.undoAction.connect("activate", () => {
            this.recordingList.insert(index, recording);
            this.toastUndo = true;
        });

        toast.set_action_name("win.undo");
        toast.set_button_label(_("Undo"));
        this._toastOverlay.add_toast(toast);
        this.undoToasts.push(toast);
    }
}
