/* exported RecordingsListWidget */
import Adw from 'gi://Adw'
import GObject from 'gi://GObject'
import Gst from 'gi://Gst'
import GstPlayer from 'gi://GstPlayer'
import Gtk from 'gi://Gtk?version=4.0'
import Gio from 'gi://Gio';

import { Row, RowClass, RowState } from './row.js';
import { RecordingClass } from './recording.js';

export type RecordingsListWidgetClass = InstanceType<typeof RecordingsListWidget>;

export const RecordingsListWidget = GObject.registerClass({
    Signals: {
        'row-deleted': { param_types: [GObject.TYPE_OBJECT, GObject.TYPE_INT] },
    },
}, class RecordingsListWidget extends Adw.Bin {
    _player: GstPlayer.Player;
    list: Gtk.ListBox;
    activeRow: RowClass;
    activePlayingRow: RowClass;

    _init(model: Gio.ListModel, player: GstPlayer.Player): void {
        super._init();
        this.list = Gtk.ListBox.new();
        this.list.valign = Gtk.Align.START;
        this.list.margin_start = 8;
        this.list.margin_end = 8;
        this.list.margin_top = 12;
        this.list.margin_bottom = 12;
        this.list.activate_on_single_click = true;
        this.list.add_css_class('boxed-list');

        this.set_child(this.list);

        this._player = player;
        this._player.connect('state-changed', (_player: GstPlayer.Player, state: GstPlayer.PlayerState) => {
            if (state === GstPlayer.PlayerState.STOPPED && this.activePlayingRow) {
                this.activePlayingRow.state = RowState.Paused;
                this.activePlayingRow.waveform.position = 0.0;
            } else if (state === GstPlayer.PlayerState.PLAYING) {
                this.activePlayingRow.state = RowState.Playing;
            }
        });

        this._player.connect('position-updated', (_player: GstPlayer.Player, pos: number) => {
            if (this.activePlayingRow) {
                const duration = this.activePlayingRow._recording.duration;
                this.activePlayingRow.waveform.position = pos / duration;
            }
        });

        this.list.bind_model(model, (recording: RecordingClass) => {
            let row = new Row(recording);

            row.waveform.connect('gesture-pressed', _ => {
                if (!this.activePlayingRow || this.activePlayingRow !== row) {

                    if (this.activePlayingRow)
                        this.activePlayingRow.waveform.position = 0.0;

                    this.activePlayingRow = row;
                    this._player.set_uri(recording.uri);
                }
            });

            row.waveform.connect('position-changed', (_wave, _position) => {
                this._player.seek(_position * row._recording.duration);
            });

            row.connect('play', (_row: RowClass) => {
                if (this.activePlayingRow) {
                    if (this.activePlayingRow !== _row) {
                        this.activePlayingRow.state = RowState.Paused;
                        this.activePlayingRow.waveform.position = 0.0;
                        this._player.set_uri(recording.uri);
                    }
                } else {
                    this._player.set_uri(recording.uri);
                }

                this.activePlayingRow = _row;
                this._player.play();
            });

            row.connect('pause', (_row: RowClass) => {
                this._player.pause();
            });

            row.connect('seek-backward', (_row: RowClass) => {
                let position = this._player.position - 10 * Gst.SECOND;
                position = position < 0 || position > _row._recording.duration ? 0 : position;
                this._player.seek(position);
            });
            row.connect('seek-forward', (_row: RowClass) => {
                let position = this._player.position + 10 * Gst.SECOND;
                position = position < 0 || position > _row._recording.duration ? 0 : position;
                this._player.seek(position);
            });

            row.connect('deleted', () => {
                if (row === this.activeRow)
                    this.activeRow = null;

                if (row === this.activePlayingRow) {
                    this.activePlayingRow = null;
                    this._player.stop();
                }

                const index = row.get_index();
                this.isolateAt(index, false);
                this.emit('row-deleted', row._recording, index);
            });

            return row;
        });

        this.list.connect('row-activated', this.rowActivated.bind(this));
    }

    rowActivated(_list: Gtk.ListBox, row: RowClass): void {
        if (row.editMode && row.expanded || this.activeRow && this.activeRow.editMode && this.activeRow.expanded)
            return;

        if (this.activeRow && this.activeRow !== row) {
            this.activeRow.expanded = false;
            this.isolateAt(this.activeRow.get_index(), false);
        }
        row.expanded = !row.expanded;
        this.isolateAt(row.get_index(), row.expanded);

        this.activeRow = row;
    }

    isolateAt(index: number, expanded: boolean): void {
        const before = this.list.get_row_at_index(index - 1);
        const current = this.list.get_row_at_index(index);
        const after = this.list.get_row_at_index(index + 1);

        if (expanded) {
            if (current)
                current.add_css_class('expanded');
            if (before)
                before.add_css_class('expanded-before');
            if (after)
                after.add_css_class('expanded-after');
        } else {
            if (current)
                current.remove_css_class('expanded');
            if (before)
                before.remove_css_class('expanded-before');
            if (after)
                after.remove_css_class('expanded-after');
        }
    }
});
