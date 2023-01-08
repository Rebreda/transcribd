/* exported RecordingList */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import { RecordingsDir } from './application.js';
import { Recording } from './recording.js';

export class RecordingList extends Gio.ListStore {
    private enumerator?: Gio.FileEnumerator;

    public cancellable: Gio.Cancellable;
    public dirMonitor: Gio.FileMonitor;

    static {
        GObject.registerClass(this);
    }

    constructor() {
        super();
        this.cancellable = new Gio.Cancellable();
        // Monitor Direcotry actions
        this.dirMonitor = RecordingsDir.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, this.cancellable);
        this.dirMonitor.connect('changed', (_dirMonitor, file1, file2, eventType) => {
            const index = this.getIndex(file1);

            switch (eventType) {
            case Gio.FileMonitorEvent.MOVED_OUT:
                if (index >= 0)
                    this.remove(index);
                break;
            case Gio.FileMonitorEvent.MOVED_IN:
                if (index === -1)
                    this.sortedInsert(new Recording(file1));
                break;
            }

        });

        RecordingsDir.enumerate_children_async('standard::name',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            GLib.PRIORITY_LOW,
            this.cancellable,
            this.enumerateDirectory.bind(this));
    }

    private enumerateDirectory(obj: Gio.File | null, res: Gio.AsyncResult): void {
        this.enumerator = obj?.enumerate_children_finish(res);
        if (this.enumerator === null) {
            log('The contents of the Recordings directory were not indexed.');
            return;
        }
        this.enumerator?.next_files_async(5, GLib.PRIORITY_LOW, this.cancellable, this.onNextFiles.bind(this));
    }

    private onNextFiles(obj: Gio.FileEnumerator | null, res: Gio.AsyncResult): void {
        try {
            const fileInfos = obj?.next_files_finish(res);
            if (fileInfos && fileInfos.length) {
                fileInfos.forEach(info => {
                    const file = RecordingsDir.get_child(info.get_name());
                    const recording = new Recording(file);
                    this.sortedInsert(recording);
                });
                this.enumerator?.next_files_async(5, GLib.PRIORITY_LOW, this.cancellable, this.onNextFiles.bind(this));
            } else {
                this.enumerator?.close(this.cancellable);
            }
        } catch (e: unknown) {
            if (e instanceof GLib.Error) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.error(`Failed to load recordings ${e}`);
            }
        }
    }

    private getIndex(file: Gio.File): number {
        for (let i = 0; i < this.get_n_items(); i++) {
            const item = this.get_item(i) as Recording;
            if (item.uri === file.get_uri())
                return i;
        }
        return -1;
    }

    private sortedInsert(recording: Recording): void {
        let added = false;

        for (let i = 0; i < this.get_n_items(); i++) {
            const curr = this.get_item(i) as Recording;
            if (curr.timeModified.difference(recording.timeModified) <= 0) {
                this.insert(i, recording);
                added = true;
                break;
            }
        }

        if (!added)
            this.append(recording);
    }
}
