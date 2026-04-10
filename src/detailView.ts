import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gst from "gi://Gst";
import Gtk from "gi://Gtk?version=4.0";

import { Recording } from "./recording.js";
import { WaveForm, WaveType } from "./waveform.js";
import { displayDateTime, formatTime } from "./utils.js";
import { injectText } from "./transcriber.js";

export class RecordingDetailView extends Adw.Bin {
    private _titleLabel!: Gtk.EditableLabel;
    private _actionsMenuBtn!: Gtk.MenuButton;
    private _dateLabel!: Gtk.Label;
    private _durationLabel!: Gtk.Label;
    private _durationTimeLabel!: Gtk.Label;
    private _categoryRow!: Gtk.Box;
    private _categoryValueLabel!: Gtk.Label;
    private _tagsRow!: Gtk.Box;
    private _tagsValueLabel!: Gtk.Label;
    private _speakersRow!: Gtk.Box;
    private _speakersValueLabel!: Gtk.Label;
    private _waveformContainer!: Gtk.Box;
    private _seekBar!: Gtk.Scale;
    private _positionLabel!: Gtk.Label;
    private _playPauseStack!: Gtk.Stack;
    private _playBtn!: Gtk.Button;
    private _pauseBtn!: Gtk.Button;
    private _seekBackBtn!: Gtk.Button;
    private _seekFwdBtn!: Gtk.Button;
    private _transcriptionStack!: Gtk.Stack;
    private _transcribeBtn!: Gtk.Button;
    private _injectBtn!: Gtk.Button;
    private _retranscribeBtn!: Gtk.Button;
    private _saveTranscriptBtn!: Gtk.Button;
    private _transcriptionView!: Gtk.TextView;
    private _loadingLabel!: Gtk.Label;

    private _recording: Recording | null = null;
    private player: Gst.Element;
    private waveform: WaveForm | null = null;
    private positionTimer: number | null = null;
    private transcriptDirty = false;
    private updatingTranscript = false;
    private transcriptionBusy = false;
    private loadGeneration = 0;
    private recordingSignalIds: number[] = [];

    static {
        GObject.registerClass(
            {
                Template: "resource:///io/github/rebreda/Transcribd/ui/detailView.ui",
                InternalChildren: [
                    "titleLabel",
                    "actionsMenuBtn",
                    "dateLabel",
                    "durationLabel",
                    "durationTimeLabel",
                    "categoryRow",
                    "categoryValueLabel",
                    "tagsRow",
                    "tagsValueLabel",
                    "speakersRow",
                    "speakersValueLabel",
                    "waveformContainer",
                    "seekBar",
                    "positionLabel",
                    "playPauseStack",
                    "playBtn",
                    "pauseBtn",
                    "seekBackBtn",
                    "seekFwdBtn",
                    "transcriptionStack",
                    "transcribeBtn",
                    "injectBtn",
                    "retranscribeBtn",
                    "saveTranscriptBtn",
                    "transcriptionView",
                    "loadingLabel",
                ],
                Signals: {
                    transcribe: { param_types: [GObject.TYPE_OBJECT] },
                    deleted: { param_types: [GObject.TYPE_OBJECT] },
                    "recording-updated": { param_types: [GObject.TYPE_OBJECT] },
                },
            },
            this,
        );
    }

    constructor(player: Gst.Element) {
        super();

        this.player = player;

        // Position update timer
        this.positionTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._updatePosition();
            return GLib.SOURCE_CONTINUE;
        });

        // Player bus (EOS handling)
        const bus = this.player.get_bus();
        if (bus) {
            bus.add_signal_watch();
            bus.connect("message", (_bus: Gst.Bus, msg: Gst.Message) => {
                if (msg.type === Gst.MessageType.EOS) {
                    this._onPlaybackEnded();
                }
            });
        }

        // Seek bar – only user drags seek
        this._seekBar.connect(
            "change-value",
            (_scale: Gtk.Scale, _type: Gtk.ScrollType, value: number) => {
                if (this._recording && this._recording.duration > 0) {
                    const clamped = Math.max(0, Math.min(1, value));
                    this.player.seek_simple(
                        Gst.Format.TIME,
                        Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT,
                        clamped * this._recording.duration,
                    );
                }
                return false;
            },
        );

        // Play / pause buttons
        this._playBtn.connect("clicked", () => this._play());
        this._pauseBtn.connect("clicked", () => this._pause());

        // Skip buttons
        this._seekBackBtn.connect("clicked", () => this._skip(-10));
        this._seekFwdBtn.connect("clicked", () => this._skip(10));

        // Title rename on edit-end
        this._titleLabel.connect("notify::editing", () => {
            if (!this._titleLabel.editing) this._applyNameChange();
        });

        // Transcribe / re-transcribe buttons
        this._transcribeBtn.connect("clicked", () => {
            if (this._recording) this.emit("transcribe", this._recording);
        });
        this._retranscribeBtn.connect("clicked", () => {
            if (this._recording) this.emit("transcribe", this._recording);
        });
        this._saveTranscriptBtn.connect("clicked", () => {
            void this._saveTranscriptChanges();
        });

        this._transcriptionView.buffer.connect("changed", () => {
            if (this.updatingTranscript) return;
            this.transcriptDirty = true;
            this._saveTranscriptBtn.sensitive = true;
        });
        const transcriptFocusController = new Gtk.EventControllerFocus();
        transcriptFocusController.connect("leave", () => {
            void this._saveTranscriptChanges();
        });
        this._transcriptionView.add_controller(transcriptFocusController);

        // Inject button
        this._injectBtn.connect("clicked", () => {
            if (this._recording) {
                const text = this._recording.transcription;
                if (text.length > 0) {
                    const root = this.root as Gtk.Window;
                    injectText(text, root);
                }
            }
        });

        // Delete action in actions menu
        const deleteAction = new Gio.SimpleAction({ name: "delete" });
        deleteAction.connect("activate", () => {
            if (this._recording) this.emit("deleted", this._recording);
        });
        const exportAction = new Gio.SimpleAction({ name: "export" });
        exportAction.connect("activate", () => this._export());

        const actionGroup = new Gio.SimpleActionGroup();
        actionGroup.add_action(deleteAction);
        actionGroup.add_action(exportAction);
        this.insert_action_group("detail", actionGroup);

        const menu = new Gio.Menu();
        menu.append(_("Export"), "detail.export");
        menu.append(_("Delete"), "detail.delete");
        this._actionsMenuBtn.set_menu_model(menu);
    }

    public get recording(): Recording | null {
        return this._recording;
    }

    public set recording(rec: Recording | null) {
        if (this._recording === rec) return;

        this._disconnectRecordingSignals();

        // Stop playback when switching recording
        this._stopPlayback();

        this._recording = rec;
        const generation = ++this.loadGeneration;
        this._refreshView();

        if (!rec) {
            return;
        }

        this._setMetadataSensitive(false);
        if (!this.transcriptionBusy) {
            this._showTranscriptionLoading(_("Loading recording…"));
        }

        void rec.persistedReady.finally(() => {
            if (this._recording !== rec || generation !== this.loadGeneration) return;
            this._setMetadataSensitive(true);
            this._refreshMetadata(rec);
            if (!this.transcriptionBusy) {
                this._refreshTranscription(rec.transcription);
            }
        });
    }

    public setTranscriptionBusy(isBusy: boolean, message?: string): void {
        this.transcriptionBusy = isBusy;
        this._transcriptionView.editable = !isBusy;
        this._transcribeBtn.sensitive = !isBusy;
        this._retranscribeBtn.sensitive = !isBusy;
        this._injectBtn.sensitive = !isBusy;
        this._saveTranscriptBtn.sensitive = !isBusy && this.transcriptDirty;

        if (isBusy) {
            this._showTranscriptionLoading(message ?? _("Working…"));
        } else if (this._recording) {
            this._refreshTranscription(this._recording.transcription);
        }
    }

    /** Stop timer and clean up when destroyed. */
    public cleanup(): void {
        if (this.positionTimer !== null) {
            GLib.source_remove(this.positionTimer);
            this.positionTimer = null;
        }
    }

    private _refreshView(): void {
        const rec = this._recording;

        if (!rec) {
            this._titleLabel.set_text("");
            this._dateLabel.label = "";
            this._durationLabel.label = "";
            this._durationTimeLabel.label = "";
            this._categoryValueLabel.label = "";
            this._tagsValueLabel.label = "";
            this._speakersValueLabel.label = "";
            this._showTranscriptionLoading(_("Select a recording to inspect it"));
            this._setMetadataSensitive(false);
            return;
        }

        // Title (strip extension for display)
        const displayName = (rec.name ?? "").replace(/\.[^.]+$/, "");
        this._titleLabel.set_text(displayName);

        // Date
        this._dateLabel.label = displayDateTime(rec.timeCreated);

        // Duration (may arrive later via notify)
        this._refreshDuration();
        this.recordingSignalIds.push(
            rec.connect("notify::duration", () => this._refreshDuration()),
        );

        this._refreshMetadata(rec);
        this.recordingSignalIds.push(
            rec.connect("metadata-changed", () => {
                this._refreshMetadata(rec);
            }),
        );

        // Name
        this.recordingSignalIds.push(
            rec.connect("notify::name", () => {
                const newDisplay = (rec.name ?? "").replace(/\.[^.]+$/, "");
                if (this._titleLabel.get_text() !== newDisplay) {
                    this._titleLabel.set_text(newDisplay);
                }
            }),
        );

        // Waveform
        this._buildWaveform(rec);

        // Transcription
        if (!this.transcriptionBusy) {
            this._showTranscriptionLoading(_("Loading transcript…"));
        }
        this.recordingSignalIds.push(
            rec.connect("notify::transcription", () => {
                if (!this.transcriptionBusy) {
                    this._refreshTranscription(rec.transcription);
                }
            }),
        );
    }

    private _refreshMetadata(rec: Recording): void {
        this._setMetadataRow(
            this._categoryRow,
            this._categoryValueLabel,
            rec.category,
        );
        this._setMetadataRow(
            this._tagsRow,
            this._tagsValueLabel,
            rec.tags.join(", "),
        );
        this._setMetadataRow(
            this._speakersRow,
            this._speakersValueLabel,
            rec.speakers.join(", "),
        );
    }

    private _buildWaveform(rec: Recording): void {
        // Remove old waveform
        if (this.waveform) {
            this._waveformContainer.remove(this.waveform);
            this.waveform = null;
        }

        this.waveform = new WaveForm(
            { hexpand: true, vexpand: true },
            WaveType.Player,
        );
        this._waveformContainer.append(this.waveform);

        rec.connect("peaks-updated", () => {
            this.waveform!.peaks = rec.peaks;
        });
        rec.connect("peaks-loading", () => {
            // Waveform is still loading – keep spinner visible
        });

        if (rec.peaks.length > 0) {
            this.waveform.peaks = rec.peaks;
        } else {
            void rec.loadPeaks();
        }

        this.waveform.connect(
            "position-changed",
            (_w: WaveForm, pos: number) => {
                if (rec.duration > 0) {
                    this.player.seek_simple(
                        Gst.Format.TIME,
                        Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT,
                        pos * rec.duration,
                    );
                }
            },
        );

        this.waveform.connect("gesture-pressed", () => {
            this.player.set_property("uri", rec.uri);
        });
    }

    private _refreshDuration(): void {
        const ns = this._recording?.duration ?? 0;
        if (ns > 0) {
            this._durationLabel.set_markup(formatTime(ns));
            this._durationTimeLabel.set_markup(formatTime(ns));
        }
    }

    private _refreshTranscription(text: string): void {
        if (text.trim().length > 0) {
            this.updatingTranscript = true;
            this._transcriptionView.buffer.set_text(text, -1);
            this.updatingTranscript = false;
            this.transcriptDirty = false;
            this._saveTranscriptBtn.sensitive = false;
            this._transcriptionStack.visible_child_name = "text";
        } else {
            this.updatingTranscript = true;
            this._transcriptionView.buffer.set_text("", -1);
            this.updatingTranscript = false;
            this.transcriptDirty = false;
            this._saveTranscriptBtn.sensitive = false;
            this._transcriptionStack.visible_child_name = "empty";
        }
    }

    private _showTranscriptionLoading(message: string): void {
        this._loadingLabel.set_text(message);
        this._transcriptionStack.visible_child_name = "loading";
    }

    private async _saveTranscriptChanges(): Promise<void> {
        const rec = this._recording;
        if (!rec || !this.transcriptDirty) return;

        const buffer = this._transcriptionView.buffer;
        const text = buffer.get_text(
            buffer.get_start_iter(),
            buffer.get_end_iter(),
            false,
        ).trim();
        const existing = rec.transcription.trim();

        if (text === existing) {
            this.transcriptDirty = false;
            this._saveTranscriptBtn.sensitive = false;
            return;
        }

        await rec.saveTranscription(text);
        await rec.saveSegments([]);
        this.transcriptDirty = false;
        this._saveTranscriptBtn.sensitive = false;
        this.emit("recording-updated", rec);
    }

    private _play(): void {
        if (!this._recording) return;
        this.player.set_property("uri", this._recording.uri);
        this.player.set_state(Gst.State.PLAYING);
        this._playPauseStack.visible_child_name = "pause";
    }

    private _pause(): void {
        this.player.set_state(Gst.State.PAUSED);
        this._playPauseStack.visible_child_name = "play";
    }

    private _stopPlayback(): void {
        this.player.set_state(Gst.State.NULL);
        this._playPauseStack.visible_child_name = "play";
        if (this.waveform) this.waveform.position = 0;
        this._seekBar.set_value(0);
    }

    private _onPlaybackEnded(): void {
        this._playPauseStack.visible_child_name = "play";
        if (this.waveform) this.waveform.position = 0;
        this._seekBar.set_value(0);
    }

    private _skip(seconds: number): void {
        if (!this._recording) return;
        const [ok, pos] = this.player.query_position(Gst.Format.TIME);
        if (ok) {
            const newPos = Math.max(
                0,
                Math.min(this._recording.duration, pos + seconds * Gst.SECOND),
            );
            this.player.seek_simple(
                Gst.Format.TIME,
                Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT,
                newPos,
            );
        }
    }

    private _updatePosition(): void {
        if (!this._recording || this._recording.duration <= 0) return;
        const [ok, pos] = this.player.query_position(Gst.Format.TIME);
        if (!ok) return;

        const fraction = pos / this._recording.duration;

        if (this.waveform) this.waveform.position = fraction;

        this._seekBar.set_value(fraction);

        this._positionLabel.set_markup(formatTime(pos));

        // Highlight current transcript segment
        this._highlightSegmentAt(pos / Gst.MSECOND);
    }

    private _highlightSegmentAt(posMs: number): void {
        const rec = this._recording;
        if (!rec) return;
        const segments = rec.segments;
        if (segments.length === 0) return;

        const seg = segments.find((s) => posMs >= s.startMs && posMs <= s.endMs);
        if (!seg) return;

        const buffer = this._transcriptionView.buffer;
        const fullText = buffer.get_text(
            buffer.get_start_iter(),
            buffer.get_end_iter(),
            false,
        );
        const idx = fullText.indexOf(seg.text);
        if (idx < 0) return;

        let tag = buffer.get_tag_table().lookup("highlight");
        if (!tag) {
            const t = new Gtk.TextTag({ name: "highlight", background: "#FFD500" });
            buffer.get_tag_table().add(t);
            tag = t;
        }
        buffer.remove_all_tags(
            buffer.get_start_iter(),
            buffer.get_end_iter(),
        );
        const start = buffer.get_iter_at_offset(idx);
        const end = buffer.get_iter_at_offset(idx + seg.text.length);
        buffer.apply_tag(tag!, start, end);

        // Scroll to highlighted text
        this._transcriptionView.scroll_to_iter(start, 0, false, 0, 0);
    }

    private _applyNameChange(): void {
        if (!this._recording) return;
        const newText = this._titleLabel.get_text().trim();
        if (!newText) return;
        const ext = this._recording.extension;
        const newName = ext ? `${newText}.${ext}` : newText;
        if (newName !== this._recording.name) {
            this._recording.name = newName;
            this.emit("recording-updated", this._recording);
        }
    }

    private _export(): void {
        if (!this._recording) return;
        const recording = this._recording;
        const window = this.root as Gtk.Window;
        const dialog = Gtk.FileChooserNative.new(
            _("Export Recording"),
            window,
            Gtk.FileChooserAction.SAVE,
            _("_Export"),
            _("_Cancel"),
        );
        dialog.set_current_name(recording.name ?? "recording");
        dialog.connect("response", (_d: Gtk.FileChooserNative, resp: number) => {
            if (resp === Gtk.ResponseType.ACCEPT) {
                const dest = dialog.get_file();
                if (dest) recording.save(dest);
            }
            dialog.destroy();
        });
        dialog.show();
    }

    private _setMetadataSensitive(sensitive: boolean): void {
        this._titleLabel.sensitive = sensitive;
        this._categoryRow.sensitive = sensitive;
        this._tagsRow.sensitive = sensitive;
        this._speakersRow.sensitive = sensitive;
    }

    private _setMetadataRow(
        row: Gtk.Box,
        label: Gtk.Label,
        value: string | null | undefined,
    ): void {
        const text = value?.trim() ?? "";
        label.label = text;
        row.visible = text.length > 0;
    }

    private _disconnectRecordingSignals(): void {
        const rec = this._recording;
        if (!rec) return;
        for (const id of this.recordingSignalIds) {
            try {
                rec.disconnect(id);
            } catch (_err) {
                // Ignore stale handler IDs.
            }
        }
        this.recordingSignalIds = [];
    }
}
