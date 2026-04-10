import test from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";

const BASE_URL = (process.env.LEMONADE_BASE_URL ?? "http://localhost:8080/api/v1").replace(/\/+$/, "");
const API_KEY = process.env.LEMONADE_API_KEY ?? "";
const MODEL = process.env.LEMONADE_MODEL ?? "Whisper-Base";
const INFERENCE_MODEL = process.env.LEMONADE_INFERENCE_MODEL ?? "";

function authHeaders(extra = {}) {
    const headers = { ...extra };
    if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
    return headers;
}

function rootFromBase(base) {
    return base.replace(/\/(api\/)?v1$/i, "");
}

async function postJsonWithFallback(paths, body) {
    const attempts = [];
    for (const url of paths) {
        const res = await fetch(url, {
            method: "POST",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify(body),
        });
        attempts.push(`${res.status} ${url}`);
        if (res.ok) {
            const text = await res.text();
            return { url, status: res.status, text, attempts };
        }
    }
    throw new Error(`No successful endpoint. Attempts: ${attempts.join(" | ")}`);
}

async function postMultipartWithFallback(paths, formData) {
    const attempts = [];
    for (const url of paths) {
        const res = await fetch(url, {
            method: "POST",
            headers: authHeaders(),
            body: formData,
        });
        const body = await res.text();
        attempts.push(`${res.status} ${url} -> ${body.slice(0, 120)}`);
        if (res.ok) {
            return { url, status: res.status, text: body, attempts };
        }
    }
    throw new Error(`No successful endpoint. Attempts: ${attempts.join(" | ")}`);
}

function buildSilentWavBlob(durationMs = 1000, sampleRate = 16000) {
    const channels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const sampleCount = Math.floor((durationMs / 1000) * sampleRate);
    const dataSize = sampleCount * channels * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    function writeAscii(offset, text) {
        for (let i = 0; i < text.length; i++) {
            view.setUint8(offset + i, text.charCodeAt(i));
        }
    }

    writeAscii(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(8, "WAVE");
    writeAscii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * bytesPerSample, true);
    view.setUint16(32, channels * bytesPerSample, true);
    view.setUint16(34, bitsPerSample, true);
    writeAscii(36, "data");
    view.setUint32(40, dataSize, true);

    return new Blob([buffer], { type: "audio/wav" });
}

test("health endpoint responds with websocket port", async () => {
    const healthCandidates = [
        `${BASE_URL}/health`,
        `${rootFromBase(BASE_URL)}/api/v1/health`,
        `${rootFromBase(BASE_URL)}/v1/health`,
        `${rootFromBase(BASE_URL)}/health`,
    ];

    const tried = [];
    for (const url of [...new Set(healthCandidates)]) {
        const res = await fetch(url, { headers: authHeaders() });
        tried.push(`${res.status} ${url}`);
        if (!res.ok) continue;
        const json = await res.json();
        assert.equal(typeof json.websocket_port, "number");
        return;
    }

    throw new Error(`Health check failed. Attempts: ${tried.join(" | ")}`);
});

test("chat/inference endpoint works", async () => {
    if (!INFERENCE_MODEL) {
        test.skip(
            "Set LEMONADE_INFERENCE_MODEL to run inference validation (e.g. a chat/instruct model)",
        );
        return;
    }

    const root = rootFromBase(BASE_URL);
    const paths = [
        `${BASE_URL}/chat/completions`,
        `${root}/api/v1/chat/completions`,
        `${root}/v1/chat/completions`,
    ];

    const { text } = await postJsonWithFallback(paths, {
        model: INFERENCE_MODEL,
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        max_tokens: 8,
        temperature: 0,
    });

    assert.ok(text.length > 0, "Inference response should not be empty");
});

test("audio transcription endpoint accepts multipart upload", async () => {
    const root = rootFromBase(BASE_URL);
    const paths = [
        `${BASE_URL}/audio/transcriptions`,
        `${root}/api/v1/audio/transcriptions`,
        `${root}/v1/audio/transcriptions`,
    ];

    const form = new FormData();
    form.append("model", MODEL);
    form.append("file", buildSilentWavBlob(), "silence.wav");

    const { text } = await postMultipartWithFallback(paths, form);
    assert.ok(text.length >= 0);
});

test("realtime websocket accepts session.update", async () => {
    const healthRes = await fetch(`${BASE_URL}/health`, { headers: authHeaders() });
    assert.equal(healthRes.ok, true, "Health endpoint must respond for websocket test");
    const health = await healthRes.json();
    const wsPort = health.websocket_port;
    assert.equal(typeof wsPort, "number");

    const wsUrl = `ws://127.0.0.1:${wsPort}/realtime?model=${encodeURIComponent(MODEL)}`;

    await new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl, {
            headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : undefined,
        });

        const timeout = setTimeout(() => {
            ws.close();
            reject(new Error("Timed out waiting for realtime session events"));
        }, 8000);

        ws.on("open", () => {
            ws.send(
                JSON.stringify({
                    type: "session.update",
                    session: {
                        model: MODEL,
                        input_audio_format: "pcm16",
                        turn_detection: {
                            type: "server_vad",
                            threshold: 0.45,
                            silence_duration_ms: 450,
                            prefix_padding_ms: 300,
                        },
                    },
                }),
            );
        });

        ws.on("message", (raw) => {
            const text = raw.toString();
            let msg;
            try {
                msg = JSON.parse(text);
            } catch {
                return;
            }

            if (msg.type === "session.created" || msg.type === "session.updated") {
                clearTimeout(timeout);
                ws.close();
                resolve();
            }
        });

        ws.on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
});
