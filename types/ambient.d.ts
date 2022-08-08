/// <reference path="./gtk.d.ts" />

declare function _(id: string): string;
declare const pkg: {
  version: string;
  name: string;
};

declare module "gi://GObject" {
  export * as default from "gobject";
}
declare module "gi://GLib" {
  export * as default from "glib";
}
declare module "gi://Gio" {
  export * as default from "gio";
}
declare module "gi://Gdk" {
  export * as default from "gdk";
}
declare module "gi://Gdk?version=4.0" {
  export * as default from "gdk";
}
declare module "gi://Gtk" {
  export * as default from "gtk";
}
declare module "gi://Gtk?version=4.0" {
  export * as default from "gtk";
}
declare module "gi://Adw" {
  export * as default from "adw";
}
declare module "gi://Gst" {
  export * as default from "gst";
}
declare module "gi://GstAudio" {
  export * as default from "gstaudio";
}
declare module "gi://GstPbutils" {
  export * as default from "gstpbutils";
}
declare module "gi://GstPlayer" {
  export * as default from "gstplayer";
}