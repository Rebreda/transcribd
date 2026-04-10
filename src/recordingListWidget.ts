/* exported RecordingsListWidget */
import Adw from "gi://Adw";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk?version=4.0";
import Gio from "gi://Gio";

import { Row } from "./row.js";
import { Recording } from "./recording.js";

export class RecordingsListWidget extends Adw.Bin {
    public list: Gtk.ListBox;
    private searchTerm = "";

    static {
        GObject.registerClass(
            {
                Signals: {
                    "row-selected": { param_types: [GObject.TYPE_OBJECT] },
                    "row-deleted": {
                        param_types: [GObject.TYPE_OBJECT, GObject.TYPE_INT],
                    },
                    "row-transcribe": { param_types: [GObject.TYPE_OBJECT] },
                },
            },
            this,
        );
    }

    constructor(model: Gio.ListModel) {
        super();
        this.list = Gtk.ListBox.new();
        this.list.valign = Gtk.Align.START;
        this.list.margin_start = 8;
        this.list.margin_end = 8;
        this.list.margin_top = 8;
        this.list.margin_bottom = 8;
        this.list.activate_on_single_click = true;
        this.list.add_css_class("boxed-list");

        this.list.set_filter_func((row: Gtk.ListBoxRow) => {
            if (this.searchTerm.length === 0) return true;
            const r = row as Row;
            const name = (r.recording.name ?? "").toLowerCase();
            const cat = (r.recording.category ?? "").toLowerCase();
            const term = this.searchTerm.toLowerCase();
            return name.includes(term) || cat.includes(term);
        });

        const placeholder = new Gtk.Label({
            label: _("No recordings yet"),
            margin_top: 24,
            margin_bottom: 24,
        });
        placeholder.add_css_class("dim-label");
        this.list.set_placeholder(placeholder);

        this.set_child(this.list);

        this.list.bind_model(model, (item: GObject.Object) => {
            const recording = item as Recording;
            const row = new Row(recording);

            return row;
        });

        this.list.connect(
            "row-activated",
            (_list: Gtk.ListBox, row: Gtk.ListBoxRow) => {
                this.emit("row-selected", (row as Row).recording);
            },
        );
    }

    public filterBySearch(term: string): void {
        this.searchTerm = term;
        this.list.invalidate_filter();
    }
}
