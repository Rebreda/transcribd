import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  bytesToBase64,
  concatChunks,
  float32ToPcm16Bytes,
  pcm16ToWav,
} from "./lib/audioCodec";
import {
  type AppPage,
  type AudioInputDevice,
  type ClipMetadata,
  type ClipSort,
  type Manifest,
  type ManifestClip,
  type MicPermission,
  type RealtimeMessage,
} from "./lib/appTypes";
import { extractClipCategories, filterAndSortClips, selectClip } from "./lib/clipFinder";
import { buildFallbackTitle, buildChatEndpoints, tryParseMetadata } from "./lib/metadata";
import {
  formatMicrophoneError,
  getBestEffortMicrophoneStream,
  getMicrophonePermissionState,
  getMicrophonePermissionText,
} from "./lib/microphone";
import { discoverRealtimeEndpoint, extractRealtimeText } from "./lib/realtime";
import {
  buildTranscriptionEndpoints,
  extractTranscriptionResult,
  type TranscriptionResult,
} from "./lib/transcriptionParsing";

const TARGET_SAMPLE_RATE = 16000;
const PRE_ROLL_MS = 1200;
const MAX_CLIP_SECONDS = 90;
const MIN_CLIP_BYTES = 3200;

export function App(): JSX.Element {
  const [activePage, setActivePage] = useState<AppPage>("home");
  const [baseUrl, setBaseUrl] = useState("http://localhost:13305/api/v1");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("Whisper-Base");

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<TranscriptionResult | null>(null);
  const [attemptedEndpoint, setAttemptedEndpoint] = useState("");

  const [realtimeStatus, setRealtimeStatus] = useState("Idle");
  const [realtimeText, setRealtimeText] = useState("");
  const [realtimeError, setRealtimeError] = useState("");
  const [isAlwaysOnEnabled, setIsAlwaysOnEnabled] = useState(true);
  const [audioInputs, setAudioInputs] = useState<AudioInputDevice[]>([]);
  const [selectedMicId, setSelectedMicId] = useState("");

  const [llmEnabled, setLlmEnabled] = useState(true);
  const [llmBaseUrl, setLlmBaseUrl] = useState("http://localhost:13305/api/v1");
  const [llmModel, setLlmModel] = useState("gpt-4o-mini");
  const [llmApiKey, setLlmApiKey] = useState("");

  const [manifest, setManifest] = useState<Manifest>({ version: 1, updatedAtMs: Date.now(), clips: [] });
  const [manifestStatus, setManifestStatus] = useState("Loading...");
  const [clipSearch, setClipSearch] = useState("");
  const [clipSort, setClipSort] = useState<ClipSort>("newest");
  const [clipCategoryFilter, setClipCategoryFilter] = useState("all");
  const [selectedClipId, setSelectedClipId] = useState("");
  const [micPermission, setMicPermission] = useState<MicPermission>("unknown");

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);

  const preRollChunksRef = useRef<Uint8Array[]>([]);
  const preRollBytesRef = useRef(0);
  const activeClipChunksRef = useRef<Uint8Array[]>([]);
  const activeClipBytesRef = useRef(0);
  const activeClipStartedMsRef = useRef(0);
  const activeClipTranscriptRef = useRef("");
  const speechActiveRef = useRef(false);
  const lastTextPieceRef = useRef("");

  const endpoints = useMemo(() => buildTranscriptionEndpoints(baseUrl), [baseUrl]);
  const canSubmit = selectedFile !== null && model.trim().length > 0;
  const filteredClips = useMemo(
    () =>
      filterAndSortClips({
        clips: manifest.clips,
        searchQuery: clipSearch,
        categoryFilter: clipCategoryFilter,
        sortBy: clipSort,
      }),
    [clipSearch, clipCategoryFilter, clipSort, manifest.clips],
  );

  const clipCategories = useMemo(() => extractClipCategories(manifest.clips), [manifest.clips]);

  const selectedClip = useMemo(() => selectClip(filteredClips, selectedClipId), [filteredClips, selectedClipId]);

  const micPermissionText = useMemo(() => getMicrophonePermissionText(micPermission), [micPermission]);

  useEffect(() => {
    if (selectedClip) {
      setSelectedClipId(selectedClip.id);
    } else {
      setSelectedClipId("");
    }
  }, [selectedClip]);

  useEffect(() => {
    void loadManifest();
    void refreshAudioInputs();
    void refreshMicPermission();

    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices?.addEventListener) {
      const onDeviceChange = (): void => {
        void refreshAudioInputs();
      };
      mediaDevices.addEventListener("devicechange", onDeviceChange);

      return () => {
        mediaDevices.removeEventListener("devicechange", onDeviceChange);
        stopRealtime();
      };
    }

    return () => {
      stopRealtime();
    };
  }, []);

  async function refreshAudioInputs(): Promise<void> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices
        .filter(device => device.kind === "audioinput")
        .map((device, index) => ({
          id: device.deviceId,
          label: device.label || `Microphone ${index + 1}`,
        }));

      setAudioInputs(inputs);
      setSelectedMicId(previous => {
        if (previous.length > 0 && inputs.some(input => input.id === previous)) {
          return previous;
        }
        return inputs[0]?.id ?? "";
      });
      void refreshMicPermission();
    } catch (audioDeviceError) {
      const detail = audioDeviceError instanceof Error ? audioDeviceError.message : String(audioDeviceError);
      setRealtimeError(`Failed to read microphones: ${detail}`);
    }
  }

  async function requestMicAccessAndRefresh(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) {
        track.stop();
      }
      await refreshAudioInputs();
      await refreshMicPermission();
      setRealtimeError("");
    } catch (audioPermissionError) {
      await refreshMicPermission();
      setRealtimeError(formatMicrophoneError(audioPermissionError));
    }
  }

  async function refreshMicPermission(): Promise<void> {
    const state = await getMicrophonePermissionState();
    setMicPermission(state);
  }

  async function loadManifest(): Promise<void> {
    try {
      const loaded = await invoke<Manifest>("get_manifest");
      setManifest(loaded);
      setManifestStatus(`Loaded ${loaded.clips.length} clips`);
    } catch (manifestError) {
      const detail = manifestError instanceof Error ? manifestError.message : String(manifestError);
      setManifestStatus(`Manifest unavailable: ${detail}`);
    }
  }

  async function onTranscribe(): Promise<void> {
    if (!selectedFile) {
      setError("Pick an audio file first.");
      return;
    }

    setError("");
    setResult(null);
    setStatus("Transcribing...");

    const headers = new Headers();
    if (apiKey.trim().length > 0) {
      headers.set("Authorization", `Bearer ${apiKey.trim()}`);
    }

    const attempts: string[] = [];

    for (const endpoint of endpoints) {
      setAttemptedEndpoint(endpoint);
      const formData = new FormData();
      formData.append("model", model.trim());
      formData.append("file", selectedFile, selectedFile.name);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: formData,
        });
        const body = await response.text();

        if (!response.ok) {
          attempts.push(`${response.status} ${endpoint}`);
          continue;
        }

        const parsed = extractTranscriptionResult(body);
        setResult(parsed);
        setStatus(`Done (${response.status})`);
        return;
      } catch (requestError) {
        const detail = requestError instanceof Error ? requestError.message : String(requestError);
        attempts.push(`ERR ${endpoint}: ${detail}`);
      }
    }

    setStatus("Failed");
    setError(
      attempts.length > 0
        ? `All endpoints failed: ${attempts.join(" | ")}`
        : "No endpoints available to try.",
    );
  }

  async function startRealtime(): Promise<void> {
    if (wsRef.current) {
      setRealtimeError("Realtime session already running.");
      return;
    }

    setRealtimeError("");
    setRealtimeText("");
    setRealtimeStatus("Connecting...");

    const wsInfo = await discoverRealtimeEndpoint(baseUrl, apiKey.trim(), model.trim());
    if (!wsInfo.ok) {
      setRealtimeStatus("Failed");
      setRealtimeError(wsInfo.error);
      return;
    }

    const audioConstraints: MediaTrackConstraints = {
      channelCount: 1,
      noiseSuppression: true,
      echoCancellation: true,
    };
    if (selectedMicId.length > 0) {
      audioConstraints.deviceId = { exact: selectedMicId };
    }

    const stream = await getBestEffortMicrophoneStream(audioConstraints);
    if (!stream.ok) {
      setRealtimeStatus("Failed");
      setRealtimeError(stream.error);
      return;
    }

    mediaStreamRef.current = stream.value;

    const ws = new WebSocket(wsInfo.url);
    wsRef.current = ws;

    ws.onopen = () => {
      setRealtimeStatus(isAlwaysOnEnabled ? "Connected (Always-On)" : "Connected");
      ws.send(
        JSON.stringify({
          type: "session.update",
          session: {
            model: model.trim(),
            input_audio_format: "pcm16",
            input_audio_transcription: {
              model: model.trim(),
            },
            turn_detection: {
              type: "server_vad",
              threshold: 0.45,
              silence_duration_ms: 500,
              prefix_padding_ms: 320,
            },
          },
        }),
      );

      setupRealtimeAudioPipeline(stream.value, ws);
    };

    ws.onmessage = event => {
      try {
        const message = JSON.parse(String(event.data)) as RealtimeMessage;
        handleRealtimeMessage(message);
      } catch {
        // Ignore non-JSON websocket frames.
      }
    };

    ws.onerror = () => {
      setRealtimeStatus("Error");
      setRealtimeError("Realtime websocket connection error.");
    };

    ws.onclose = () => {
      teardownRealtimeAudioPipeline();
      wsRef.current = null;
      setRealtimeStatus("Stopped");
    };
  }

  function stopRealtime(): void {
    const ws = wsRef.current;
    if (!ws) {
      teardownRealtimeAudioPipeline();
      setRealtimeStatus("Idle");
      return;
    }

    try {
      ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    } catch {
      // Ignore commit failures during shutdown.
    }
    ws.close();
    wsRef.current = null;
    teardownRealtimeAudioPipeline();
    setRealtimeStatus("Stopped");
  }

  function setupRealtimeAudioPipeline(stream: MediaStream, ws: WebSocket): void {
    const ctx = new AudioContext();
    audioContextRef.current = ctx;

    const source = ctx.createMediaStreamSource(stream);
    sourceNodeRef.current = source;

    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processorNodeRef.current = processor;

    processor.onaudioprocess = event => {
      if (ws.readyState !== WebSocket.OPEN) {
        return;
      }

      const input = event.inputBuffer.getChannelData(0);
      const pcm16 = float32ToPcm16Bytes(input, event.inputBuffer.sampleRate, TARGET_SAMPLE_RATE);
      if (pcm16.length === 0) {
        return;
      }

      pushPreRollChunk(pcm16);

      if (speechActiveRef.current) {
        activeClipChunksRef.current.push(pcm16);
        activeClipBytesRef.current += pcm16.byteLength;
        if (activeClipBytesRef.current > TARGET_SAMPLE_RATE * 2 * MAX_CLIP_SECONDS) {
          void finalizeActiveClip("max-duration");
        }
      }

      const base64 = bytesToBase64(pcm16);
      ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: base64 }));
    };

    source.connect(processor);
    processor.connect(ctx.destination);
  }

  function teardownRealtimeAudioPipeline(): void {
    speechActiveRef.current = false;
    activeClipChunksRef.current = [];
    activeClipBytesRef.current = 0;
    activeClipTranscriptRef.current = "";

    if (processorNodeRef.current) {
      try {
        processorNodeRef.current.disconnect();
      } catch {
        // ignore
      }
      processorNodeRef.current.onaudioprocess = null;
      processorNodeRef.current = null;
    }

    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        // ignore
      }
      sourceNodeRef.current = null;
    }

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }

    preRollChunksRef.current = [];
    preRollBytesRef.current = 0;
  }

  function pushPreRollChunk(chunk: Uint8Array): void {
    const maxBytes = Math.floor((TARGET_SAMPLE_RATE * 2 * PRE_ROLL_MS) / 1000);
    preRollChunksRef.current.push(chunk);
    preRollBytesRef.current += chunk.byteLength;

    while (preRollBytesRef.current > maxBytes && preRollChunksRef.current.length > 0) {
      const removed = preRollChunksRef.current.shift();
      preRollBytesRef.current -= removed?.byteLength ?? 0;
    }
  }

  function handleRealtimeMessage(message: RealtimeMessage): void {
    const textPiece = extractRealtimeText(message);
    if (textPiece.length > 0) {
      if (textPiece !== lastTextPieceRef.current) {
        setRealtimeText(prev => (prev.length > 0 ? `${prev} ${textPiece}` : textPiece));
        lastTextPieceRef.current = textPiece;
      }
      if (speechActiveRef.current) {
        const current = activeClipTranscriptRef.current.trim();
        if (!current.endsWith(textPiece)) {
          activeClipTranscriptRef.current = `${current} ${textPiece}`.trim();
        }
      }
    }

    if (message.type === "input_audio_buffer.speech_started") {
      beginActiveClip();
      return;
    }

    if (message.type === "input_audio_buffer.speech_stopped") {
      if (isAlwaysOnEnabled) {
        void finalizeActiveClip("vad-stop");
      } else {
        speechActiveRef.current = false;
      }
      return;
    }

    if (message.type === "error") {
      setRealtimeError(message.error?.message ?? "Unknown realtime error");
    }
  }

  function beginActiveClip(): void {
    speechActiveRef.current = true;
    activeClipStartedMsRef.current = Date.now();
    activeClipTranscriptRef.current = "";
    activeClipChunksRef.current = [...preRollChunksRef.current];
    activeClipBytesRef.current = activeClipChunksRef.current.reduce((total, chunk) => total + chunk.byteLength, 0);
  }

  async function finalizeActiveClip(reason: "vad-stop" | "max-duration"): Promise<void> {
    if (!speechActiveRef.current && reason !== "max-duration") {
      return;
    }

    speechActiveRef.current = false;
    const endedAtMs = Date.now();
    const startedAtMs = activeClipStartedMsRef.current || endedAtMs;
    const pcm = concatChunks(activeClipChunksRef.current);
    const transcript = activeClipTranscriptRef.current.trim();

    activeClipChunksRef.current = [];
    activeClipBytesRef.current = 0;
    activeClipTranscriptRef.current = "";

    if (pcm.byteLength < MIN_CLIP_BYTES || transcript.length === 0) {
      return;
    }

    const metadata = llmEnabled
      ? await enrichMetadataWithLlm({ transcript, titleFallback: buildFallbackTitle(transcript) })
      : {
          title: buildFallbackTitle(transcript),
          notes: "Auto-saved from always-on listener.",
          categories: ["capture"],
        };

    const wav = pcm16ToWav(pcm, TARGET_SAMPLE_RATE, 1);
    const payload = {
      audioBase64: bytesToBase64(wav),
      transcript,
      title: metadata.title,
      notes: metadata.notes,
      categories: metadata.categories,
      startedAtMs,
      endedAtMs,
      sampleRate: TARGET_SAMPLE_RATE,
      channels: 1,
    };

    try {
      const clip = await invoke<ManifestClip>("persist_clip", { payload });
      setManifest(prev => ({ ...prev, updatedAtMs: Date.now(), clips: [...prev.clips, clip] }));
      setManifestStatus(`Saved clip ${clip.id}`);
    } catch (persistError) {
      const detail = persistError instanceof Error ? persistError.message : String(persistError);
      setManifestStatus(`Failed to save clip: ${detail}`);
    }
  }

  async function enrichMetadataWithLlm(input: { transcript: string; titleFallback: string }): Promise<ClipMetadata> {
    const requestBody = {
      model: llmModel.trim() || "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You classify transcript clips. Return strict JSON with keys: title (string), notes (string), categories (array of 1-4 short lowercase tags).",
        },
        {
          role: "user",
          content: `Transcript:\n${input.transcript}`,
        },
      ],
    };

    const headers = new Headers({ "Content-Type": "application/json" });
    if (llmApiKey.trim().length > 0) {
      headers.set("Authorization", `Bearer ${llmApiKey.trim()}`);
    }

    const endpoints = buildChatEndpoints(llmBaseUrl.trim());
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
        });
        if (!response.ok) {
          continue;
        }

        const raw = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = raw.choices?.[0]?.message?.content ?? "";
        const parsed = tryParseMetadata(content);
        if (parsed) {
          return parsed;
        }
      } catch {
        // Try next endpoint.
      }
    }

    return {
      title: input.titleFallback,
      notes: "Auto-generated fallback metadata.",
      categories: ["capture"],
    };
  }

  return (
    <main className="appShell">
      <aside className="sidebar">
        <h1>Transcribd</h1>
        <p>Transcription workspace</p>

        <button
          className={`navButton ${activePage === "home" ? "active" : ""}`}
          onClick={() => setActivePage("home")}
        >
          Home
        </button>
        <button
          className={`navButton ${activePage === "settings" ? "active" : ""}`}
          onClick={() => setActivePage("settings")}
        >
          Settings
        </button>
      </aside>

      <div className="app">
        {activePage === "home" ? (
          <>
            <header className="hero">
              <h2>Files, Transcriptions, Search</h2>
              <p>Browse clips, search transcripts, and run capture/transcription actions.</p>
            </header>

            <section className="panel">
              <h2>Capture Controls</h2>
              <div className="row">
                <button className="primary" onClick={() => void startRealtime()} disabled={wsRef.current !== null}>
                  Start Realtime
                </button>
                <button className="secondary" onClick={stopRealtime} disabled={wsRef.current === null}>
                  Stop Realtime
                </button>
                <button className="secondary" onClick={() => void loadManifest()}>
                  Reload Files
                </button>
              </div>
              <p className="status">Realtime: {realtimeStatus}</p>
              {realtimeError.length > 0 && <p className="error">{realtimeError}</p>}
              <p className="resultBlock">{realtimeText || "(no transcript yet)"}</p>
            </section>

            <section className="panel">
              <h2>Saved Clips</h2>
              <p className="status">{manifestStatus}</p>

              <div className="finderControls">
                <label className="field">
                  <span>Search clips</span>
                  <input
                    value={clipSearch}
                    onChange={event => setClipSearch(event.target.value)}
                    placeholder="Search by title, transcript, notes, category, or filename"
                  />
                </label>

                <label className="field">
                  <span>Category</span>
                  <select value={clipCategoryFilter} onChange={event => setClipCategoryFilter(event.target.value)}>
                    <option value="all">All categories</option>
                    {clipCategories.map(category => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Sort</span>
                  <select value={clipSort} onChange={event => setClipSort(event.target.value as ClipSort)}>
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="title">Title A-Z</option>
                  </select>
                </label>
              </div>

              <p className="status">Showing {filteredClips.length} of {manifest.clips.length} clips</p>

              <div className="clipsWorkspace">
                <div className="clipsPane">
                  {filteredClips.length === 0 && <p>No matching clips.</p>}
                  <div className="clipListCompact">
                    {filteredClips.map(clip => (
                      <button
                        key={clip.id}
                        className={`clipItemButton ${selectedClip?.id === clip.id ? "active" : ""}`}
                        onClick={() => setSelectedClipId(clip.id)}
                      >
                        <strong>{clip.title}</strong>
                        <span>
                          {new Date(clip.createdAtMs).toLocaleString()} | {(clip.durationMs / 1000).toFixed(1)}s
                        </span>
                        <span>{clip.categories.join(", ") || "uncategorized"}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="clipDetailPane">
                  {!selectedClip && <p>Select a clip to inspect metadata and transcript.</p>}
                  {selectedClip && (
                    <article className="clipCard">
                      <h3>{selectedClip.title}</h3>
                      <p className="clipMeta">
                        {new Date(selectedClip.createdAtMs).toLocaleString()} | {(selectedClip.durationMs / 1000).toFixed(1)}s | {selectedClip.fileName}
                      </p>
                      <p className="categories">{selectedClip.categories.join(", ") || "uncategorized"}</p>
                      <p>{selectedClip.notes}</p>
                      <p>{selectedClip.transcript}</p>
                    </article>
                  )}
                </div>
              </div>
            </section>

            <section className="panel">
              <h2>Manual File Transcription</h2>
              <div className="grid2">
                <label className="field">
                  <span>Audio File</span>
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={event => setSelectedFile(event.target.files?.[0] ?? null)}
                  />
                </label>
              </div>

              <button className="primary" onClick={() => void onTranscribe()} disabled={!canSubmit}>
                Transcribe File
              </button>

              <p className="status">Status: {status}</p>
              {attemptedEndpoint.length > 0 && <p className="status">Last endpoint: {attemptedEndpoint}</p>}
              {error.length > 0 && <p className="error">{error}</p>}

              <p>Parsed text: {result?.text || "(empty)"}</p>
              <p>Segments: {result?.segments.length ?? 0}</p>
            </section>
          </>
        ) : (
          <>
            <header className="hero">
              <h2>Config and Settings</h2>
              <p>Backend endpoints, model keys, microphone selection, and metadata automation.</p>
            </header>

            <section className="panel">
              <h2>Realtime Settings</h2>
              <div className="grid2">
                <label className="field">
                  <span>Server URL</span>
                  <input
                    value={baseUrl}
                    onChange={event => setBaseUrl(event.target.value)}
                    placeholder="http://localhost:13305/api/v1"
                  />
                </label>

                <label className="field">
                  <span>Model</span>
                  <input value={model} onChange={event => setModel(event.target.value)} placeholder="Whisper-Base" />
                </label>

                <label className="field">
                  <span>API Key</span>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={event => setApiKey(event.target.value)}
                    placeholder="Bearer token"
                  />
                </label>

                <label className="field">
                  <span>Microphone</span>
                  <select value={selectedMicId} onChange={event => setSelectedMicId(event.target.value)}>
                    {audioInputs.length === 0 && <option value="">No microphone found</option>}
                    {audioInputs.map(input => (
                      <option key={input.id} value={input.id}>
                        {input.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="checkRow">
                  <input
                    type="checkbox"
                    checked={isAlwaysOnEnabled}
                    onChange={event => setIsAlwaysOnEnabled(event.target.checked)}
                  />
                  <span>Always-on VAD clip saving</span>
                </label>
              </div>

              <div className="row">
                <button className="secondary" onClick={() => void requestMicAccessAndRefresh()}>
                  Detect Microphones
                </button>
                <button className="secondary" onClick={() => void refreshMicPermission()}>
                  Refresh Permission Status
                </button>
              </div>
              <p className="status">{micPermissionText}</p>
            </section>

            {micPermission !== "granted" && (
              <section className="panel">
                <h2>Microphone Troubleshooting</h2>
                <p>
                  If microphone access is denied, allow this app in your desktop privacy settings first,
                  then return here and click Detect Microphones.
                </p>
                <ul>
                  <li>Close other apps that may hold the microphone exclusively.</li>
                  <li>Ensure an input device appears in the Microphone dropdown.</li>
                  <li>After changing permissions, fully restart the app and try Start Realtime again.</li>
                </ul>
                <p className="status">Linux hint: check portal and PipeWire permissions/settings for desktop audio input.</p>
              </section>
            )}

            <section className="panel">
              <h2>LLM Metadata Settings</h2>
              <div className="grid2">
                <label className="checkRow">
                  <input type="checkbox" checked={llmEnabled} onChange={event => setLlmEnabled(event.target.checked)} />
                  <span>Enable title/notes/categories generation</span>
                </label>

                <label className="field">
                  <span>LLM Base URL</span>
                  <input value={llmBaseUrl} onChange={event => setLlmBaseUrl(event.target.value)} />
                </label>

                <label className="field">
                  <span>LLM Model</span>
                  <input value={llmModel} onChange={event => setLlmModel(event.target.value)} placeholder="gpt-4o-mini" />
                </label>

                <label className="field">
                  <span>LLM API Key</span>
                  <input
                    type="password"
                    value={llmApiKey}
                    onChange={event => setLlmApiKey(event.target.value)}
                    placeholder="Bearer token"
                  />
                </label>
              </div>
            </section>

            <section className="panel">
              <h2>Endpoint Resolution</h2>
              <ul>
                {endpoints.map(endpoint => (
                  <li key={endpoint}>{endpoint}</li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
