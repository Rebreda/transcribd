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
    suggestMetadata,
    TranscriberService,
    injectText,
    suggestCategoryFallback,
    suggestTagsFallback,
    suggestSpeakersFallback,
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
    private _filtersButton!: Gtk.MenuButton;
    private _categoryFiltersBox!: Gtk.Box;
    private _tagFiltersBox!: Gtk.Box;
    private _speakerFiltersBox!: Gtk.Box;
    private _dateFilterDropdown!: Gtk.DropDown;
    private _sortDropdown!: Gtk.DropDown;
    private _clearFiltersBtn!: Gtk.Button;
    private _sidebarLoadingRevealer!: Gtk.Revealer;
    private _sidebarLoadingLabel!: Gtk.Label;

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
    private recorderPeakHandlerId: number | null = null;
    private partialHandlerId: number | null = null;
    private doneHandlerId: number | null = null;
    private errorHandlerId: number | null = null;
    private segmentHandlerId: number | null = null;
    private liveCommitTimerId: number | null = null;
    private lastSpeechActivityMs = 0;
    private currentSpeechSegmentStartedMs = 0;
    private speechPeakCountSinceSegment = 0;
    private speechCaptureActive = false;
    private queuedSpeechChunks = 0;
    private prerollChunks: GLib.Bytes[] = [];
    private pendingTranscript = "";
    private pendingSegments: TranscriptionSegment[] = [];
    private isTranscribingRecording = false;
    private selectedCategoryFilters = new Set<string>();
    private selectedTagFilters = new Set<string>();
    private selectedSpeakerFilters = new Set<string>();

    static {
        GObject.registerClass(
            {
                Template: "resource:///io/github/rebreda/Transcribd/ui/window.ui",
                InternalChildren: [
                    "toastOverlay",
                    "sidebarContent",
                    "contentStack",
                    "detailContainer",
                    "recorderContainer",
                    "emptyPage",
                    "searchEntry",
                    "filtersButton",
                    "categoryFiltersBox",
                    "tagFiltersBox",
                    "speakerFiltersBox",
                    "dateFilterDropdown",
                    "sortDropdown",
                    "clearFiltersBtn",
                    "sidebarLoadingRevealer",
                    "sidebarLoadingLabel",
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
            this._rebuildFilterOptions();
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

        this._dateFilterDropdown.model = Gtk.StringList.new([
            _("All Dates"),
            _("Today"),
            _("Last 7 Days"),
            _("Last 30 Days"),
            _("Last 12 Months"),
        ]);
        this._sortDropdown.model = Gtk.StringList.new([
            _("Newest First"),
            _("Oldest First"),
            _("Title A-Z"),
            _("Title Z-A"),
            _("Category A-Z"),
        ]);

        // Search
        this._searchEntry.connect("search-changed", (_entry: Gtk.SearchEntry) => {
            this.recordingListWidget.filterBySearch(
                this._searchEntry.get_text(),
            );
            this._updateFilterAffordance();
        });
        this._dateFilterDropdown.connect("notify::selected", () => {
            const modes = ["all", "today", "week", "month", "year"] as const;
            this.recordingListWidget.filterByDate(
                modes[this._dateFilterDropdown.get_selected()] ?? "all",
            );
            this._updateFilterAffordance();
        });
        this._sortDropdown.connect("notify::selected", () => {
            const modes = [
                "newest",
                "oldest",
                "name-asc",
                "name-desc",
                "category-asc",
            ] as const;
            this.recordingListWidget.sortBy(
                modes[this._sortDropdown.get_selected()] ?? "newest",
            );
        });
        this._clearFiltersBtn.connect("clicked", () => {
            this._searchEntry.set_text("");
            this.selectedCategoryFilters.clear();
            this.selectedTagFilters.clear();
            this.selectedSpeakerFilters.clear();
            this._dateFilterDropdown.set_selected(0);
            this._sortDropdown.set_selected(0);
            this.recordingListWidget.filterBySearch("");
            this.recordingListWidget.setValueFilters({});
            this.recordingListWidget.filterByDate("all");
            this.recordingListWidget.sortBy("newest");
            this._rebuildFilterOptions();
            this._updateFilterAffordance();
        });
        this.recordingListWidget.connect(
            "loading-state-changed",
            (
                _widget: RecordingsListWidget,
                loading: boolean,
                message: string,
            ) => {
                this._sidebarLoadingRevealer.reveal_child = loading;
                this._sidebarLoadingLabel.label = message;
            },
        );

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
        this.detailView.connect("recording-updated", () => {
            this.recordingListWidget.refresh();
        });

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
        this._rebuildFilterOptions();
        this._updateFilterAffordance();
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
            this.lastSpeechActivityMs = 0;
            this.currentSpeechSegmentStartedMs = 0;
            this.speechPeakCountSinceSegment = 0;
            this.speechCaptureActive = false;
            this.queuedSpeechChunks = 0;
            this.prerollChunks = [];
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
                        this._queueRealtimeChunk(chunk);
                    },
                );
                this.recorderPeakHandlerId = this.recorder.connect(
                    "notify::current-peak",
                    (recorder: Recorder) => {
                        if (recorder.current_peak >= this._speechThreshold()) {
                            this.lastSpeechActivityMs = Date.now();
                            this.speechPeakCountSinceSegment += 1;
                            if (
                                !this.speechCaptureActive &&
                                this.speechPeakCountSinceSegment >= 3
                            ) {
                                this._startRealtimeSpeechSegment();
                            }
                        }
                    },
                );

                this._startRealtimeCommitTimer();

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
            void this._autoAnnotateRecording(recording, finalTranscript).catch((err) => {
                console.error(
                    "[Window] Auto-annotate failed:",
                    err instanceof Error ? err.message : String(err),
                );
            });
            if (isDictation) injectText(finalTranscript, this);
            this.recordingListWidget.refresh();
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
        this._stopRealtimeCommitTimer();
        if (this.audioChunkHandlerId !== null) {
            this.recorder.disconnect(this.audioChunkHandlerId);
            this.audioChunkHandlerId = null;
        }
        if (this.recorderPeakHandlerId !== null) {
            this.recorder.disconnect(this.recorderPeakHandlerId);
            this.recorderPeakHandlerId = null;
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
        this.lastSpeechActivityMs = 0;
        this.currentSpeechSegmentStartedMs = 0;
        this.speechPeakCountSinceSegment = 0;
        this.speechCaptureActive = false;
        this.queuedSpeechChunks = 0;
        this.prerollChunks = [];
    }

    private _speechThreshold(): number {
        const threshold = Settings.get_double("transcription-speech-threshold");
        return Math.max(0.001, Math.min(0.5, threshold));
    }

    private _startRealtimeCommitTimer(): void {
        this._stopRealtimeCommitTimer();
        this.liveCommitTimerId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            250,
            () => {
                if (!this.speechCaptureActive) {
                    return GLib.SOURCE_CONTINUE;
                }

                const now = Date.now();
                const silenceMs = this.lastSpeechActivityMs > 0
                    ? now - this.lastSpeechActivityMs
                    : Number.POSITIVE_INFINITY;
                const segmentAgeMs = this.currentSpeechSegmentStartedMs > 0
                    ? now - this.currentSpeechSegmentStartedMs
                    : 0;
                const shouldCommit = this.queuedSpeechChunks > 0 && (
                    silenceMs >= 900 || segmentAgeMs >= 7000
                );

                if (shouldCommit) {
                    this._commitRealtimeSpeechSegment();
                }
                return GLib.SOURCE_CONTINUE;
            },
        );
    }

    private _stopRealtimeCommitTimer(): void {
        if (this.liveCommitTimerId !== null) {
            GLib.source_remove(this.liveCommitTimerId);
            this.liveCommitTimerId = null;
        }
    }

    private async _flushRealtimeTranscription(): Promise<void> {
        const service = this.transcriberService;
        if (!service) return;

        if (this.queuedSpeechChunks > 0) {
            this._commitRealtimeSpeechSegment();
        }

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

            if (this.queuedSpeechChunks > 0) {
                service.commit();
            } else {
                finish();
            }
        });
    }

    private _queueRealtimeChunk(chunk: GLib.Bytes): void {
        this.prerollChunks.push(chunk);
        if (this.prerollChunks.length > 15) {
            this.prerollChunks.shift();
        }

        if (!this.speechCaptureActive) {
            return;
        }

        this.transcriberService?.appendChunk(chunk);
        this.queuedSpeechChunks += 1;
    }

    private _startRealtimeSpeechSegment(): void {
        if (this.speechCaptureActive) {
            return;
        }

        this.speechCaptureActive = true;
        this.currentSpeechSegmentStartedMs = Date.now();
        this.queuedSpeechChunks = 0;

        for (const chunk of this.prerollChunks) {
            this.transcriberService?.appendChunk(chunk);
            this.queuedSpeechChunks += 1;
        }
    }

    private _commitRealtimeSpeechSegment(): void {
        if (!this.speechCaptureActive || this.queuedSpeechChunks === 0) {
            return;
        }

        this.transcriberService?.commit();
        this.speechCaptureActive = false;
        this.currentSpeechSegmentStartedMs = 0;
        this.speechPeakCountSinceSegment = 0;
        this.queuedSpeechChunks = 0;
        this.prerollChunks = [];
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
        if (this.detailView.recording === recording) {
            this.detailView.setTranscriptionBusy(true, _("Transcribing recording…"));
        }
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
                this.recordingListWidget.refresh();
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
            if (this.detailView.recording === recording) {
                this.detailView.setTranscriptionBusy(false);
            }
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
                    try {
                        recording.name = clean;
                    } catch (renameErr) {
                        console.error(
                            "[Window] Auto-name rename failed:",
                            renameErr instanceof Error ? renameErr.message : String(renameErr),
                        );
                    }
                }
            } catch (e) {
                const fallbackTitle = suggestTitleFallback(transcript);
                if (fallbackTitle.length > 0 && /^Recording \d+$/.test(recording.name ?? "")) {
                    try {
                        recording.name = fallbackTitle;
                    } catch (renameErr) {
                        console.log(
                            "[Window] Fallback auto-name skipped:",
                            renameErr instanceof Error ? renameErr.message : String(renameErr),
                        );
                    }
                }
            }
        }

        const categoryMissing = (recording.category ?? "").trim().length === 0;
        const tagsMissing = recording.tags.length === 0;
        const speakersMissing = recording.speakers.length === 0;

        if (categoryMissing || tagsMissing || speakersMissing) {
            try {
                const metadata = await suggestMetadata(
                    transcript,
                    Settings.get_string("inference-server-url"),
                    Settings.get_string("inference-api-key"),
                    Settings.get_string("inference-model"),
                    this._collectDistinctValues("category"),
                    this._collectDistinctValues("tags"),
                );
                const cleanCategory = metadata.category
                    .replace(/^["']|["']$/g, "")
                    .replace(/\.$/, "")
                    .trim();
                const cleanTags = metadata.tags
                    .map((tag) => tag.replace(/^["']|["']$/g, "").trim())
                    .filter((tag) => tag.length > 0);
                const cleanSpeakers = metadata.speakers
                    .map((speaker) => speaker.replace(/^["']|["']$/g, "").trim())
                    .filter((speaker) => speaker.length > 0);

                if (categoryMissing && cleanCategory.length > 0) {
                    await recording.saveCategory(cleanCategory);
                }
                if (tagsMissing && cleanTags.length > 0) {
                    await recording.saveTags(cleanTags);
                }
                if (speakersMissing && cleanSpeakers.length > 0) {
                    await recording.saveSpeakers(cleanSpeakers);
                }
                this.recordingListWidget.refresh();
                this._rebuildFilterOptions();
                return;
            } catch (categoryErr) {
                try {
                    const fallbackCategory = suggestCategoryFallback(transcript);
                    const fallbackTags = suggestTagsFallback(transcript);
                    const fallbackSpeakers = suggestSpeakersFallback(transcript);
                    if (categoryMissing && fallbackCategory.length > 0) {
                        await recording.saveCategory(fallbackCategory);
                    }
                    if (tagsMissing && fallbackTags.length > 0) {
                        await recording.saveTags(fallbackTags);
                    }
                    if (speakersMissing && fallbackSpeakers.length > 0) {
                        await recording.saveSpeakers(fallbackSpeakers);
                    }
                    this.recordingListWidget.refresh();
                    this._rebuildFilterOptions();
                } catch (saveErr) {
                    console.log(
                        "[Window] Fallback auto-metadata skipped:",
                        saveErr instanceof Error ? saveErr.message : String(saveErr),
                    );
                }
            }
        }
    }

    private _rebuildFilterOptions(): void {
        this._rebuildFilterSection(
            this._categoryFiltersBox,
            this._collectDistinctValues("category"),
            this.selectedCategoryFilters,
            (selected) => {
                this.selectedCategoryFilters = selected;
                this._applyValueFilters();
            },
            _("No categories yet"),
        );
        this._rebuildFilterSection(
            this._tagFiltersBox,
            this._collectDistinctValues("tags"),
            this.selectedTagFilters,
            (selected) => {
                this.selectedTagFilters = selected;
                this._applyValueFilters();
            },
            _("No tags yet"),
        );
        this._rebuildFilterSection(
            this._speakerFiltersBox,
            this._collectDistinctValues("speakers"),
            this.selectedSpeakerFilters,
            (selected) => {
                this.selectedSpeakerFilters = selected;
                this._applyValueFilters();
            },
            _("No speakers yet"),
        );
    }

    private _applyValueFilters(): void {
        this.recordingListWidget.setValueFilters({
            categories: [...this.selectedCategoryFilters],
            tags: [...this.selectedTagFilters],
            speakers: [...this.selectedSpeakerFilters],
        });
        this._updateFilterAffordance();
    }

    private _updateFilterAffordance(): void {
        const filterCount = this.selectedCategoryFilters.size +
            this.selectedTagFilters.size +
            this.selectedSpeakerFilters.size +
            (this._dateFilterDropdown.get_selected() > 0 ? 1 : 0);

        this._filtersButton.tooltip_text = filterCount > 0
            ? _("%d active filters").format(filterCount)
            : _("Filter results");
        this._filtersButton.set_css_classes(
            filterCount > 0
                ? ["filters-button", "filter-active"]
                : ["filters-button"],
        );
        this._clearFiltersBtn.sensitive = filterCount > 0 ||
            this._searchEntry.get_text().length > 0;
    }

    private _rebuildFilterSection(
        box: Gtk.Box,
        values: string[],
        selected: Set<string>,
        onChanged: (next: Set<string>) => void,
        emptyLabel: string,
    ): void {
        let child = box.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            box.remove(child as Gtk.Widget);
            child = next;
        }

        const normalizedSelected = new Set(
            [...selected].filter((value) => values.includes(value)),
        );

        if (values.length === 0) {
            const label = new Gtk.Label({ label: emptyLabel, xalign: 0 });
            label.add_css_class("dim-label");
            label.add_css_class("caption");
            box.append(label);
            onChanged(normalizedSelected);
            return;
        }

        for (const value of values) {
            const check = new Gtk.CheckButton({
                label: value,
                active: normalizedSelected.has(value),
            });
            check.connect("toggled", () => {
                const nextSelected = new Set(normalizedSelected);
                if (check.active) nextSelected.add(value);
                else nextSelected.delete(value);
                onChanged(nextSelected);
            });
            box.append(check);
        }

        onChanged(normalizedSelected);
    }

    private _collectDistinctValues(kind: "category" | "tags" | "speakers"): string[] {
        const seen = new Set<string>();
        const values: string[] = [];

        for (let i = 0; i < this.recordingList.get_n_items(); i++) {
            const recording = this.recordingList.get_item(i) as Recording;
            const rawValues = kind === "category"
                ? [recording.category]
                : kind === "tags"
                    ? recording.tags
                    : recording.speakers;

            for (const rawValue of rawValues) {
                const value = rawValue?.trim();
                if (!value) continue;
                const key = value.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                values.push(value);
            }
        }

        values.sort((left, right) => left.localeCompare(right));
        return values;
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
