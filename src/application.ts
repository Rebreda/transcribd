/* exported Application RecordingsDir CacheDir Settings */
/*
 * Copyright 2013 Meg Ford
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public
 * License along with this library; if not, see <http://www.gnu.org/licenses/>.
 *
 * Author: Meg Ford <megford@gnome.org>
 *
 */

import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gst from "gi://Gst";
import Gtk from "gi://Gtk?version=4.0";
import Soup from "gi://Soup?version=3.0";

export const RecordingsDir = Gio.file_new_for_path(
    GLib.build_filenamev([GLib.get_user_data_dir(), pkg.name]),
);
export const CacheDir = Gio.file_new_for_path(
    GLib.build_filenamev([GLib.get_user_cache_dir(), pkg.name]),
);
export const Settings = new Gio.Settings({ schema: pkg.name });

import { Window } from "./window.js";
import { PreferencesDialog } from "./preferences.js";

export class Application extends Adw.Application {
    private window?: Window;

    static {
        GObject.registerClass(this);
    }

    constructor() {
        super({
            application_id: pkg.name,
            resource_base_path: "/io/github/rebreda/Transcribd/",
        });
        GLib.set_application_name(_("Vocalis"));
        GLib.setenv("PULSE_PROP_media.role", "production", true);
        GLib.setenv("PULSE_PROP_application.icon_name", pkg.name, true);

        this.add_main_option(
            "version",
            "v".charCodeAt(0),
            GLib.OptionFlags.NONE,
            GLib.OptionArg.NONE,
            "Print version information and exit",
            null,
        );

        this.connect("handle-local-options", (_, options: GLib.VariantDict) => {
            if (options.contains("version")) {
                print(pkg.version);
                /* quit the invoked process after printing the version number
                 * leaving the running instance unaffected
                 */
                return 0;
            }
            return -1;
        });

        Gio._promisify(Gio.File.prototype, "trash_async", "trash_finish");
        Gio._promisify(
            Gio.File.prototype,
            "load_bytes_async",
            "load_bytes_finish",
        );
        Gio._promisify(
            Gio.File.prototype,
            "enumerate_children_async",
            "enumerate_children_finish",
        );
        Gio._promisify(
            Gio.FileEnumerator.prototype,
            "next_files_async",
            "next_files_finish",
        );

        Gio._promisify(
            Gio.File.prototype,
            "replace_contents_async",
            "replace_contents_finish",
        );
        Gio._promisify(
            Soup.Session.prototype,
            "send_and_read_async",
            "send_and_read_finish",
        );
        Gio._promisify(
            Soup.Session.prototype,
            "websocket_connect_async",
            "websocket_connect_finish",
        );
    }

    private initAppMenu(): void {
        const profileAction = Settings.create_action("audio-profile");
        this.add_action(profileAction);

        const channelAction = Settings.create_action("audio-channel");
        this.add_action(channelAction);

        const aboutAction = new Gio.SimpleAction({ name: "about" });
        aboutAction.connect("activate", this.showAbout.bind(this));
        this.add_action(aboutAction);

        const preferencesAction = new Gio.SimpleAction({ name: "preferences" });
        preferencesAction.connect("activate", () => {
            const dialog = new PreferencesDialog();
            dialog.present(this.window ?? null);
        });
        this.add_action(preferencesAction);
        this.set_accels_for_action("app.preferences", ["<Primary>comma"]);

        const quitAction = new Gio.SimpleAction({ name: "quit" });
        quitAction.connect("activate", () => {
            if (this.window) {
                this.window.close();
            }
        });
        this.add_action(quitAction);

        this.set_accels_for_action("app.quit", ["<Primary>q"]);
        this.set_accels_for_action("win.open-primary-menu", ["F10"]);
        this.set_accels_for_action("win.show-help-overlay", [
            "<Primary>question",
        ]);
        this.set_accels_for_action("recorder.start", ["<Primary>r"]);
        this.set_accels_for_action("recorder.pause", ["space"]);
        this.set_accels_for_action("recorder.resume", ["space"]);
        this.set_accels_for_action("recorder.cancel", ["Delete"]);
        this.set_accels_for_action("recorder.stop", ["s"]);
        /* TODO: Fix recording.* keybindings */
        this.set_accels_for_action("recording.play", ["space"]);
        this.set_accels_for_action("recording.pause", ["space"]);
        this.set_accels_for_action("recording.seek-backward", ["b"]);
        this.set_accels_for_action("recording.seek-forward", ["n"]);
        this.set_accels_for_action("recording.rename", ["F2"]);
        this.set_accels_for_action("recording.delete", ["Delete"]);
        this.set_accels_for_action("recording.export", ["<Primary>s"]);
        this.set_accels_for_action("recorder.dictate", ["<Primary><Alt>d"]);
    }

    private initUserDirectory(dir: Gio.File): void {
        try {
            dir.make_directory_with_parents(null);
        } catch (e: unknown) {
            if (
                e instanceof GLib.Error &&
                !e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)
            ) {
                console.error(`Failed to create director: ${e.message}`);
            }
        }
    }

    public override vfunc_startup(): void {
        super.vfunc_startup();
        log("Vocalis (%s)".format(pkg.name));
        log("Version: %s".format(pkg.version));

        Gst.init([]);

        this.initUserDirectory(CacheDir);
        this.initUserDirectory(RecordingsDir);

        this.initAppMenu();
    }

    public override vfunc_activate(): void {
        if (!this.window) {
            this.window = new Window({ application: this });
            if (pkg.name.endsWith("Devel")) this.window.add_css_class("devel");
        }
        this.window.present();
    }

    private showAbout(): void {
        let appName = GLib.get_application_name();
        if (!appName) appName = _("Vocalis");

        const aboutDialog = new Adw.AboutDialog({
            artists: [
                "Reda Lazri <the.red.shortcut@gmail.com>",
                "Garrett LeSage <garrettl@gmail.com>",
                "Hylke Bons <hylkebons@gmail.com>",
                "Sam Hewitt <hewittsamuel@gmail.com>",
            ],
            developers: [
                "Christopher Davis <christopherdavis@gnome.org>",
                "Meg Ford <megford@gnome.org>",
                "Bilal Elmoussaoui <bil.elmoussaoui@gmail.com>",
                "Felipe Borges <felipeborges@gnome.org>",
                "Kavan Mevada <kavanmevada@gmail.com>",
            ],
            /* Translators: Replace "translator-credits" with your names, one name per line */
            translator_credits: _("translator-credits"),
            application_name: appName,
            license_type: Gtk.License.GPL_2_0,
            application_icon: pkg.name,
            version: pkg.version,
            website: "https://gitlab.gnome.org/World/vocalis",
            issue_url: "https://gitlab.gnome.org/World/vocalis/-/issues",
            copyright:
                "Copyright 2013-2019 Meg Ford\nCopyright 2019-2020 Bilal Elmoussaoui &amp; Felipe Borges\nCopyright 2024 Christopher Davis",
        });

        aboutDialog.present(this.window);
    }
}
