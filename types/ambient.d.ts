declare function _(id: string): string;

declare const pkg: {
  version: string;
  name: string;
};

declare interface String {
  format(...replacements: string[]): string;
  format(...replacements: number[]): string;
}
declare interface Number {
  toFixed(digits: number): number;
}

declare function print(...args: any[]): void;
declare function log(...args: any[]): void;
declare const console: any;
declare const TextEncoder: any;
declare const TextDecoder: any;

declare namespace GLib {
  const OptionFlags: any;
  const OptionArg: any;
  class VariantDict { [key: string]: any; }
  class DateTime { [key: string]: any; }
  function build_filenamev(paths: string[]): string;
  function get_user_data_dir(): string;
  function get_user_cache_dir(): string;
  function set_application_name(name: string): void;
  function setenv(variable: string, value: string): void;
}
declare namespace Gio {
  class Settings { [key: string]: any; }
  class File { [key: string]: any; }
  class SimpleAction { [key: string]: any; }
  class FileEnumerator { [key: string]: any; }
  class Cancellable { [key: string]: any; }
  class FileMonitor { [key: string]: any; }
  class FileInfo { [key: string]: any; }
  class ListModel { [key: string]: any; }
  class AsyncResult { [key: string]: any; }
  class SimpleActionGroup { [key: string]: any; }
  function file_new_for_path(path: string): any;
}
declare namespace GObject {
  class Object { [key: string]: any; }
  class ValueArray { [key: string]: any; }
  function registerClass(meta: any): any;
}
declare namespace Gtk {
  class Application { [key: string]: any; }
  class DrawingArea { static ConstructorProps: any; [key: string]: any; }
  class GestureDrag { [key: string]: any; }
  class Stack { [key: string]: any; }
  class ListBox { [key: string]: any; }
  class Box { [key: string]: any; }
  class Label { [key: string]: any; }
  class Button { [key: string]: any; }
  class Window { [key: string]: any; }
  class Entry { [key: string]: any; }
  class Revealer { [key: string]: any; }
  class FileChooserNative { [key: string]: any; }
  class EventControllerKey { [key: string]: any; }
}
declare namespace Adw {
  class Application { [key: string]: any; }
  class StatusPage { [key: string]: any; }
  class Clamp { [key: string]: any; }
  class ToastOverlay { [key: string]: any; }
  class ToolbarView { [key: string]: any; }
  class Toast { [key: string]: any; }
  class ApplicationWindow { static ConstructorProps: any; [key: string]: any; }
  class Bin { [key: string]: any; }
}
declare namespace Gst {
  class Pipeline { [key: string]: any; }
  class Element { [key: string]: any; }
  class Bus { [key: string]: any; }
  const State: any;
  class Message { [key: string]: any; }
  class Bin { [key: string]: any; }
}
declare namespace GstPbutils {
  class EncodingContainerProfile { [key: string]: any; }
}
declare namespace GstApp {
  class AppSink { [key: string]: any; }
}
declare namespace Gdk {
  class RGBA { [key: string]: any; }
}
declare namespace GstPlayer {
  class Player { [key: string]: any; }
  const PlayerState: any;
}

declare module "gettext" {
  const _: any;
  export default _;
}

declare module "cairo" {
  const cairo: any;
  export default cairo;
}

declare module "gi://GstApp" {
  export const AppSink: any;
  export default any;
}
