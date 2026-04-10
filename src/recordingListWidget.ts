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
    private model: Gio.ListModel;
    private itemsChangedId: number;

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
        this.model = model;
        this.list = Gtk.ListBox.new();
        this.list.valign = Gtk.Align.START;
        this.list.margin_start = 8;
        this.list.margin_end = 8;
        this.list.margin_top = 8;
        this.list.margin_bottom = 8;
        this.list.activate_on_single_click = true;
        this.list.add_css_class("boxed-list");

        const placeholder = new Gtk.Label({
            label: _("No recordings yet"),
            margin_top: 24,
            margin_bottom: 24,
        });
        placeholder.add_css_class("dim-label");
        this.list.set_placeholder(placeholder);

        this.set_child(this.list);

        this.itemsChangedId = this.model.connect("items-changed", () => {
            this._refreshRows();
        });
        this._refreshRows();

        this.list.connect(
            "row-activated",
            (_list: Gtk.ListBox, row: Gtk.ListBoxRow) => {
                this.emit("row-selected", (row as Row).recording);
            },
        );
    }

    public filterBySearch(term: string): void {
        this.searchTerm = term;
        this._refreshRows();
    }

    private _refreshRows(): void {
        let child = this.list.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            this.list.remove(child as Gtk.Widget);
            child = next;
        }

        const term = this.searchTerm.trim().toLowerCase();
        for (let i = 0; i < this.model.get_n_items(); i++) {
            const recording = this.model.get_item(i) as Recording;
            const name = (recording.name ?? "").toLowerCase();
            const cat = (recording.category ?? "").toLowerCase();
            if (term.length > 0 && !name.includes(term) && !cat.includes(term)) {
                continue;
            }

            this.list.append(new Row(recording));
        }
    }
}
