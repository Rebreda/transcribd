#!/usr/bin/env node
import { readFile } from "node:fs/promises";

function parseArgs(argv) {
  const options = {
    base: "http://127.0.0.1:13305/api/v1",
    model: "Whisper-Base",
    wav: "",
    apiKey: "",
    chunkMs: 85,
    sendDelayMs: 10,
    timeoutMs: 30000,
    showLogs: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base") options.base = argv[++i] ?? options.base;
    else if (arg === "--model") options.model = argv[++i] ?? options.model;
    else if (arg === "--wav") options.wav = argv[++i] ?? options.wav;
    else if (arg === "--api-key") options.apiKey = argv[++i] ?? options.apiKey;
    else if (arg === "--chunk-ms") options.chunkMs = Number(argv[++i] ?? options.chunkMs);
    else if (arg === "--send-delay-ms") options.sendDelayMs = Number(argv[++i] ?? options.sendDelayMs);
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++i] ?? options.timeoutMs);
    else if (arg === "--no-logs") options.showLogs = false;
    else if (arg === "--help") options.help = true;
  }

  return options;
}

function usage() {
  console.log("Usage: node scripts/debug-realtime-transcription.mjs --wav /path/to/file.wav [--base http://127.0.0.1:13305/api/v1] [--model Whisper-Base] [--api-key token] [--chunk-ms 85] [--send-delay-ms 10] [--timeout-ms 30000] [--no-logs]");
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

function getWsOrigin(httpBase) {
  const url = new URL(httpBase);
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${url.hostname}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForOpen(ws, name) {
  return new Promise((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`${name} websocket failed to open`));
    };
    const onClose = () => {
      cleanup();
      reject(new Error(`${name} websocket closed before open`));
    };

    function cleanup() {
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onError);
      ws.removeEventListener("close", onClose);
    }

    ws.addEventListener("open", onOpen);
    ws.addEventListener("error", onError);
    ws.addEventListener("close", onClose);
  });
}

function parseWavPcm16Mono16k(fileBytes) {
  if (fileBytes.length < 44) {
    throw new Error("WAV file too small");
  }

  const view = new DataView(fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength);
  const riff = String.fromCharCode(...fileBytes.slice(0, 4));
  const wave = String.fromCharCode(...fileBytes.slice(8, 12));
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new Error("Input must be RIFF/WAVE");
  }

  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  let dataStart = -1;
  let dataSize = 0;

  while (offset + 8 <= fileBytes.length) {
    const id = String.fromCharCode(...fileBytes.slice(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;

    if (id === "fmt ") {
      audioFormat = view.getUint16(chunkStart + 0, true);
      channels = view.getUint16(chunkStart + 2, true);
      sampleRate = view.getUint32(chunkStart + 4, true);
      bitsPerSample = view.getUint16(chunkStart + 14, true);
    }

    if (id === "data") {
      dataStart = chunkStart;
      dataSize = size;
      break;
    }

    offset = chunkStart + size + (size % 2);
  }

  if (dataStart < 0) {
    throw new Error("WAV data chunk not found");
  }

  if (audioFormat !== 1 || channels !== 1 || sampleRate !== 16000 || bitsPerSample !== 16) {
    throw new Error(`Expected PCM16 mono 16kHz WAV, got format=${audioFormat} channels=${channels} sampleRate=${sampleRate} bits=${bitsPerSample}`);
  }

  return fileBytes.slice(dataStart, dataStart + dataSize);
}

function parseWsEvent(raw) {
  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.wav) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const base = normalizeOpenAiBase(args.base);
  const healthUrl = `${base}/health`;
  const httpHeaders = new Headers();
  if (args.apiKey) {
    httpHeaders.set("Authorization", `Bearer ${args.apiKey}`);
  }

  console.log(`[realtime] GET ${healthUrl}`);
  const healthResponse = await fetch(healthUrl, { headers: httpHeaders });
  if (!healthResponse.ok) {
    throw new Error(`Health request failed: ${healthResponse.status}`);
  }

  const health = await healthResponse.json();
  const wsPort = health.websocket_port;
  if (typeof wsPort !== "number") {
    throw new Error("Server did not provide websocket_port in /health response");
  }

  const wsOrigin = getWsOrigin(base);
  const query = new URLSearchParams({ model: args.model });
  if (args.apiKey) {
    query.set("api_key", args.apiKey);
  }

  const realtimeUrl = `${wsOrigin}:${wsPort}/realtime?${query.toString()}`;
  const logsUrl = `${wsOrigin}:${wsPort}/logs/stream`;

  const wavBytes = await readFile(args.wav);
  const pcmBytes = parseWavPcm16Mono16k(wavBytes);
  const chunkBytes = Math.max(320, Math.floor((16000 * 2 * args.chunkMs) / 1000));

  console.log(`[realtime] ws=${realtimeUrl}`);
  console.log(`[realtime] pcm_bytes=${pcmBytes.length}, chunk_bytes=${chunkBytes}`);

  let logsWs = null;
  if (args.showLogs) {
    logsWs = new WebSocket(logsUrl);
    await waitForOpen(logsWs, "logs");
    logsWs.send(JSON.stringify({ type: "logs.subscribe", after_seq: null }));
    logsWs.addEventListener("message", event => {
      const msg = parseWsEvent(String(event.data));
      if (!msg) {
        return;
      }
      if (msg.type === "logs.entry" && msg.entry?.line) {
        console.log(`[server-log] ${msg.entry.line}`);
      }
    });
  }

  const ws = new WebSocket(realtimeUrl);
  await waitForOpen(ws, "realtime");

  let completedTranscript = "";
  let eventCount = 0;
  let appendCount = 0;
  let committedSeen = false;

  const donePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for completed transcription event after ${args.timeoutMs}ms`));
    }, args.timeoutMs);

    ws.addEventListener("message", event => {
      const msg = parseWsEvent(String(event.data));
      if (!msg) {
        return;
      }

      eventCount += 1;
      const type = String(msg.type || "(unknown)");
      console.log(`[realtime-event] ${type}`);

      if (type === "error") {
        clearTimeout(timeout);
        reject(new Error(`Server error: ${msg.error?.message || "Unknown"}`));
        return;
      }

      if (type === "input_audio_buffer.committed") {
        committedSeen = true;
      }

      if (type === "conversation.item.input_audio_transcription.delta") {
        if (typeof msg.delta === "string" && msg.delta.trim()) {
          console.log(`[delta] ${msg.delta.trim()}`);
        }
      }

      if (type === "conversation.item.input_audio_transcription.completed") {
        completedTranscript = typeof msg.transcript === "string" ? msg.transcript.trim() : "";
        clearTimeout(timeout);
        resolve();
      }
    });

    ws.addEventListener("close", () => {
      clearTimeout(timeout);
      reject(new Error("Realtime socket closed before transcription completed"));
    });
  });

  ws.send(JSON.stringify({ type: "session.update", session: { model: args.model, turn_detection: null } }));

  for (let offset = 0; offset < pcmBytes.length; offset += chunkBytes) {
    const chunk = pcmBytes.slice(offset, Math.min(offset + chunkBytes, pcmBytes.length));
    ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: Buffer.from(chunk).toString("base64") }));
    appendCount += 1;
    if (args.sendDelayMs > 0) {
      await sleep(args.sendDelayMs);
    }
  }

  ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));

  try {
    await donePromise;
  } finally {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1000, "done");
    }
    if (logsWs && logsWs.readyState === WebSocket.OPEN) {
      logsWs.close(1000, "done");
    }
  }

  console.log("[realtime] summary:");
  console.log(`  appended_chunks=${appendCount}`);
  console.log(`  received_events=${eventCount}`);
  console.log(`  committed_seen=${committedSeen}`);
  console.log(`  transcript=${completedTranscript || "(empty)"}`);

  if (!completedTranscript) {
    process.exit(3);
  }
}

main().catch(error => {
  console.error("[realtime] failed:", error);
  process.exit(2);
});
