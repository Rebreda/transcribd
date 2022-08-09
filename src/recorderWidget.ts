/* exported RecorderState RecorderWidget */
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';

import { formatTime } from './utils.js';
import { WaveForm, WaveFormClass, WaveType } from  './waveform.js';
import { RecorderClass } from './recorder.js';

enum RecorderState {
    Recording,
    Paused,
    Stopped,
}

export type RecorderWidgetClass = InstanceType<typeof RecorderWidget>;

export const RecorderWidget = GObject.registerClass({
    Template: 'resource:///org/gnome/SoundRecorder/ui/recorder.ui',
    InternalChildren: [
        'recorderBox', 'playbackStack', 'recorderTime',
        'pauseBtn', 'resumeBtn',
    ],
    Signals: {
        'canceled': {},
        'paused': {},
        'resumed': {},
        'started': {},
        'stopped': { param_types: [GObject.TYPE_OBJECT] },
    },
}, class RecorderWidget extends Gtk.Box {
    private _recorderBox!: Gtk.Box;
    private _playbackStack!: Gtk.Stack;
    private _recorderTime!: Gtk.Label;
    private _pauseBtn!: Gtk.Button;
    private _resumeBtn!: Gtk.Button;

    private recorder: RecorderClass;
    private waveform: WaveFormClass;
    public actionsGroup: Gio.SimpleActionGroup;

    constructor(recorder: RecorderClass) {
        super();
        this.recorder = recorder;

        this.waveform = new WaveForm({
            vexpand: true,
            valign: Gtk.Align.FILL,
        }, WaveType.Recorder);
        this._recorderBox.prepend(this.waveform);

        this.recorder.bind_property('current-peak', this.waveform, 'peak', GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.DEFAULT);
        this.recorder.connect('notify::duration', _recorder => {
            this._recorderTime.set_markup(formatTime(_recorder.duration));
        });


        const actions = [
            { name: 'start', callback: this.onStart.bind(this), enabled: true },
            { name: 'pause', callback: this.onPause.bind(this), enabled: false },
            { name: 'stop', callback: this.onStop.bind(this), enabled: false  },
            { name: 'resume', callback: this.onResume.bind(this), enabled: false },
            { name: 'cancel', callback: this.onCancel.bind(this), enabled: false },
        ];

        this.actionsGroup = new Gio.SimpleActionGroup();

        for (const { name, callback, enabled } of actions) {
            const action = new Gio.SimpleAction({ name, enabled });
            action.connect('activate', callback);
            this.actionsGroup.add_action(action);
        }

        const cancelAction = this.actionsGroup.lookup('cancel');
        const startAction = this.actionsGroup.lookup('start');
        startAction.bind_property('enabled', cancelAction, 'enabled', GObject.BindingFlags.INVERT_BOOLEAN);
    }

    private onPause(): void {
        this._playbackStack.visible_child_name = 'recorder-start';
        this.state = RecorderState.Paused;

        this.recorder.pause();
        this.emit('paused');
    }

    private onResume(): void {
        this._playbackStack.visible_child_name = 'recorder-pause';
        this.state = RecorderState.Recording;

        this.recorder.resume();
        this.emit('resumed');
    }

    private onStart(): void {
        this._playbackStack.visible_child_name = 'recorder-pause';
        this.state = RecorderState.Recording;

        this.recorder.start();
        this.emit('started');
    }

    private onCancel(): void {
        this.onPause();
        const dialog = new Gtk.MessageDialog({
            modal: true,
            destroy_with_parent: true,
            buttons: Gtk.ButtonsType.NONE,
            message_type: Gtk.MessageType.QUESTION,
            text: _('Delete recording?'),
            secondary_text: _('This recording will not be saved.'),
        });

        dialog.set_default_response(Gtk.ResponseType.NO);
        dialog.add_button(_('Resume'), Gtk.ResponseType.NO);
        dialog.add_button(_('Delete'), Gtk.ResponseType.YES)
            .add_css_class('destructive-action');
        
        dialog.set_transient_for(this.root as Gtk.Window);
        dialog.connect('response', (_, response: number) => {
            switch (response) {
            case Gtk.ResponseType.YES: {
                const recording = this.recorder.stop();
                this.state = RecorderState.Stopped;
                if (recording) {
                    recording.delete();
                }
                this.emit('canceled');
                break;
            }
            case Gtk.ResponseType.NO:
                this.onResume();
                break;
            }

            dialog.close();
        });

        dialog.show();
    }

    private onStop(): void {
        this.state = RecorderState.Stopped;
        const recording = this.recorder.stop();
        this.waveform.destroy();
        this.emit('stopped', recording);
    }

    public set state(recorderState: RecorderState) {
        const pauseAction = this.actionsGroup.lookup('pause') as Gio.SimpleAction;
        const resumeAction = this.actionsGroup.lookup('resume') as Gio.SimpleAction;
        const startAction = this.actionsGroup.lookup('start') as Gio.SimpleAction;
        const stopAction = this.actionsGroup.lookup('stop') as Gio.SimpleAction;

        switch (recorderState) {
        case RecorderState.Paused:
            pauseAction.enabled = false;
            resumeAction.enabled = true;
            this._resumeBtn.grab_focus();
            this._recorderTime.add_css_class('paused');
            break;
        case RecorderState.Recording:
            startAction.enabled = false;
            stopAction.enabled = true;
            resumeAction.enabled = false;
            pauseAction.enabled = true;
            this._pauseBtn.grab_focus();
            this._recorderTime.remove_css_class('paused');
            break;
        case RecorderState.Stopped:
            startAction.enabled = true;
            stopAction.enabled = false;
            pauseAction.enabled = false;
            resumeAction.enabled = false;
            break;
        }
    }
});
