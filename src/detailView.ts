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
    private _categoryEntry!: Gtk.Entry;
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
    private _transcriptionView!: Gtk.TextView;

    private _recording: Recording | null = null;
    private player: Gst.Element;
    private waveform: WaveForm | null = null;
    private positionTimer: number | null = null;

    static {
        GObject.registerClass(
            {
                Template: "resource:///app/rebreda/Transcribd/ui/detailView.ui",
                InternalChildren: [
                    "titleLabel",
                    "actionsMenuBtn",
                    "dateLabel",
                    "durationLabel",
                    "durationTimeLabel",
                    "categoryEntry",
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
                    "transcriptionView",
                ],
                Signals: {
                    transcribe: { param_types: [GObject.TYPE_OBJECT] },
                    deleted: { param_types: [GObject.TYPE_OBJECT] },
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

        // Category entry
        this._categoryEntry.connect("activate", () => {
            if (this._recording) {
                void this._recording.saveCategory(
                    this._categoryEntry.get_text().trim(),
                );
            }
        });
        this._categoryEntry.connect("focus-leave", () => {
            if (this._recording) {
                void this._recording.saveCategory(
                    this._categoryEntry.get_text().trim(),
                );
            }
        });

        // Transcribe / re-transcribe buttons
        this._transcribeBtn.connect("clicked", () => {
            if (this._recording) this.emit("transcribe", this._recording);
        });
        this._retranscribeBtn.connect("clicked", () => {
            if (this._recording) this.emit("transcribe", this._recording);
        });

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

        // Stop playback when switching recording
        this._stopPlayback();

        this._recording = rec;
        this._refreshView();
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

        if (!rec) return;

        // Title (strip extension for display)
        const displayName = (rec.name ?? "").replace(/\.[^.]+$/, "");
        this._titleLabel.set_text(displayName);

        // Date
        this._dateLabel.label = displayDateTime(rec.timeCreated);

        // Duration (may arrive later via notify)
        this._refreshDuration();
        rec.connect("notify::duration", () => this._refreshDuration());

        // Category
        this._categoryEntry.set_text(rec.category ?? "");
        rec.connect("notify::category", () => {
            this._categoryEntry.set_text(rec.category ?? "");
        });

        // Name
        rec.connect("notify::name", () => {
            const newDisplay = (rec.name ?? "").replace(/\.[^.]+$/, "");
            if (this._titleLabel.get_text() !== newDisplay) {
                this._titleLabel.set_text(newDisplay);
            }
        });

        // Waveform
        this._buildWaveform(rec);

        // Transcription
        this._refreshTranscription(rec.transcription);
        rec.connect("notify::transcription", () => {
            this._refreshTranscription(rec.transcription);
        });
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
            this._transcriptionView.buffer.set_text(text, -1);
            this._transcriptionStack.visible_child_name = "text";
        } else {
            this._transcriptionStack.visible_child_name = "empty";
        }
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
}
