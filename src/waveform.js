
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

const { Gdk, Gio, GObject, Gtk } = imports.gi;
const Cairo = imports.cairo;

var WaveType = {
    RECORDER: 0,
    PLAYER: 1,
};

const GUTTER = 4;
const IsDark = new Gio.Settings({ schema: 'org.gnome.desktop.interface' }).get_string('gtk-theme').endsWith('dark');

var WaveForm = GObject.registerClass({
    Properties: {
        'position': GObject.ParamSpec.float(
            'position',
            'Waveform position', 'Waveform position',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
            0.0, 1.0, 0.0),
        'peak': GObject.ParamSpec.float(
            'peak',
            'Waveform current peak', 'Waveform current peak in float [0, 1]',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
            0.0, 1.0, 0.0),
    },
    Signals: {
        'position-changed': {  param_types: [GObject.TYPE_FLOAT]  },
        'gesture-pressed': {},
    },
}, class WaveForm extends Gtk.DrawingArea {
    _init(params, type) {
        this._peaks = [];
        this._position = 0;
        this.lastPosition = 0;
        this.waveType = type;
        super._init(params);

        this.rightColor = (IsDark ? [80, 80, 80] : [192, 191, 188]).map(x => x / 255);
        this.leftColor = (IsDark ? [192, 191, 188] : [46, 52, 54]).map(x => x / 255);
        this.dividerColor = (this.waveType === WaveType.PLAYER ? [28, 113, 216] : [255, 0, 0]).map(x => x / 255);

        // TODO: Figure out how to mesh these gestures with the row-activated cb and
        // new event handling
        if (this.waveType === WaveType.PLAYER) {
            this.clickGesture = Gtk.GestureClick.new();
            this.clickGesture.connect('pressed', this.gesturePressed.bind(this));
            this.clickGesture.connect('released', this.gestureReleased.bind(this));
            this.add_controller(this.clickGesture);

            this.motionGesture = Gtk.EventControllerMotion.new();
            this.motionGesture.connect('motion', this.onMotion.bind(this));
        }

        this.set_draw_func(this.drawFunc);

        this.show();
    }

    gesturePressed(n_press, x, y) {
        this._startX = x;
        this.emit('gesture-pressed');
    }

    onMotion(x, y) {
        this._position = this._clamped(x - this._startX + this._lastX);
        this.queue_draw();
    }

    gestureReleased(n_press, x, y) {
        this._lastX = this._position;
        this.emit('position-changed', this.position);
    }

    drawFunc(da, ctx, width, height) {
        const maxHeight = da.get_allocated_height();
        const vertiCenter = maxHeight / 2;
        const horizCenter = da.get_allocated_width() / 2;

        let pointer = horizCenter + da._position;

        ctx.setLineCap(Cairo.LineCap.ROUND);
        ctx.setLineWidth(2);

        ctx.setSourceRGB(...da.dividerColor);

        ctx.moveTo(horizCenter, vertiCenter - maxHeight);
        ctx.lineTo(horizCenter, vertiCenter + maxHeight);
        ctx.stroke();

        ctx.setLineWidth(1);

        da._peaks.forEach(peak => {
            if (da.waveType === WaveType.PLAYER) {
                if (pointer > horizCenter)
                    ctx.setSourceRGB(...da.rightColor);
                else
                    ctx.setSourceRGB(...da.leftColor);
            } else {
                ctx.setSourceRGB(...da.leftColor);
            }

            ctx.moveTo(pointer, vertiCenter + peak * maxHeight);
            ctx.lineTo(pointer, vertiCenter - peak * maxHeight);
            ctx.stroke();

            if (da.waveType === WaveType.PLAYER)
                pointer += GUTTER;
            else
                pointer -= GUTTER;
        });
    }

    set peak(p) {
        if (this._peaks.length > this.get_allocated_width() / (2 * GUTTER))
            this._peaks.pop();

        this._peaks.unshift(p.toFixed(2));
        this.queue_draw();
    }

    set peaks(p) {
        this._peaks = p;
        this.queue_draw();
    }

    set position(pos) {
        this._position = this._clamped(-pos * this._peaks.length * GUTTER);
        this._lastX = this._position;
        this.queue_draw();
        this.notify('position');
    }

    get position() {
        return -this._position / (this._peaks.length * GUTTER);
    }

    _clamped(position) {
        if (position > 0)
            position = 0;
        else if (position < -this._peaks.length * GUTTER)
            position = -this._peaks.length * GUTTER;

        return position;
    }

    destroy() {
        this._peaks.length = 0;
        this.queue_draw();
    }
});
