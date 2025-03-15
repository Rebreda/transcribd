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
