/// <reference path="./gtk.d.ts" />

declare function _(id: string): string;
declare function print(args: string): void;
declare function log(obj: object, others?: object[]): void;
declare function log(msg: string, subsitutions?: any[]): void;

declare const pkg: {
  version: string;
  name: string;
};

declare module console {
  export function error(obj: object, others?: object[]): void;
  export function error(msg: string, subsitutions?: any[]): void;
}

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

declare class TextDecoder {
  constructor(format: string);
  decode(buffer: ArrayBuffer): string;
}
declare class TextEncoder {
  constructor();
  encode(str: string): Uint8Array;
}

declare interface String {
  format(...replacements: string[]): string;
  format(...replacements: number[]): string;
}