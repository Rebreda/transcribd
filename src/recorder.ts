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

import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gio from "gi://Gio";
import Gst from "gi://Gst";
import GstPbutils from "gi://GstPbutils";

import { RecordingsDir, Settings } from "./application.js";
import { Recording } from "./recording.js";

// All supported encoding profiles.
export const EncodingProfiles = [
    {
        name: "VORBIS",
        containerCaps: "application/ogg;audio/ogg;video/ogg",
        audioCaps: "audio/x-vorbis",
        contentType: "audio/x-vorbis+ogg",
        extension: "ogg",
    },

    {
        name: "OPUS",
        containerCaps: "application/ogg",
        audioCaps: "audio/x-opus",
        contentType: "audio/x-opus+ogg",
        extension: "opus",
    },

    {
        name: "FLAC",
        containerCaps: "audio/x-flac",
        audioCaps: "audio/x-flac",
        contentType: "audio/flac",
        extension: "flac",
    },

    {
        name: "MP3",
        containerCaps: "application/x-id3",
        audioCaps: "audio/mpeg,mpegversion=(int)1,layer=(int)3",
        contentType: "audio/mpeg",
        extension: "mp3",
    },

    {
        name: "M4A",
        containerCaps: "video/quicktime,variant=(string)iso",
        audioCaps: "audio/mpeg,mpegversion=(int)4",
        contentType: "video/mp4",
        extension: "m4a",
    },
];

const AudioChannels = [
    { name: "stereo", channels: 2 },
    { name: "mono", channels: 1 },
];

interface AppSinkLike extends Gst.Element {
    try_pull_sample(timeout: number): Gst.Sample | null;
}

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

    // Transcription tee branch (only present when transcription is enabled)
    private appsink: AppSinkLike | null = null;
    private appsinkPollId: number | null = null;
    private teeBranchElements: Gst.Element[] = [];

    static {
        GObject.registerClass(
            {
                Signals: {
                    "audio-chunk": {
                        param_types: [GObject.TYPE_JSOBJECT],
                    },
                },
                Properties: {
                    duration: GObject.ParamSpec.int(
                        "duration",
                        "Recording Duration",
                        "Recording duration in nanoseconds",
                        GObject.ParamFlags.READWRITE |
                            GObject.ParamFlags.CONSTRUCT,
                        0,
                        GLib.MAXINT16,
                        0,
                    ),
                    "current-peak": GObject.ParamSpec.float(
                        "current-peak",
                        "Waveform current peak",
                        "Waveform current peak in float [0, 1]",
                        GObject.ParamFlags.READWRITE |
                            GObject.ParamFlags.CONSTRUCT,
                        0.0,
                        1.0,
                        0.0,
                    ),
                },
            },
            this,
        );
    }

    constructor() {
        super();
        this.peaks = [];

        const caps = Gst.Caps.from_string("audio/x-raw");

        this.pipeline = new Gst.Pipeline({ name: "pipe" });

        const elements = (
            [
                ["pulsesrc", "srcElement"],
                ["audioconvert", "audioConvert"],
                ["level", "level"],
                ["encodebin", "ebin"],
                ["filesink", "filesink"],
            ] as [string, string][]
        ).map(([fac, name]) => {
            const element = Gst.ElementFactory.make(fac, name);
            if (!element) throw new Error("Not all elements could be created.");
            this.pipeline.add(element);
            return element;
        }) as [Gst.Element, Gst.Element, Gst.Element, Gst.Element, Gst.Element];

        const [srcElement, audioConvert, level, ebin, filesink] = elements;
        this.level = level;
        this.ebin = ebin;
        this.filesink = filesink;

        srcElement.link(audioConvert);
        audioConvert.link_filtered(this.level, caps);
    }

    public start(): void {
        let index = 1;

        do {
            /* Translators: ""Recording %d"" is the default name assigned to a file created
            by the application (for example, "Recording 1"). */
            this.file = RecordingsDir.get_child_for_display_name(
                _("Recording %d").format(index++),
            );
        } while (this.file.query_exists(null));

        this.recordBus = this.pipeline.get_bus();
        this.recordBus.add_signal_watch();
        this.handlerId = this.recordBus.connect(
            "message",
            (_, message: Gst.Message) => {
                if (message) this.onMessageReceived(message);
            },
        );

        if (this.ebin && this.level && this.filesink) {
            this.ebin.set_property("profile", this.getProfile());
            this.filesink.set_property("location", this.file.get_path());

            if (Settings.get_boolean("transcription-enabled")) {
                this._setupTranscriptionBranch();
            } else {
                this.level.link(this.ebin);
            }

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
        // Block appsink before tearing down so no callbacks fire after NULL state
        if (this.appsink) {
            try {
                const sinkPad = this.appsink.get_static_pad("sink");
                sinkPad?.add_probe(
                    Gst.PadProbeType.BLOCK_DOWNSTREAM,
                    () => Gst.PadProbeReturn.DROP,
                );
            } catch (_e) {
                // ignore
            }
        }

        this.state = Gst.State.NULL;
        this.duration = 0;
        this.appsink = null;
        if (this.appsinkPollId !== null) {
            GLib.source_remove(this.appsinkPollId);
            this.appsinkPollId = null;
        }

        // Remove tee branch elements added this recording so they can be recreated next time
        for (const el of this.teeBranchElements) {
            this.pipeline.remove(el);
        }
        this.teeBranchElements = [];

        // Unlink level.src so the next start() can link it freely regardless of mode
        const levelSrc = this.level?.get_static_pad("src");
        if (levelSrc) {
            const peer = levelSrc.get_peer();
            if (peer) levelSrc.unlink(peer);
        }
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
                            message,
                        );
                    const description =
                        GstPbutils.missing_plugin_message_get_description(
                            message,
                        );
                    log(`Detail: ${detail}\nDescription: ${description}`);
                    break;
                }

                const s = message.get_structure();
                if (s && s.has_name("level")) {
                    const peakVal = s.get_value(
                        "peak",
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
        const channelIndex = Settings.get_enum("audio-channel");
        return AudioChannels[channelIndex]?.channels ?? 2;
    }

    private getProfile(): GstPbutils.EncodingContainerProfile | undefined {
        const profileIndex = Settings.get_enum("audio-profile");
        const profile = EncodingProfiles[profileIndex];
        if (!profile) return undefined;

        const audioCaps = Gst.Caps.from_string(profile.audioCaps);
        audioCaps?.set_value("channels", this.getChannel());

        if (audioCaps) {
            const encodingProfile = GstPbutils.EncodingAudioProfile.new(
                audioCaps,
                null,
                null,
                1,
            );
            const containerCaps = Gst.Caps.from_string(profile.containerCaps);
            if (containerCaps) {
                const containerProfile =
                    GstPbutils.EncodingContainerProfile.new(
                        "record",
                        null,
                        containerCaps,
                        null,
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
        this.notify("duration");
    }

    public get current_peak(): number {
        return this._current_peak;
    }

    public set current_peak(peak: number) {
        if (peak > 0) peak = 0;

        const value = Math.pow(10, peak / 20);
        // Guard against NaN/Infinity (e.g. -Infinity dBFS during silence)
        if (!Number.isFinite(value) || Number.isNaN(value)) return;

        this._current_peak = value;
        // this.peaks is undefined during GObject CONSTRUCT (before super() returns)
        this.peaks?.push(this._current_peak);
        this.notify("current-peak");
    }

    public get state(): Gst.State | undefined {
        return this.pipeState;
    }

    public set state(s: Gst.State) {
        this.pipeState = s;
        const ret = this.pipeline.set_state(s);
        if (ret === Gst.StateChangeReturn.FAILURE)
            log("Unable to update the recorder pipeline state");
    }

    private _setupTranscriptionBranch(): void {
        if (!this.level || !this.ebin) return;

        const gstAppNamespace = (imports.gi as unknown as Record<string, unknown>).GstApp;
        if (!gstAppNamespace) {
            log("TranscriberBranch: GstApp namespace unavailable, falling back to direct link");
            this.level.link(this.ebin);
            return;
        }

        const tee = Gst.ElementFactory.make("tee", "transcription-tee");
        const queue1 = Gst.ElementFactory.make("queue", "enc-queue");
        const queue2 = Gst.ElementFactory.make("queue", "pcm-queue");
        const resample = Gst.ElementFactory.make("audioresample", "transcription-resample");
        const convert = Gst.ElementFactory.make("audioconvert", "transcription-convert");
        const capsfilter = Gst.ElementFactory.make("capsfilter", "transcription-caps");
        const appsinkElement = Gst.ElementFactory.make("appsink", "transcription-sink");

        if (!tee || !queue1 || !queue2 || !resample || !convert || !capsfilter || !appsinkElement) {
            log("TranscriberBranch: could not create all elements, falling back to direct link");
            this.level.link(this.ebin);
            return;
        }

        const appsink = appsinkElement as AppSinkLike;

        // PCM16 mono 16kHz — required by Lemonade /realtime
        const pcmCaps = Gst.Caps.from_string(
            "audio/x-raw,format=S16LE,rate=16000,channels=1",
        );
        capsfilter.set_property("caps", pcmCaps);

        appsink.set_property("sync", false);
        appsink.set_property("async", false);
        appsink.set_property("max-buffers", 200);
        appsink.set_property("drop", true); // drop old samples rather than blocking the pipeline

        for (const el of [tee, queue1, queue2, resample, convert, capsfilter, appsinkElement]) {
            this.pipeline.add(el);
        }

        // level → tee
        this.level.link(tee);

        // tee branch 1: → queue1 → ebin (the encoder path)
        tee.link(queue1);
        queue1.link(this.ebin);

        // tee branch 2: → queue2 → resample → convert → capsfilter → appsink
        tee.link(queue2);
        queue2.link(resample);
        resample.link(convert);
        convert.link(capsfilter);
        capsfilter.link(appsinkElement);

        // Poll for samples on the main thread every 20 ms (avoids cross-thread JSAPI calls)
        this.appsinkPollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
            if (!this.appsink) return GLib.SOURCE_REMOVE;
            const sample = this.appsink.try_pull_sample(0);
            if (sample) {
                const buffer = sample.get_buffer();
                if (buffer) {
                    const [ok, mapInfo] = buffer.map(Gst.MapFlags.READ);
                    if (ok) {
                        const chunkBytes = GLib.Bytes.new(mapInfo.data as unknown as Uint8Array);
                        this.emit("audio-chunk", chunkBytes);
                        buffer.unmap(mapInfo);
                    }
                }
            }
            return GLib.SOURCE_CONTINUE;
        });

        this.appsink = appsink;
        this.teeBranchElements = [tee, queue1, queue2, resample, convert, capsfilter, appsinkElement];
    }
}
