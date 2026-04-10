import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GObject from "gi://GObject";

import { Settings } from "./application.js";

export class PreferencesDialog extends Adw.PreferencesDialog {
    private _enabledSwitch!: Adw.SwitchRow;
    private _serverUrlEntry!: Adw.EntryRow;
    private _modelEntry!: Adw.EntryRow;
    private _apiKeyEntry!: Adw.PasswordEntryRow;
    private _injectSwitch!: Adw.SwitchRow;

    static {
        GObject.registerClass(
            {
                Template: "resource:///app/drey/Vocalis/ui/preferences.ui",
                InternalChildren: [
                    "enabledSwitch",
                    "serverUrlEntry",
                    "modelEntry",
                    "apiKeyEntry",
                    "injectSwitch",
                ],
            },
            this,
        );
    }

    constructor() {
        super();
    }

    public override vfunc_constructed(): void {
        super.vfunc_constructed();

        Settings.bind(
            "transcription-enabled",
            this._enabledSwitch,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        Settings.bind(
            "transcription-server-url",
            this._serverUrlEntry,
            "text",
            Gio.SettingsBindFlags.DEFAULT,
        );
        Settings.bind(
            "transcription-model",
            this._modelEntry,
            "text",
            Gio.SettingsBindFlags.DEFAULT,
        );
        Settings.bind(
            "transcription-api-key",
            this._apiKeyEntry,
            "text",
            Gio.SettingsBindFlags.DEFAULT,
        );
        Settings.bind(
            "transcription-inject-text",
            this._injectSwitch,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
    }
}
