/* exported RecordingsListWidget */
import Adw from "gi://Adw";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk?version=4.0";
import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { Row } from "./row.js";
import { Recording } from "./recording.js";

type DateFilterMode = "all" | "today" | "week" | "month" | "year";
type SortMode = "newest" | "oldest" | "name-asc" | "name-desc" | "category-asc";

export class RecordingsListWidget extends Adw.Bin {
    public list: Gtk.ListBox;
    private searchTerm = "";
    private categoryTerm = "";
    private dateFilter: DateFilterMode = "all";
    private sortMode: SortMode = "newest";
    private model: Gio.ListModel;

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

        this.model.connect("items-changed", () => {
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

    public filterByCategory(term: string): void {
        this.categoryTerm = term;
        this._refreshRows();
    }

    public filterByDate(mode: DateFilterMode): void {
        this.dateFilter = mode;
        this._refreshRows();
    }

    public sortBy(mode: SortMode): void {
        this.sortMode = mode;
        this._refreshRows();
    }

    public refresh(): void {
        this._refreshRows();
    }

    private _refreshRows(): void {
        const selectedRow = this.list.get_selected_row() as Row | null;
        const selectedUri = selectedRow?.recording.uri ?? null;

        let child = this.list.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            this.list.remove(child as Gtk.Widget);
            child = next;
        }

        const recordings = this._getVisibleRecordings();
        for (const recording of recordings) {
            const row = new Row(recording);
            this.list.append(row);
            if (selectedUri && recording.uri === selectedUri) {
                this.list.select_row(row);
            }
        }
    }

    private _getVisibleRecordings(): Recording[] {
        const recordings: Recording[] = [];
        for (let i = 0; i < this.model.get_n_items(); i++) {
            recordings.push(this.model.get_item(i) as Recording);
        }

        const term = this.searchTerm.trim().toLowerCase();
        const categoryTerm = this.categoryTerm.trim().toLowerCase();
        const now = GLib.DateTime.new_now_local();
        const nowUnix = now?.to_unix() ?? 0;

        const filtered = recordings.filter((recording) => {
            const name = (recording.name ?? "").toLowerCase();
            const category = (recording.category ?? "").toLowerCase();
            const transcript = recording.transcription.toLowerCase();
            const dateText = this._dateSearchText(recording);

            if (
                term.length > 0 &&
                !name.includes(term) &&
                !category.includes(term) &&
                !transcript.includes(term) &&
                !dateText.includes(term)
            ) {
                return false;
            }

            if (categoryTerm.length > 0 && !category.includes(categoryTerm)) {
                return false;
            }

            return this._matchesDateFilter(recording, nowUnix);
        });

        filtered.sort((left, right) => this._compareRecordings(left, right));
        return filtered;
    }

    private _matchesDateFilter(recording: Recording, nowUnix: number): boolean {
        if (this.dateFilter === "all") return true;

        const createdUnix = recording.timeCreated.to_unix();
        const ageSeconds = nowUnix - createdUnix;
        if (ageSeconds < 0) return true;

        switch (this.dateFilter) {
            case "today":
                return ageSeconds <= 24 * 60 * 60;
            case "week":
                return ageSeconds <= 7 * 24 * 60 * 60;
            case "month":
                return ageSeconds <= 30 * 24 * 60 * 60;
            case "year":
                return ageSeconds <= 365 * 24 * 60 * 60;
            default:
                return true;
        }
    }

    private _compareRecordings(left: Recording, right: Recording): number {
        switch (this.sortMode) {
            case "oldest":
                return left.timeCreated.to_unix() - right.timeCreated.to_unix();
            case "name-asc":
                return this._displayName(left).localeCompare(this._displayName(right));
            case "name-desc":
                return this._displayName(right).localeCompare(this._displayName(left));
            case "category-asc": {
                const leftCategory = (left.category ?? "").trim().toLowerCase();
                const rightCategory = (right.category ?? "").trim().toLowerCase();
                const categoryCompare = leftCategory.localeCompare(rightCategory);
                if (categoryCompare !== 0) return categoryCompare;
                return this._displayName(left).localeCompare(this._displayName(right));
            }
            case "newest":
            default:
                return right.timeCreated.to_unix() - left.timeCreated.to_unix();
        }
    }

    private _displayName(recording: Recording): string {
        return (recording.name ?? "").replace(/\.[^.]+$/, "").toLowerCase();
    }

    private _dateSearchText(recording: Recording): string {
        const created = recording.timeCreated;
        return [
            `${created.get_year()}`,
            `${created.get_month()}`.padStart(2, "0"),
            `${created.get_day_of_month()}`.padStart(2, "0"),
        ].join("-");
    }
}
