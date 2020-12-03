/* exported RecordingsListBox */
const { GObject, GstPlayer, Gtk, Gst } = imports.gi;
const { Row, RowState } = imports.row;

var RecordingsListBox = new GObject.registerClass({
    Signals: {
        'row-deleted': { param_types: [GObject.TYPE_OBJECT, GObject.TYPE_INT] },
    },
}, class RecordingsListBox extends Gtk.ListBox {
    _init(model, player) {
        this._player = player;
        super._init({
            valign: Gtk.Align.FILL,
            margin_start: 8,
            margin_end: 8,
            margin_top: 12,
            margin_bottom: 12,
            activate_on_single_click: true,
        });

        this.get_style_context().add_class('content');

        this._player.connect('state-changed', (_player, state) => {
            if (state === GstPlayer.PlayerState.STOPPED && this.activePlayingRow) {
                this.activePlayingRow.state = RowState.PAUSED;
                this.activePlayingRow.waveform.position = 0.0;
            } else if (state === GstPlayer.PlayerState.PLAYING) {
                this.activePlayingRow.state = RowState.PLAYING;
            }
        });

        this._player.connect('position-updated', (_player, pos) => {
            const duration = this.activePlayingRow._recording.duration;
            this.activePlayingRow.waveform.position = pos / duration;
        });

        this.bind_model(model, recording => {
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

            row.connect('play', _row => {
                if (this.activePlayingRow) {
                    if (this.activePlayingRow !== _row) {
                        this.activePlayingRow.state = RowState.PAUSED;
                        this.activePlayingRow.waveform.position = 0.0;
                        this._player.set_uri(recording.uri);
                    }
                } else {
                    this._player.set_uri(recording.uri);
                }

                this.activePlayingRow = _row;
                this._player.play();
            });

            row.connect('pause', _row => {
                this._player.pause();
            });

            row.connect('seek-backward', _row => {
                let position = this._player.position - 10 * Gst.SECOND;
                position = position < 0 || position > _row._recording.duration ? 0 : position;
                this._player.seek(position);
            });
            row.connect('seek-forward', _row => {
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

        this.connect('row-activated', this.rowActivated.bind(this));

        this.show();
    }

    rowActivated(list, row) {
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

    isolateAt(index, expanded) {
        const before = this.get_row_at_index(index - 1);
        const current = this.get_row_at_index(index);
        const after = this.get_row_at_index(index + 1);

        if (expanded) {
            if (current)
                current.get_style_context().add_class('expanded');
            if (before)
                before.get_style_context().add_class('expanded-before');
            if (after)
                after.get_style_context().add_class('expanded-after');
        } else {
            if (current)
                current.get_style_context().remove_class('expanded');
            if (before)
                before.get_style_context().remove_class('expanded-before');
            if (after)
                after.get_style_context().remove_class('expanded-after');
        }
    }
});
