/* exported EncodingProfiles Recorder */
/*
 * Copyright 2013 Meg Ford
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public
 * License along with this library; if not, see <http://www.gnu.org/licenses/>.
 *
 *  Author: Meg Ford <megford@gnome.org>
 *
 */

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Gst from 'gi://Gst';
import GstPbutils from 'gi://GstPbutils';

import { RecordingsDir, Settings } from './application.js';
import { Recording } from './recording.js';

// All supported encoding profiles.
export const EncodingProfiles = [
    {
        name: 'VORBIS',
        containerCaps: 'application/ogg;audio/ogg;video/ogg',
        audioCaps: 'audio/x-vorbis',
        contentType: 'audio/x-vorbis+ogg',
        extension: 'ogg',
    },

    {
        name: 'OPUS',
        containerCaps: 'application/ogg',
        audioCaps: 'audio/x-opus',
        contentType: 'audio/x-opus+ogg',
        extension: 'opus',
    },

    {
        name: 'FLAC',
        containerCaps: 'audio/x-flac',
        audioCaps: 'audio/x-flac',
        contentType: 'audio/flac',
        extension: 'flac',
    },

    {
        name: 'MP3',
        containerCaps: 'application/x-id3',
        audioCaps: 'audio/mpeg,mpegversion=(int)1,layer=(int)3',
        contentType: 'audio/mpeg',
        extension: 'mp3',
    },

    {
        name: 'M4A',
        containerCaps: 'video/quicktime,variant=(string)iso',
        audioCaps: 'audio/mpeg,mpegversion=(int)4',
        contentType: 'video/mp4',
        extension: 'm4a',
    },
];

const AudioChannels = [
    { name: 'stereo', channels: 2 },
    { name: 'mono', channels: 1 },
];

export class Recorder extends GObject.Object {
    private peaks: number[];

    private _duration!: number;
    private _current_peak!: number;

    private pipeline: Gst.Pipeline;
    private level?: Gst.Element;
    private ebin?: Gst.Element;
    private filesink?: Gst.Element;
    private recordBus?: Gst.Bus | null;
    private handlerId?: number | null;
    private file?: Gio.File;
    private timeout?: number | null;
    private pipeState?: Gst.State;

    static {
        GObject.registerClass(
            {
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
                    'current-peak': GObject.ParamSpec.float(
                        'current-peak',
                        'Waveform current peak',
                        'Waveform current peak in float [0, 1]',
                        GObject.ParamFlags.READWRITE |
                            GObject.ParamFlags.CONSTRUCT,
                        0.0,
                        1.0,
                        0.0
                    ),
                },
            },
            this
        );
    }

    constructor() {
        super();
        this.peaks = [];

        let srcElement: Gst.Element;
        let audioConvert: Gst.Element;
        const caps = Gst.Caps.from_string('audio/x-raw');

        this.pipeline = new Gst.Pipeline({ name: 'pipe' });

        const elements = [
            ['pulsesrc', 'srcElement'],
            ['audioconvert', 'audioConvert'],
            ['level', 'level'],
            ['encodebin', 'ebin'],
            ['filesink', 'filesink'],
        ].map(([fac, name]) => {
            const element = Gst.ElementFactory.make(fac, name);
            if (!element) throw new Error('Not all elements could be created.');
            this.pipeline.add(element);
            return element;
        });

        [srcElement, audioConvert, this.level, this.ebin, this.filesink] =
            elements;

        srcElement.link(audioConvert);
        audioConvert.link_filtered(this.level, caps);
    }

    public start(): void {
        let index = 1;

        do {
            /* Translators: ""Recording %d"" is the default name assigned to a file created
            by the application (for example, "Recording 1"). */
            this.file = RecordingsDir.get_child_for_display_name(
                _('Recording %d').format(index++)
            );
        } while (this.file.query_exists(null));

        this.recordBus = this.pipeline.get_bus();
        this.recordBus.add_signal_watch();
        this.handlerId = this.recordBus.connect(
            'message',
            (_, message: Gst.Message) => {
                if (message) this.onMessageReceived(message);
            }
        );

        if (this.ebin && this.level && this.filesink) {
            this.ebin.set_property('profile', this.getProfile());
            this.filesink.set_property('location', this.file.get_path());
            this.level.link(this.ebin);
            this.ebin.link(this.filesink);
        }

        this.state = Gst.State.PLAYING;

        this.timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            const pos = this.pipeline.query_position(Gst.Format.TIME)[1];
            if (pos > 0) this.duration = pos;
            return true;
        });
    }

    public pause(): void {
        this.state = Gst.State.PAUSED;
    }

    public resume(): void {
        if (this.state === Gst.State.PAUSED) this.state = Gst.State.PLAYING;
    }

    public stop(): Recording | undefined {
        this.state = Gst.State.NULL;
        this.duration = 0;
        if (this.timeout) {
            GLib.source_remove(this.timeout);
            this.timeout = null;
        }

        if (this.recordBus && this.handlerId) {
            this.recordBus.remove_watch();
            this.recordBus.disconnect(this.handlerId);
            this.recordBus = null;
            this.handlerId = null;
        }

        if (
            this.file &&
            this.file.query_exists(null) &&
            this.peaks.length > 0
        ) {
            const recording = new Recording(this.file);
            recording.peaks = this.peaks.slice();
            this.peaks.length = 0;
            return recording;
        }

        return undefined;
    }

    private onMessageReceived(message: Gst.Message): void {
        switch (message.type) {
            case Gst.MessageType.ELEMENT: {
                if (GstPbutils.is_missing_plugin_message(message)) {
                    const detail =
                        GstPbutils.missing_plugin_message_get_installer_detail(
                            message
                        );
                    const description =
                        GstPbutils.missing_plugin_message_get_description(
                            message
                        );
                    log(`Detail: ${detail}\nDescription: ${description}`);
                    break;
                }

                const s = message.get_structure();
                if (s && s.has_name('level')) {
                    const peakVal = s.get_value(
                        'peak'
                    ) as unknown as GObject.ValueArray;

                    if (peakVal)
                        this.current_peak = peakVal.get_nth(0) as number;
                }
                break;
            }

            case Gst.MessageType.EOS:
                this.stop();
                break;
            case Gst.MessageType.WARNING: {
                const warning = message.parse_warning()[0];
                if (warning) {
                    log(warning.toString());
                }
                break;
            }
            case Gst.MessageType.ERROR:
                log(message.parse_error().toString());
                break;
        }
    }

    private getChannel(): number {
        const channelIndex = Settings.get_enum('audio-channel');
        return AudioChannels[channelIndex].channels;
    }

    private getProfile(): GstPbutils.EncodingContainerProfile | undefined {
        const profileIndex = Settings.get_enum('audio-profile');
        const profile = EncodingProfiles[profileIndex];

        const audioCaps = Gst.Caps.from_string(profile.audioCaps);
        audioCaps?.set_value('channels', this.getChannel());

        if (audioCaps) {
            const encodingProfile = GstPbutils.EncodingAudioProfile.new(
                audioCaps,
                null,
                null,
                1
            );
            const containerCaps = Gst.Caps.from_string(profile.containerCaps);
            if (containerCaps) {
                const containerProfile =
                    GstPbutils.EncodingContainerProfile.new(
                        'record',
                        null,
                        containerCaps,
                        null
                    );
                containerProfile.add_profile(encodingProfile);
                return containerProfile;
            }
        }

        return undefined;
    }

    public get duration(): number {
        return this._duration;
    }

    public set duration(val: number) {
        this._duration = val;
        this.notify('duration');
    }

    // eslint-disable-next-line camelcase
    public get current_peak(): number {
        return this._current_peak;
    }

    // eslint-disable-next-line camelcase
    public set current_peak(peak: number) {
        if (this.peaks) {
            if (peak > 0) peak = 0;

            this._current_peak = Math.pow(10, peak / 20);
            this.peaks.push(this._current_peak);
            this.notify('current-peak');
        }
    }

    public get state(): Gst.State | undefined {
        return this.pipeState;
    }

    public set state(s: Gst.State | undefined) {
        this.pipeState = s;
        if (this.pipeState) {
            const ret = this.pipeline.set_state(this.pipeState);

            if (ret === Gst.StateChangeReturn.FAILURE)
                log('Unable to update the recorder pipeline state');
        }
    }
}
