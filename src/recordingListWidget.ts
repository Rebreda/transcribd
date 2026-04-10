/* exported RecordingsListWidget */
import Adw from "gi://Adw";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gst from "gi://Gst";
import Gtk from "gi://Gtk?version=4.0";
import Gio from "gi://Gio";

import { Row, RowState } from "./row.js";
import { Recording } from "./recording.js";
import { WaveForm } from "./waveform.js";

export class RecordingsListWidget extends Adw.Bin {
    private player: Gst.Element;
    public list: Gtk.ListBox;
    public activeRow?: Row | null;
    public activePlayingRow?: Row | null;

    static {
        GObject.registerClass(
            {
                Signals: {
                    "row-deleted": {
                        param_types: [GObject.TYPE_OBJECT, GObject.TYPE_INT],
                    },
                },
            },
            this,
        );
    }

    constructor(model: Gio.ListModel, player: Gst.Element) {
        super();
        this.list = Gtk.ListBox.new();
        this.list.valign = Gtk.Align.START;
        this.list.margin_start = 8;
        this.list.margin_end = 8;
        this.list.margin_top = 12;
        this.list.margin_bottom = 12;
        this.list.activate_on_single_click = true;
        this.list.add_css_class("boxed-list");

        this.set_child(this.list);

        this.player = player;
        const bus = this.player.get_bus();
        if (bus) {
            bus.add_signal_watch();
            bus.connect("message", (_bus, message) => {
                this.onBusMessage(message);
            });
        }

        // Update position every 100ms
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this.updatePosition();
            return true;
        });

        this.list.bind_model(model, (item: GObject.Object) => {
            const recording = item as Recording;
            const row = new Row(recording);

            row.waveform.connect("gesture-pressed", () => {
                if (!this.activePlayingRow || this.activePlayingRow !== row) {
                    if (this.activePlayingRow)
                        this.activePlayingRow.waveform.position = 0.0;

                    this.activePlayingRow = row;
                    this.player.set_property("uri", recording.uri);
                }
            });

            row.waveform.connect(
                "position-changed",
                (_wave: WaveForm, position: number) => {
                    this.player.seek_simple(
                        Gst.Format.TIME,
                        Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT,
                        position * row.recording.duration,
                    );
                },
            );

            row.connect("play", (_row: Row) => {
                if (this.activePlayingRow) {
                    if (this.activePlayingRow !== _row) {
                        this.activePlayingRow.state = RowState.Paused;
                        this.activePlayingRow.waveform.position = 0.0;
                        this.player.set_property("uri", recording.uri);
                    }
                } else {
                    this.player.set_property("uri", recording.uri);
                }

                this.activePlayingRow = _row;
                this.player.set_state(Gst.State.PLAYING);
            });

            row.connect("pause", () => {
                this.player.set_state(Gst.State.PAUSED);
            });

            row.connect("seek-backward", (row: Row) => {
                const [success, currentPos] = this.player.query_position(
                    Gst.Format.TIME,
                );
                if (success) {
                    let position = currentPos - 10 * Gst.SECOND;
                    position = Math.max(
                        0,
                        Math.min(position, row.recording.duration),
                    );
                    this.player.seek_simple(
                        Gst.Format.TIME,
                        Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT,
                        position,
                    );
                }
            });
            row.connect("seek-forward", (_row: Row) => {
                const [success, currentPos] = this.player.query_position(
                    Gst.Format.TIME,
                );
                if (success) {
                    let position = currentPos + 10 * Gst.SECOND;
                    position = Math.max(
                        0,
                        Math.min(position, _row.recording.duration),
                    );
                    this.player.seek_simple(
                        Gst.Format.TIME,
                        Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT,
                        position,
                    );
                }
            });

            row.connect("deleted", () => {
                if (row === this.activeRow) this.activeRow = null;

                if (row === this.activePlayingRow) {
                    this.activePlayingRow = null;
                    this.player.set_state(Gst.State.NULL);
                }

                const index = row.get_index();
                this.isolateAt(index, false);
                this.emit("row-deleted", row.recording, index);
            });

            return row;
        });

        this.list.connect("row-activated", this.rowActivated.bind(this));
    }

    private rowActivated(_list: Gtk.ListBox, row: Row): void {
        if (
            (row.editMode && row.expanded) ||
            (this.activeRow &&
                this.activeRow.editMode &&
                this.activeRow.expanded)
        )
            return;

        if (this.activeRow && this.activeRow !== row) {
            this.activeRow.expanded = false;
            this.isolateAt(this.activeRow.get_index(), false);
        }
        row.expanded = !row.expanded;
        this.isolateAt(row.get_index(), row.expanded);

        this.activeRow = row;
    }

    private isolateAt(index: number, expanded: boolean): void {
        const before = this.list.get_row_at_index(index - 1);
        const current = this.list.get_row_at_index(index);
        const after = this.list.get_row_at_index(index + 1);

        if (expanded) {
            if (current) current.add_css_class("expanded");
            if (before) before.add_css_class("expanded-before");
            if (after) after.add_css_class("expanded-after");
        } else {
            if (current) current.remove_css_class("expanded");
            if (before) before.remove_css_class("expanded-before");
            if (after) after.remove_css_class("expanded-after");
        }
    }

    private onBusMessage(message: Gst.Message): void {
        const type = message.type;
        if (type === Gst.MessageType.EOS) {
            if (this.activePlayingRow) {
                this.activePlayingRow.state = RowState.Paused;
                this.activePlayingRow.waveform.position = 0.0;
            }
        } else if (type === Gst.MessageType.STATE_CHANGED) {
            const [_oldState, newState] = message.parse_state_changed();
            if (newState === Gst.State.PLAYING) {
                if (this.activePlayingRow) {
                    this.activePlayingRow.state = RowState.Playing;
                }
            } else if (
                newState === Gst.State.PAUSED ||
                newState === Gst.State.NULL
            ) {
                if (this.activePlayingRow) {
                    this.activePlayingRow.state = RowState.Paused;
                }
            }
        }
    }

    private updatePosition(): void {
        if (this.activePlayingRow) {
            const [success, position] = this.player.query_position(
                Gst.Format.TIME,
            );
            if (success) {
                const duration = this.activePlayingRow.recording.duration;
                this.activePlayingRow.waveform.position = position / duration;
            }
        }
    }
}
