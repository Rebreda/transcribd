#!/usr/bin/env gjs -m
import GLib from 'gi://GLib';
import { exit, programArgs } from 'system'

globalThis._ = (s) => s; // Temporary for development

imports.package.init({
    name: "io.github.rebreda.Transcribd.Devel",
    version: "1.0.0",
    prefix: "/home/g/Code/vocalis/build",
    libdir: "/home/g/Code/vocalis/build/lib"
});

const module = await import('resource:///io/github/rebreda/Transcribd.Devel/js/main.js');
const exitCode = await module.main(programArgs);
exit(exitCode);