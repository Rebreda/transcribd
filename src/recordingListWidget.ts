/* exported RecordingsListWidget */
import Adw from "gi://Adw";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk?version=4.0";
import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { Row } from "./row.js";
import { Recording } from "./recording.js";
import { DateFilterMode, SearchIndex } from "./searchIndex.js";

type SortMode = "newest" | "oldest" | "name-asc" | "name-desc" | "category-asc";

export class RecordingsListWidget extends Adw.Bin {
    public list: Gtk.ListBox;
    private placeholderLabel: Gtk.Label;
    private searchTerm = "";
    private selectedCategories = new Set<string>();
    private selectedTags = new Set<string>();
    private selectedSpeakers = new Set<string>();
    private dateFilter: DateFilterMode = "all";
    private sortMode: SortMode = "newest";
    private model: Gio.ListModel;
    private refreshGeneration = 0;
    private modelLoading = true;
    private queryLoading = false;

    static {
        GObject.registerClass(
            {
                Signals: {
                    "row-selected": { param_types: [GObject.TYPE_OBJECT] },
                    "row-deleted": {
                        param_types: [GObject.TYPE_OBJECT, GObject.TYPE_INT],
                    },
                    "row-transcribe": { param_types: [GObject.TYPE_OBJECT] },
                    "loading-state-changed": {
                        param_types: [GObject.TYPE_BOOLEAN, GObject.TYPE_STRING],
                    },
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
        this.placeholderLabel = placeholder;
        this.list.set_placeholder(placeholder);

        this.set_child(this.list);

        this.model.connect("items-changed", () => {
            this._requestRefresh();
        });
        this.model.connect("loading-changed", (_model: Gio.ListModel, loading: boolean) => {
            this.modelLoading = loading;
            this._updateLoadingState();
            if (!loading) {
                this._requestRefresh();
            }
        });
        this._requestRefresh();

        this.list.connect(
            "row-activated",
            (_list: Gtk.ListBox, row: Gtk.ListBoxRow) => {
                this.emit("row-selected", (row as Row).recording);
            },
        );
    }

    public filterBySearch(term: string): void {
        this.searchTerm = term;
        this._requestRefresh();
    }

    public setValueFilters(filters: {
        categories?: string[];
        tags?: string[];
        speakers?: string[];
    }): void {
        this.selectedCategories = new Set(filters.categories ?? []);
        this.selectedTags = new Set(filters.tags ?? []);
        this.selectedSpeakers = new Set(filters.speakers ?? []);
        this._requestRefresh();
    }

    public filterByDate(mode: DateFilterMode): void {
        this.dateFilter = mode;
        this._requestRefresh();
    }

    public sortBy(mode: SortMode): void {
        this.sortMode = mode;
        this._requestRefresh();
    }

    public refresh(): void {
        this._requestRefresh();
    }

    private _requestRefresh(): void {
        this.refreshGeneration += 1;
        const generation = this.refreshGeneration;
        this.queryLoading = this._hasActiveFilters();
        this._updateLoadingState();
        void this._refreshRows(generation);
    }

    private async _refreshRows(generation: number): Promise<void> {
        const selectedRow = this.list.get_selected_row() as Row | null;
        const selectedUri = selectedRow?.recording.uri ?? null;

        try {
            const recordings = await this._getVisibleRecordings();
            if (generation !== this.refreshGeneration) return;

            let child = this.list.get_first_child();
            while (child) {
                const next = child.get_next_sibling();
                this.list.remove(child as Gtk.Widget);
                child = next;
            }

            for (const recording of recordings) {
                const row = new Row(recording);
                this.list.append(row);
                if (selectedUri && recording.uri === selectedUri) {
                    this.list.select_row(row);
                }
            }

            this._updatePlaceholder(recordings.length);
        } finally {
            if (generation === this.refreshGeneration) {
                this.queryLoading = false;
                this._updateLoadingState();
            }
        }
    }

    private async _getVisibleRecordings(): Promise<Recording[]> {
        const recordings: Recording[] = [];
        for (let i = 0; i < this.model.get_n_items(); i++) {
            recordings.push(this.model.get_item(i) as Recording);
        }

        if (!this._hasActiveFilters()) {
            recordings.sort((left, right) => this._compareRecordings(left, right));
            return recordings;
        }

        const uriMatches = await SearchIndex.getDefault().search({
            searchTerm: this.searchTerm,
            dateFilter: this.dateFilter,
            categories: [...this.selectedCategories],
            tags: [...this.selectedTags],
            speakers: [...this.selectedSpeakers],
        });

        if (!uriMatches) {
            return this._getVisibleRecordingsFallback(recordings);
        }

        const filtered = recordings.filter((recording) => uriMatches.has(recording.uri));
        filtered.sort((left, right) => this._compareRecordings(left, right));
        return filtered;
    }

    private _getVisibleRecordingsFallback(recordings: Recording[]): Recording[] {

        const term = this.searchTerm.trim().toLowerCase();
        const now = GLib.DateTime.new_now_local();
        const nowUnix = now?.to_unix() ?? 0;

        const filtered = recordings.filter((recording) => {
            const name = (recording.name ?? "").toLowerCase();
            const category = (recording.category ?? "").toLowerCase();
            const transcript = recording.transcription.toLowerCase();
            const tags = recording.tags.map((value) => value.toLowerCase());
            const speakers = recording.speakers.map((value) => value.toLowerCase());
            const dateText = this._dateSearchText(recording);

            if (
                term.length > 0 &&
                !name.includes(term) &&
                !category.includes(term) &&
                !transcript.includes(term) &&
                !tags.some((value) => value.includes(term)) &&
                !speakers.some((value) => value.includes(term)) &&
                !dateText.includes(term)
            ) {
                return false;
            }

            if (
                this.selectedCategories.size > 0 &&
                !this.selectedCategories.has(recording.category)
            ) {
                return false;
            }

            if (
                this.selectedTags.size > 0 &&
                !recording.tags.some((value) => this.selectedTags.has(value))
            ) {
                return false;
            }

            if (
                this.selectedSpeakers.size > 0 &&
                !recording.speakers.some((value) => this.selectedSpeakers.has(value))
            ) {
                return false;
            }

            return this._matchesDateFilter(recording, nowUnix);
        });

        filtered.sort((left, right) => this._compareRecordings(left, right));
        return filtered;
    }

    private _hasActiveFilters(): boolean {
        return this.searchTerm.trim().length > 0 ||
            this.selectedCategories.size > 0 ||
            this.selectedTags.size > 0 ||
            this.selectedSpeakers.size > 0 ||
            this.dateFilter !== "all";
    }

    private _updatePlaceholder(resultCount: number): void {
        if (this.modelLoading) {
            this.placeholderLabel.label = _("Loading recordings…");
            return;
        }

        if (this._hasActiveFilters() && resultCount === 0) {
            this.placeholderLabel.label = _("No recordings match the current filters");
            return;
        }

        this.placeholderLabel.label = _("No recordings yet");
    }

    private _updateLoadingState(): void {
        const loading = this.modelLoading || this.queryLoading;
        const message = this.queryLoading
            ? _("Searching recordings…")
            : _("Loading recordings…");
        this.emit("loading-state-changed", loading, message);
        this._updatePlaceholder(this.list.observe_children().get_n_items());
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
