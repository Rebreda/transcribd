declare module "gi://Adw" {
  export const Application: any;
  export const StatusPage: any;
  export const Clamp: any;
  export const ToastOverlay: any;
  export const ToolbarView: any;
  export const Toast: any;
  export const ApplicationWindow: any;
  export const Bin: any;
  export default any;
}

declare module "gi://Gio" {
  export const Settings: any;
  export const File: any;
  export const SimpleAction: any;
  export const FileEnumerator: any;
  export const Cancellable: any;
  export const FileMonitor: any;
  export const FileInfo: any;
  export const ListModel: any;
  export const AsyncResult: any;
  export const SimpleActionGroup: any;
  export function file_new_for_path(path: string): any;
  export default any;
}

declare module "gi://GLib" {
  export const OptionFlags: any;
  export const OptionArg: any;
  export const VariantDict: any;
  export const DateTime: any;
  export function build_filenamev(paths: string[]): string;
  export function get_user_data_dir(): string;
  export function get_user_cache_dir(): string;
  export function set_application_name(name: string): void;
  export function setenv(variable: string, value: string): void;
  export default any;
}

declare module "gi://GObject" {
  export const Object: any;
  export const ValueArray: any;
  export function registerClass(meta: any): any;
  export default any;
}

declare module "gi://Gst" {
  export const Pipeline: any;
  export const Element: any;
  export const Bus: any;
  export const State: any;
  export const Message: any;
  export const Bin: any;
  export default any;
}

declare module "gi://GstApp" {
  export const AppSink: any;
  export default any;
}

declare module "gi://Gtk?version=4.0" {
  export const Application: any;
  export const DrawingArea: any;
  export const GestureDrag: any;
  export const Stack: any;
  export const ListBox: any;
  export const Box: any;
  export const Label: any;
  export const Button: any;
  export const Window: any;
  export const Entry: any;
  export const Revealer: any;
  export const FileChooserNative: any;
  export const EventControllerKey: any;
  export default any;
}

declare module "gi://GstPbutils" {
  export const EncodingContainerProfile: any;
  export default any;
}

declare module "gi://Gdk?version=4.0" {
  export const RGBA: any;
  export default any;
}

declare module "gi://GstPlayer" {
  export const Player: any;
  export const PlayerState: any;
  export const PlayerGMainContextSignalDispatcher: any;
  export default any;
}