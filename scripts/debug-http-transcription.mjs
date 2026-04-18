#!/usr/bin/env node
import { readFile } from "node:fs/promises";

function parseArgs(argv) {
  const options = {
    base: "http://127.0.0.1:13305/api/v1",
    model: "Whisper-Base",
    wav: "",
    apiKey: "",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base") options.base = argv[++i] ?? options.base;
    else if (arg === "--model") options.model = argv[++i] ?? options.model;
    else if (arg === "--wav") options.wav = argv[++i] ?? options.wav;
    else if (arg === "--api-key") options.apiKey = argv[++i] ?? options.apiKey;
    else if (arg === "--help") options.help = true;
  }

  return options;
}

function normalizeOpenAiBase(baseUrl) {
  const trimmed = String(baseUrl).trim().replace(/\/+$/, "");
  const url = new URL(trimmed.length > 0 ? trimmed : "http://127.0.0.1:13305");
  const path = url.pathname.replace(/\/+$/, "");

  if (path.endsWith("/api/v1")) url.pathname = path;
  else if (path.endsWith("/v1")) url.pathname = `${path.slice(0, -3)}/api/v1`;
  else if (path === "" || path === "/") url.pathname = "/api/v1";
  else url.pathname = `${path}/api/v1`;

  return url.toString().replace(/\/+$/, "");
}

function usage() {
  console.log("Usage: node scripts/debug-http-transcription.mjs --wav /path/to/file.wav [--base http://127.0.0.1:13305/api/v1] [--model Whisper-Base] [--api-key token]");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.wav) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const base = normalizeOpenAiBase(args.base);
  const endpoint = `${base}/audio/transcriptions`;
  const wavBytes = await readFile(args.wav);

  const headers = new Headers();
  if (args.apiKey) {
    headers.set("Authorization", `Bearer ${args.apiKey}`);
  }

  const form = new FormData();
  form.append("model", args.model);
  form.append("file", new Blob([wavBytes], { type: "audio/wav" }), "input.wav");

  console.log(`[http] POST ${endpoint}`);
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: form,
  });

  const body = await response.text();
  console.log(`[http] status=${response.status}`);
  console.log("[http] response=");
  console.log(body);

  if (!response.ok) {
    process.exit(2);
  }
}

main().catch(error => {
  console.error("[http] request failed:", error);
  process.exit(2);
});
