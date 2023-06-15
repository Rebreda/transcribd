/* exported Recording */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gst from 'gi://Gst';
import GstPbutils from 'gi://GstPbutils';

import { CacheDir } from './application.js';
import { EncodingProfiles } from './recorder.js';

function isNumArray(input: unknown): input is number[] {
    return Array.isArray(input) && input.every((i) => typeof i === 'number');
}

export class Recording extends GObject.Object {
    private _file: Gio.File;
    private _peaks: number[];
    private loadedPeaks: number[];
    private _extension?: string;
    private _timeModified: GLib.DateTime;
    private _timeCreated: GLib.DateTime;
    private _duration?: number;

    public pipeline?: Gst.Bin | null;

    static {
        GObject.registerClass(
            {
                Signals: {
                    'peaks-updated': {},
                    'peaks-loading': {},
                },
                Properties: {
                    duration: GObject.ParamSpec.int(
                        'duration',
                        'Recording Duration',
                        'Recording duration in nanoseconds',
                        GObject.ParamFlags.READWRITE |
                            GObject.ParamFlags.CONSTRUCT,
                        0,
                        GLib.MAXINT16,
                        0
                    ),
                    name: GObject.ParamSpec.string(
                        'name',
                        'Recording Name',
                        'Recording name in string',
                        GObject.ParamFlags.READWRITE |
                            GObject.ParamFlags.CONSTRUCT,
                        ''
                    ),
                },
            },
            this
        );
    }

    constructor(file: Gio.File) {
        super();

        this._file = file;
        this._peaks = [];
        this.loadedPeaks = [];

        const info = file.query_info(
            'time::created,time::modified,standard::content-type',
            0,
            null
        );
        const contentType = info.get_attribute_string('standard::content-type');

        for (const profile of EncodingProfiles) {
            if (profile.contentType === contentType) {
                this._extension = profile.extension;
                break;
            }
        }

        const timeModified = info.get_attribute_uint64('time::modified');
        const timeCreated = info.get_attribute_uint64('time::created');
        this._timeModified = GLib.DateTime.new_from_unix_local(timeModified);
        this._timeCreated = GLib.DateTime.new_from_unix_local(timeCreated);

        const discoverer = new GstPbutils.Discoverer();
        discoverer.start();
        discoverer.connect('discovered', (_discoverer, audioInfo) => {
            this._duration = audioInfo.get_duration();

            this.notify('duration');
        });

        discoverer.discover_uri_async(this.uri);
    }

    public get name(): string | null {
        return this._file.get_basename();
    }

    public set name(filename: string | null) {
        if (filename && filename !== this.name) {
            this._file = this._file.set_display_name(filename, null);
            this.notify('name');
        }
    }

    public get extension(): string | undefined {
        return this._extension;
    }

    public get timeModified(): GLib.DateTime {
        return this._timeModified;
    }

    public get timeCreated(): GLib.DateTime {
        return this._timeCreated;
    }

    public get duration(): number {
        if (this._duration) return this._duration;
        else return 0;
    }

    public get file(): Gio.File {
        return this._file;
    }

    public get uri(): string {
        return this._file.get_uri();
    }

    // eslint-disable-next-line camelcase
    public set peaks(data: number[]) {
        if (data.length > 0) {
            this._peaks = data;
            this.emit('peaks-updated');
            const enc = new TextEncoder();
            const contents = enc.encode(JSON.stringify(data));
            this.waveformCache.replace_contents_async(
                contents,
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null,
                null
            );
        }
    }

    // eslint-disable-next-line camelcase
    public get peaks(): number[] {
        return this._peaks;
    }

    public async delete(): Promise<void> {
        await this._file.trash_async(GLib.PRIORITY_HIGH, null);
        await this.waveformCache.trash_async(GLib.PRIORITY_DEFAULT, null);
    }

    public save(dest: Gio.File): void {
        this.file.copy_async(
            dest,
            Gio.FileCreateFlags.NONE,
            GLib.PRIORITY_DEFAULT,
            null,
            // @ts-expect-error TypeScript isn't reading async function params correctly
            null,
            (obj: Gio.File, res: Gio.AsyncResult) => {
                if (obj.copy_finish(res)) log('Exporting file: done');
            }
        );
    }

    public get waveformCache(): Gio.File {
        return CacheDir.get_child(`${this.name}_data`);
    }

    public async loadPeaks(): Promise<void> {
        try {
            const bytes = (await this.waveformCache.load_bytes_async(null))[0];
            const decoder = new TextDecoder('utf-8');
            if (bytes) {
                const data = bytes.get_data();
                if (data) {
                    const parsedJSON: unknown = JSON.parse(
                        decoder.decode(data)
                    );
                    if (isNumArray(parsedJSON)) {
                        this._peaks = parsedJSON;
                        this.emit('peaks-updated');
                    } else {
                        throw new GLib.NumberParserError({
                            message: 'Failed to parse waveform',
                            code: GLib.NumberParserError.INVALID,
                        });
                    }
                }
            }
        } catch (error) {
            if (error instanceof GLib.Error) {
                log(`Error reading waveform data file: ${error.message}`);
                if (
                    error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND) ||
                    error.matches(
                        GLib.NumberParserError,
                        GLib.NumberParserError.INVALID
                    )
                ) {
                    this.emit('peaks-loading');
                    this.generatePeaks();
                }
            }
        }
    }

    private generatePeaks(): void {
        this.pipeline = Gst.parse_launch(
            'uridecodebin name=uridecodebin ! audioconvert ! audio/x-raw,channels=1 ! level name=level ! fakesink name=faked'
        ) as Gst.Bin;

        const uridecodebin = this.pipeline.get_by_name('uridecodebin');
        uridecodebin?.set_property('uri', this.uri);

        const fakesink = this.pipeline.get_by_name('faked');
        fakesink?.set_property('qos', false);
        fakesink?.set_property('sync', true);

        const bus = this.pipeline.get_bus();
        this.pipeline.set_state(Gst.State.PLAYING);
        bus?.add_signal_watch();

        bus?.connect('message', (_bus: Gst.Bus, message: Gst.Message) => {
            switch (message.type) {
                case Gst.MessageType.ELEMENT: {
                    const s = message.get_structure();
                    if (s && s.has_name('level')) {
                        const peakVal = s.get_value(
                            'peak'
                        ) as unknown as GObject.ValueArray;

                        if (peakVal) {
                            const peak = peakVal.get_nth(0) as number;
                            this.loadedPeaks.push(Math.pow(10, peak / 20));
                        }
                    }
                    break;
                }
                case Gst.MessageType.EOS:
                    this.peaks = this.loadedPeaks;
                    this.pipeline?.set_state(Gst.State.NULL);
                    this.pipeline = null;
                    break;
            }
        });
    }
}
