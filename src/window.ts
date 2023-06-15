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

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gst from 'gi://Gst';
import GstPlayer from 'gi://GstPlayer';
import Gtk from 'gi://Gtk?version=4.0';

import { Recorder } from './recorder.js';
import { RecordingList } from './recordingList.js';
import { RecordingsListWidget } from './recordingListWidget.js';
import { RecorderWidget } from './recorderWidget.js';
import { Recording } from './recording.js';
import { Row } from './row.js';

enum WindowState {
    Empty,
    List,
    Recorder,
}

export class Window extends Adw.ApplicationWindow {
    private _mainStack!: Gtk.Stack;
    private _emptyPage!: Adw.StatusPage;
    private _column!: Adw.Clamp;
    private _headerRevealer!: Gtk.Revealer;
    private _toastOverlay!: Adw.ToastOverlay;

    private recorder: Recorder;
    private recorderWidget: RecorderWidget;
    private player: GstPlayer.Player;
    private recordingList: RecordingList;
    private itemsSignalId: number;
    private recordingListWidget: RecordingsListWidget;

    private toastUndo: boolean;
    private undoSignalID: number | null;
    private undoAction: Gio.SimpleAction;

    private _state: WindowState;

    static {
        GObject.registerClass(
            {
                Template: 'resource:///org/gnome/SoundRecorder/ui/window.ui',
                InternalChildren: [
                    'mainStack',
                    'emptyPage',
                    'column',
                    'headerRevealer',
                    'toastOverlay',
                ],
            },
            this
        );
    }

    constructor(params: Partial<Adw.Application.ConstructorProperties>) {
        super(params);

        this.iconName = pkg.name;
        this._state = WindowState.Empty;

        this.recorder = new Recorder();
        this.recorderWidget = new RecorderWidget(this.recorder);
        this._mainStack.add_named(this.recorderWidget, 'recorder');

        const dispatcher =
            GstPlayer.PlayerGMainContextSignalDispatcher.new(null);
        this.player = GstPlayer.Player.new(null, dispatcher);
        this.player.connect('end-of-stream', () => this.player.stop());

        this.recordingList = new RecordingList();
        this.itemsSignalId = this.recordingList.connect('items-changed', () => {
            if (this.state !== WindowState.Recorder) {
                if (this.recordingList.get_n_items() === 0)
                    this.state = WindowState.Empty;
                else this.state = WindowState.List;
            }
        });

        this.recordingListWidget = new RecordingsListWidget(
            this.recordingList,
            this.player
        );

        this.recordingListWidget.connect(
            'row-deleted',
            (_listBox: Gtk.ListBox, recording: Recording, index: number) => {
                this.recordingList.remove(index);
                let message: string;
                if (recording.name) {
                    message = _('"%s" deleted').format(recording.name);
                } else {
                    message = _('Recording deleted');
                }
                this.sendNotification(message, recording, index);
            }
        );

        this.toastUndo = false;
        this.undoSignalID = null;
        this.undoAction = new Gio.SimpleAction({ name: 'undo' });
        this.add_action(this.undoAction);

        const openMenuAction = new Gio.SimpleAction({
            name: 'open-primary-menu',
            state: new GLib.Variant('b', true),
        });
        openMenuAction.connect('activate', (action) => {
            const state = action.get_state()?.get_boolean();
            action.state = new GLib.Variant('b', !state);
        });
        this.add_action(openMenuAction);
        this._column.set_child(this.recordingListWidget);

        this.recorderWidget.connect(
            'started',
            this.onRecorderStarted.bind(this)
        );
        this.recorderWidget.connect(
            'canceled',
            this.onRecorderCanceled.bind(this)
        );
        this.recorderWidget.connect(
            'stopped',
            this.onRecorderStopped.bind(this)
        );
        this.insert_action_group('recorder', this.recorderWidget.actionsGroup);
        this._emptyPage.icon_name = `${pkg.name}-symbolic`;
    }

    public vfunc_close_request(): boolean {
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

    private onRecorderStarted(): void {
        this.player.stop();

        const activeRow = this.recordingListWidget.activeRow;
        if (activeRow && activeRow.editMode) activeRow.editMode = false;

        this.state = WindowState.Recorder;
    }

    private onRecorderCanceled(): void {
        if (this.recordingList.get_n_items() === 0)
            this.state = WindowState.Empty;
        else this.state = WindowState.List;
    }

    private onRecorderStopped(
        _widget: RecorderWidget,
        recording: Recording
    ): void {
        this.recordingList.insert(0, recording);
        const row = this.recordingListWidget.list.get_row_at_index(0) as Row;
        row.editMode = true;
        this.state = WindowState.List;
    }

    private sendNotification(
        message: string,
        recording: Recording,
        index: number
    ): void {
        const toast = Adw.Toast.new(message);
        toast.connect('dismissed', () => {
            if (!this.toastUndo) void recording.delete();

            this.toastUndo = false;
        });

        if (this.undoSignalID !== null)
            this.undoAction.disconnect(this.undoSignalID);

        this.undoSignalID = this.undoAction.connect('activate', () => {
            this.recordingList.insert(index, recording);
            this.toastUndo = true;
        });

        toast.set_action_name('win.undo');
        toast.set_button_label(_('Undo'));
        this._toastOverlay.add_toast(toast);
    }

    public set state(state: WindowState) {
        let visibleChild: string;
        let isHeaderVisible = true;

        switch (state) {
            case WindowState.Recorder:
                visibleChild = 'recorder';
                isHeaderVisible = false;
                break;
            case WindowState.List:
                visibleChild = 'recordings';
                break;
            case WindowState.Empty:
                visibleChild = 'empty';
                break;
        }

        this._mainStack.visible_child_name = visibleChild;
        this._headerRevealer.reveal_child = isHeaderVisible;
        this._state = state;
    }

    public get state(): WindowState {
        return this._state;
    }
}
