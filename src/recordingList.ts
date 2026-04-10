/* exported RecordingList */
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";

import { RecordingsDir } from "./application.js";
import { Recording } from "./recording.js";
import { SearchIndex } from "./searchIndex.js";

export class RecordingList extends Gio.ListStore {
    private enumerator?: Gio.FileEnumerator;
    private trackedRecordings = new WeakSet<Recording>();

    public cancellable: Gio.Cancellable;
    public dirMonitor: Gio.FileMonitor;

    static {
        GObject.registerClass(
            {
                Signals: {
                    "loading-changed": { param_types: [GObject.TYPE_BOOLEAN] },
                },
            },
            this,
        );
    }

    private loading = true;

    constructor() {
        super();
        this.cancellable = new Gio.Cancellable();
        // Monitor Direcotry actions
        this.dirMonitor = RecordingsDir.monitor_directory(
            Gio.FileMonitorFlags.WATCH_MOVES,
            this.cancellable,
        );
        this.dirMonitor.connect(
            "changed",
            (_dirMonitor, file1, _file2, eventType) => {
                const index = this.getIndex(file1);

                switch (eventType) {
                    case Gio.FileMonitorEvent.MOVED_OUT:
                        if (index >= 0) {
                            const recording = this.get_item(index) as Recording;
                            this.remove(index);
                            void SearchIndex.getDefault().deleteRecording(recording.uri);
                        }
                        break;
                    case Gio.FileMonitorEvent.MOVED_IN:
                        if (index === -1)
                            this.sortedInsert(new Recording(file1));
                        break;
                }
            },
        );

        void RecordingsDir.enumerate_children_async(
            "standard::name",
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            GLib.PRIORITY_LOW,
            this.cancellable,
        ).then(async (enumerator) => {
            await this.enumerateDirectory(enumerator);
        });
    }

    private async enumerateDirectory(
        enumerator: Gio.FileEnumerator,
    ): Promise<void> {
        this.enumerator = enumerator;
        if (this.enumerator === null) {
            log("The contents of the Recordings directory were not indexed.");
            this._setLoading(false);
            return;
        }

        try {
            for (
                let fileInfos = await this.nextFiles();
                fileInfos.length > 0;
                fileInfos = await this.nextFiles()
            ) {
                fileInfos.forEach((info) => {
                    const file = RecordingsDir.get_child(info.get_name());
                    const recording = new Recording(file);
                    this.sortedInsert(recording);
                });
            }

            this.enumerator?.close(this.cancellable);
        } catch (e: unknown) {
            if (e instanceof GLib.Error) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.error(`Failed to load recordings ${e.message}`);
            }
        } finally {
            this._setLoading(false);
        }
    }

    private async nextFiles(): Promise<Gio.FileInfo[]> {
        const fileInfos = await this.enumerator?.next_files_async(
            5,
            GLib.PRIORITY_LOW,
            this.cancellable,
        );
        // We check this here because the return value isn't stated as nullable in Gio.
        return fileInfos ? fileInfos : [];
    }

    private getIndex(file: Gio.File): number {
        for (let i = 0; i < this.get_n_items(); i++) {
            const item = this.get_item(i) as Recording;
            if (item.uri === file.get_uri()) return i;
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

        if (!added) this.append(recording);

        this._watchRecording(recording);

        void recording.persistedReady
            .then(() => {
                this._emitRecordingChanged(recording);
            })
            .catch((error) => {
                console.error(
                    "[RecordingList] Failed to index recording:",
                    error instanceof Error ? error.message : String(error),
                );
            });
    }

    private _watchRecording(recording: Recording): void {
        if (this.trackedRecordings.has(recording)) return;
        this.trackedRecordings.add(recording);

        for (const signal of [
            "notify::name",
            "notify::category",
            "notify::transcription",
            "notify::duration",
            "metadata-changed",
        ]) {
            recording.connect(signal, () => {
                this._emitRecordingChanged(recording);
            });
        }
    }

    private _emitRecordingChanged(recording: Recording): void {
        const index = this.getIndex(recording.file);
        if (index >= 0) {
            this.items_changed(index, 1, 1);
        }
    }

    private _setLoading(next: boolean): void {
        if (this.loading === next) return;
        this.loading = next;
        this.emit("loading-changed", next);
    }
}
