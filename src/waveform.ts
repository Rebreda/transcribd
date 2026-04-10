/* exported WaveForm
/*
 * Copyright 2013 Meg Ford
             2020 Kavan Mevada
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
 *          Kavan Mevada <kavanmevada@gmail.com>
 *
 */

// based on code from Pitivi

import Adw from "gi://Adw";
import GObject from "gi://GObject";
import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import Cairo from "cairo";

export enum WaveType {
    Recorder,
    Player,
}

const GUTTER = 4;

export class WaveForm extends Gtk.DrawingArea {
    private _peaks: number[];
    private _position: number;
    private dragGesture?: Gtk.GestureDrag;
    private hcId: number;
    private accentId: number;
    private lastX?: number;

    private waveType: WaveType;

    static {
        GObject.registerClass(
            {
                Properties: {
                    position: GObject.ParamSpec.float(
                        "position",
                        "Waveform position",
                        "Waveform position",
                        GObject.ParamFlags.READWRITE |
                            GObject.ParamFlags.CONSTRUCT,
                        0.0,
                        1.0,
                        0.0,
                    ),
                    peak: GObject.ParamSpec.float(
                        "peak",
                        "Waveform current peak",
                        "Waveform current peak in float [0, 1]",
                        GObject.ParamFlags.READWRITE |
                            GObject.ParamFlags.CONSTRUCT,
                        0.0,
                        1.0,
                        0.0,
                    ),
                },
                Signals: {
                    "position-changed": { param_types: [GObject.TYPE_DOUBLE] },
                    "gesture-pressed": {},
                },
            },
            this,
        );
    }

    constructor(
        params: Partial<Gtk.DrawingArea.ConstructorProps> | undefined,
        type: WaveType,
    ) {
        super(params);
        this._peaks = [];
        this._position = 0;
        this.waveType = type;

        if (this.waveType === WaveType.Player) {
            this.dragGesture = Gtk.GestureDrag.new();
            this.dragGesture.connect("drag-begin", this.dragBegin.bind(this));
            this.dragGesture.connect("drag-update", this.dragUpdate.bind(this));
            this.dragGesture.connect("drag-end", this.dragEnd.bind(this));
            this.add_controller(this.dragGesture);
        }

        const styleManager = Adw.StyleManager.get_default();
        this.hcId = styleManager.connect("notify::high-contrast", () => {
            this.queue_draw();
        });
        this.accentId = styleManager.connect("notify::accent-color", () => {
            this.queue_draw();
        });

        this.set_draw_func(this.drawFunc.bind(this));
    }

    private dragBegin(gesture: Gtk.GestureDrag): void {
        gesture.set_state(Gtk.EventSequenceState.CLAIMED);
        this.emit("gesture-pressed");
    }

    private dragUpdate(_gesture: Gtk.GestureDrag, offsetX: number): void {
        if (this.lastX) {
            this._position = this.clamped(offsetX + this.lastX);
            this.queue_draw();
        }
    }

    private dragEnd(): void {
        this.lastX = this._position;
        this.emit("position-changed", this.position);
    }

    private drawFunc(superDa: Gtk.DrawingArea, ctx: Cairo.Context) {
        const da = superDa as WaveForm;
        const maxHeight = da.get_allocated_height();
        const vertiCenter = maxHeight / 2;
        const horizCenter = da.get_allocated_width() / 2;

        let pointer = horizCenter + da._position;

        const styleManager = Adw.StyleManager.get_default();

        const leftColor = da.get_color();
        const rightColor = da.get_color();
        rightColor.alpha *= styleManager.high_contrast ? 0.9 : 0.55;

        let dividerColor;

        if (da.waveType === WaveType.Player) {
            const accent = styleManager.accent_color;
            const dark = styleManager.dark;

            dividerColor = Adw.accent_color_to_standalone_rgba(accent, dark);
        } else {
            const styleContext = da.get_style_context();
            const lookupColor = styleContext.lookup_color("destructive_color");
            const ok = lookupColor[0];
            dividerColor = lookupColor[1];
            if (!ok) dividerColor = da.get_color();
        }

        ctx.setLineCap(Cairo.LineCap.SQUARE);
        ctx.setAntialias(Cairo.Antialias.NONE);
        ctx.setLineWidth(1);

        da.setSourceRGBA(ctx, dividerColor);

        ctx.moveTo(horizCenter, vertiCenter - maxHeight);
        ctx.lineTo(horizCenter, vertiCenter + maxHeight);
        ctx.stroke();

        ctx.setLineWidth(2);

        for (const peak of da._peaks) {
            // don't try to render peaks outside the widget's width
            if (pointer > da.get_allocated_width()) {
                break;
            }

            // don't try to draw peaks before the widget's left edge
            if (pointer > 0) {
                if (da.waveType === WaveType.Player && pointer > horizCenter)
                    da.setSourceRGBA(ctx, rightColor);
                else da.setSourceRGBA(ctx, leftColor);

                ctx.moveTo(pointer, vertiCenter + peak * maxHeight);
                ctx.lineTo(pointer, vertiCenter - peak * maxHeight);
                ctx.stroke();
            }

            if (da.waveType === WaveType.Player) pointer += GUTTER;
            else pointer -= GUTTER;
        }
    }

    public set peak(p: number) {
        if (this._peaks) {
            if (this._peaks.length > this.get_allocated_width() / (2 * GUTTER))
                this._peaks.pop();

            this._peaks.unshift(parseFloat(p.toFixed(2)));
            this.queue_draw();
        }
    }

    public set peaks(p: number[]) {
        this._peaks = p;
        this.queue_draw();
    }

    public set position(pos: number) {
        if (this._peaks) {
            this._position = this.clamped(-pos * this._peaks.length * GUTTER);
            this.lastX = this._position;
            this.queue_draw();
            this.notify("position");
        }
    }

    public get position(): number {
        return -this._position / (this._peaks.length * GUTTER);
    }

    private clamped(position: number): number {
        if (position > 0) position = 0;
        else if (position < -this._peaks.length * GUTTER)
            position = -this._peaks.length * GUTTER;

        return position;
    }

    private setSourceRGBA(cr: Cairo.Context, rgba: Gdk.RGBA): void {
        cr.setSourceRGBA(rgba.red, rgba.green, rgba.blue, rgba.alpha);
    }

    public destroy(): void {
        Adw.StyleManager.get_default().disconnect(this.hcId);
        Adw.StyleManager.get_default().disconnect(this.accentId);
        this._peaks.length = 0;
        this.queue_draw();
    }
}
