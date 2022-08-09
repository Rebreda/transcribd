/* exported Row */
import Gdk from 'gi://Gdk?version=4.0'
import Gio from 'gi://Gio'
import GObject from 'gi://GObject'
import Gtk from 'gi://Gtk?version=4.0'

import { RecordingClass } from './recording.js';
import { displayDateTime, formatTime } from './utils.js';
import { WaveForm, WaveFormClass, WaveType } from './waveform.js';

export enum RowState {
    Playing,
    Paused,
};

export type RowClass = InstanceType<typeof Row>;

export const Row = GObject.registerClass({
    Template: 'resource:///org/gnome/SoundRecorder/ui/row.ui',
    InternalChildren: [
        'playbackStack', 'mainStack', 'waveformStack', 'rightStack',
        'name', 'entry', 'date', 'duration', 'revealer', 'playbackControls',
        'saveBtn', 'playBtn', 'pauseBtn',
    ],
    Signals: {
        'play': { param_types: [GObject.TYPE_STRING] },
        'pause': {},
        'seek-backward': {},
        'seek-forward': {},
        'deleted': {},
    },
    Properties: {
        'expanded': GObject.ParamSpec.boolean(
            'expanded',
            'Row active status', 'Row active status',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
            false),
    },
}, class Row extends Gtk.ListBoxRow {
    _playbackStack!: Gtk.Stack;
    _mainStack!: Gtk.Stack;
    _waveformStack!: Gtk.Stack;
    _rightStack!: Gtk.Stack;
    _name!: Gtk.Label;
    _entry!: Gtk.Entry;
    _date!: Gtk.Label;
    _duration!: Gtk.Label;
    _revealer!: Gtk.Revealer;
    _playbackControls!: Gtk.Box;
    _saveBtn!: Gtk.Button;
    _playBtn!: Gtk.Button;
    _pauseBtn!: Gtk.Button;

    _recording: RecordingClass;
    _expanded: boolean;
    _editMode: boolean;
    _state: RowState;

    waveform: WaveFormClass;
    actionGroup: Gio.SimpleActionGroup;
    exportDialog?: Gtk.FileChooserNative | null;

    saveRenameAction: Gio.SimpleAction;
    renameAction: Gio.SimpleAction;
    pauseAction: Gio.SimpleAction;
    playAction: Gio.SimpleAction;
    keyController: Gtk.EventControllerKey;

    constructor(recording: RecordingClass) {
        super();

        this._recording = recording;
        this._expanded = false;
        this._editMode = false;
        this._state = RowState.Paused;

        this.waveform = new WaveForm({
            margin_top: 18,
            height_request: 60,
        }, WaveType.Player);
        this._waveformStack.add_named(this.waveform, 'wave');

        if (this._recording._peaks.length > 0) {
            this.waveform.peaks = this._recording.peaks;
            this._waveformStack.visible_child_name = 'wave';
        } else {
            this._recording.loadPeaks();
        }

        if (recording.timeModified)
            this._date.label = displayDateTime(recording.timeModified);
        else
            this._date.label = displayDateTime(recording.timeCreated);

        recording.bind_property('name', this._name, 'label', GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.DEFAULT);
        recording.bind_property('name', this._entry, 'text', GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.DEFAULT);
        this.bind_property('expanded', this._revealer, 'reveal_child', GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.DEFAULT);

        this.actionGroup = new Gio.SimpleActionGroup();

        let exportAction = new Gio.SimpleAction({ name: 'export' });
        exportAction.connect('activate', () => {
            const window = this.root as Gtk.Window;
            this.exportDialog = Gtk.FileChooserNative.new(_('Export Recording'), window, Gtk.FileChooserAction.SAVE, _('_Export'), _('_Cancel'));
            this.exportDialog.set_current_name(`${this._recording.name}.${this._recording.extension}`);
            this.exportDialog.connect('response', (_dialog: Gtk.FileChooserNative, response: number) => {
                if (response === Gtk.ResponseType.ACCEPT) {
                    const dest = this.exportDialog?.get_file();
                    if (dest)
                        this._recording.save(dest);
                }
                this.exportDialog?.destroy();
                this.exportDialog = null;
            });
            this.exportDialog.show();
        });
        this.actionGroup.add_action(exportAction);

        this.saveRenameAction = new Gio.SimpleAction({ name: 'save', enabled: false });
        this.saveRenameAction.connect('activate', this.onRenameRecording.bind(this));
        this.actionGroup.add_action(this.saveRenameAction);

        this.renameAction = new Gio.SimpleAction({ name: 'rename', enabled: true });
        this.renameAction.connect('activate', (action: Gio.SimpleAction) => {
            this.editMode = true;
            action.enabled = false;
        });
        this.renameAction.bind_property('enabled', this.saveRenameAction, 'enabled', GObject.BindingFlags.INVERT_BOOLEAN);
        this.actionGroup.add_action(this.renameAction);

        this.pauseAction = new Gio.SimpleAction({ name: 'pause', enabled: false });
        this.pauseAction.connect('activate', () => {
            this.emit('pause');
            this.state = RowState.Paused;
        });
        this.actionGroup.add_action(this.pauseAction);

        this.playAction = new Gio.SimpleAction({ name: 'play', enabled: true });
        this.playAction.connect('activate', () => {
            this.emit('play', this._recording.uri);
            this.state = RowState.Playing;
        });
        this.actionGroup.add_action(this.playAction);

        let deleteAction = new Gio.SimpleAction({ name: 'delete' });
        deleteAction.connect('activate', () => {
            this.emit('deleted');
        });
        this.actionGroup.add_action(deleteAction);

        let seekBackAction = new Gio.SimpleAction({ name: 'seek-backward' });
        seekBackAction.connect('activate', () => {    _state: RowState;
        });
        this.actionGroup.add_action(seekBackAction);

        let seekForwardAction = new Gio.SimpleAction({ name: 'seek-forward' });
        seekForwardAction.connect('activate', () => {
            this.emit('seek-forward');
        });
        this.actionGroup.add_action(seekForwardAction);

        this.insert_action_group('recording', this.actionGroup);

        this.waveform.connect('gesture-pressed', _ => {
            this.pauseAction.activate(null);
        });

        this.keyController = Gtk.EventControllerKey.new();
        this.keyController.connect('key-pressed', (_controller: Gtk.EventControllerKey, key: number, _code: number, _state: Gdk.ModifierType) => {
            this._entry.remove_css_class('error');

            if (key === Gdk.KEY_Escape)
                this.editMode = false;
        });
        this._entry.add_controller(this.keyController);

        this._entry.connect('activate', _ => {
            this.saveRenameAction.activate(null);
        });

        this._recording.connect('peaks-updated', (_recording: RecordingClass) => {
            this._waveformStack.visible_child_name = 'wave';
            this.waveform.peaks = _recording.peaks;
        });

        this._recording.connect('peaks-loading', _ => {
            this._waveformStack.visible_child_name = 'loading';
        });

        // Force LTR, we don't want forward/play/backward
        this._playbackControls.set_direction(Gtk.TextDirection.LTR);

        // Force LTR, we don't want reverse hh:mm::ss
        this._duration.set_direction(Gtk.TextDirection.LTR);
        this._duration.set_markup(formatTime(recording.duration));
        recording.connect('notify::duration', () => {
            this._duration.label = formatTime(recording.duration);
        });
    }

    onRenameRecording(): void {
        try {
            if (this._name.label !== this._entry.text)
                this._recording.name = this._entry.text;

            this.editMode = false;
            this.renameAction.enabled = true;
            this._entry.remove_css_class('error');
        } catch (e) {
            this._entry.add_css_class('error');
        }
    }

    set editMode(state: boolean) {
        this._mainStack.visible_child_name = state ? 'edit' : 'display';
        this._editMode = state;

        if (state) {
            if (!this.expanded)
                this.activate();
            this._entry.grab_focus();
            /* TODO: this._saveBtn.grab_default(); */
            this._rightStack.visible_child_name = 'save';
        } else {
            this._rightStack.visible_child_name = 'options';
            this.grab_focus();
        }

        for (const action of this.actionGroup.list_actions()) {
            if (action !== 'save') {
                let someAction = this.actionGroup.lookup(action) as Gio.SimpleAction;
                someAction.enabled = !state;
            }
        }
    }

    get editMode(): boolean {
        return this._editMode;
    }

    set expanded(state: boolean) {
        this._expanded = state;
        this.notify('expanded');
    }

    get expanded(): boolean {
        return this._expanded;
    }

    set state(rowState: RowState) {
        this._state = rowState;

        switch (rowState) {
        case RowState.Playing:
            this.playAction.enabled = false;
            this.pauseAction.enabled = true;
            this._playbackStack.visible_child_name = 'pause';
            this._pauseBtn.grab_focus();
            break;
        case RowState.Paused:
            this.playAction.enabled = true;
            this.pauseAction.enabled = false;
            this._playbackStack.visible_child_name = 'play';
            this._playBtn.grab_focus();
            break;
        }
    }

    get state(): RowState {
        return this._state;
    }
});
