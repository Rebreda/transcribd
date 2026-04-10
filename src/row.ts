/* exported Row */
import GObject from "gi://GObject";
import Gtk from "gi://Gtk?version=4.0";

import { Recording } from "./recording.js";
import { displayDateTime, formatTime } from "./utils.js";

export class Row extends Gtk.ListBoxRow {
    private _name!: Gtk.Label;
    private _date!: Gtk.Label;
    private _duration!: Gtk.Label;
    private _categoryLabel!: Gtk.Label;

    public readonly recording: Recording;

    static {
        GObject.registerClass(
            {
                Template: "resource:///app/drey/Vocalis/ui/row.ui",
                InternalChildren: ["name", "date", "duration", "categoryLabel"],
            },
            this,
        );
    }

    constructor(recording: Recording) {
        super();
        this.recording = recording;

        recording.bind_property(
            "name",
            this._name,
            "label",
            GObject.BindingFlags.SYNC_CREATE,
        );

        this._date.label = displayDateTime(recording.timeCreated);

        recording.connect("notify::duration", () => {
            if (recording.duration > 0) {
                this._duration.set_markup(formatTime(recording.duration));
            }
        });
        if (recording.duration > 0) {
            this._duration.set_markup(formatTime(recording.duration));
        }

        this._updateCategory();
        recording.connect("notify::category", () => this._updateCategory());
    }

    private _updateCategory(): void {
        const cat = this.recording.category ?? "";
        if (cat.length > 0) {
            this._categoryLabel.label = `· ${cat}`;
            this._categoryLabel.visible = true;
        } else {
            this._categoryLabel.visible = false;
        }
    }
}
