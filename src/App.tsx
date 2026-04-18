import { useEffect, useMemo, useState } from "react";
import { bytesToBase64, pcm16ToWav } from "./lib/audioCodec";
import {
  type AppPage,
  type AudioInputDevice,
  type ClipMetadata,
  type ClipSort,
  type Manifest,
  type MicPermission,
} from "./lib/appTypes";
import { extractClipCategories, filterAndSortClips, selectClip } from "./lib/clipFinder";
import { buildFallbackTitle, buildChatEndpoints, tryParseMetadata } from "./lib/metadata";
import {
  formatMicrophoneError,
  getMicrophonePermissionState,
  getMicrophonePermissionText,
} from "./lib/microphone";
import { loadManifestSafe, persistClipSafe } from "./lib/manifestStore";
import {
  buildTranscriptionEndpoints,
  extractTranscriptionResult,
  type TranscriptionResult,
} from "./lib/transcriptionParsing";
import { HomePage } from "./components/HomePage";
import { SettingsPage } from "./components/SettingsPage";
import { AppConfigProvider, useAppConfig } from "./context/AppConfigContext";
import { useRealtimeCapture } from "./hooks/useRealtimeCapture";
import { useTimelinePlayback } from "./hooks/useTimelinePlayback";

const TARGET_SAMPLE_RATE = 16000;
const MIN_CLIP_BYTES = 3200;

export function App(): JSX.Element {
  return (
    <AppConfigProvider>
      <AppContainer />
    </AppConfigProvider>
  );
}

function AppContainer(): JSX.Element {
  const [activePage, setActivePage] = useState<AppPage>("home");
  const {
    baseUrl,
    setBaseUrl,
    apiKey,
    setApiKey,
    model,
    setModel,
    isAlwaysOnEnabled,
    setIsAlwaysOnEnabled,
    selectedMicId,
    setSelectedMicId,
    llmEnabled,
    setLlmEnabled,
    llmBaseUrl,
    setLlmBaseUrl,
    llmModel,
    setLlmModel,
    llmApiKey,
    setLlmApiKey,
  } = useAppConfig();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<TranscriptionResult | null>(null);
  const [attemptedEndpoint, setAttemptedEndpoint] = useState("");

  const [audioInputs, setAudioInputs] = useState<AudioInputDevice[]>([]);
  const [manifest, setManifest] = useState<Manifest>({ version: 1, updatedAtMs: Date.now(), clips: [] });
  const [manifestStatus, setManifestStatus] = useState("Loading...");
  const [clipSearch, setClipSearch] = useState("");
  const [clipSort, setClipSort] = useState<ClipSort>("newest");
  const [clipCategoryFilter, setClipCategoryFilter] = useState("all");
  const [selectedClipId, setSelectedClipId] = useState("");
  const [micPermission, setMicPermission] = useState<MicPermission>("unknown");

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

  const waveformBars = useMemo(() => {
    if (!selectedClip) {
      return [] as number[];
    }

    let hash = 0;
    for (let i = 0; i < selectedClip.id.length; i++) {
      hash = (hash * 31 + selectedClip.id.charCodeAt(i)) >>> 0;
    }

    const bars: number[] = [];
    for (let i = 0; i < 64; i++) {
      const wave = Math.abs(Math.sin((i + 1) * 0.45 + hash * 0.0002));
      const noise = ((hash >>> (i % 24)) & 15) / 30;
      bars.push(Math.min(1, 0.18 + wave * 0.6 + noise));
    }

    return bars;
  }, [selectedClip]);

  const selectedDurationMs = selectedClip?.durationMs ?? 0;
  const timeline = useTimelinePlayback(selectedClip?.id ?? "", selectedDurationMs);
  const micPermissionText = useMemo(() => getMicrophonePermissionText(micPermission), [micPermission]);

  async function handleClipCaptured(input: {
    pcm: Uint8Array;
    transcript: string;
    startedAtMs: number;
    endedAtMs: number;
  }): Promise<void> {
    const { pcm, transcript, startedAtMs, endedAtMs } = input;

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
      const { clip, backend } = await persistClipSafe(payload);
      setManifest(previous => ({ ...previous, updatedAtMs: Date.now(), clips: [...previous.clips, clip] }));
      setManifestStatus(
        backend === "tauri"
          ? `Saved clip ${clip.id}`
          : `Saved clip ${clip.id} (web local storage)`,
      );
    } catch (persistError) {
      const detail = persistError instanceof Error ? persistError.message : String(persistError);
      setManifestStatus(`Failed to save clip: ${detail}`);
    }
  }

  const realtime = useRealtimeCapture({
    baseUrl,
    apiKey,
    model,
    selectedMicId,
    isAlwaysOnEnabled,
    onClipCaptured: async input => {
      await handleClipCaptured(input);
    },
  });

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
        realtime.stopRealtime();
      };
    }

    return () => {
      realtime.stopRealtime();
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
      realtime.setRealtimeError(`Failed to read microphones: ${detail}`);
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
      realtime.setRealtimeError("");
    } catch (audioPermissionError) {
      await refreshMicPermission();
      realtime.setRealtimeError(formatMicrophoneError(audioPermissionError));
    }
  }

  async function refreshMicPermission(): Promise<void> {
    const state = await getMicrophonePermissionState();
    setMicPermission(state);
  }

  async function loadManifest(): Promise<void> {
    try {
      const { manifest: loaded, backend } = await loadManifestSafe();
      setManifest(loaded);
      setManifestStatus(
        backend === "tauri"
          ? `Loaded ${loaded.clips.length} clips`
          : `Loaded ${loaded.clips.length} clips (web local storage)`,
      );
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

    const chatEndpoints = buildChatEndpoints(llmBaseUrl.trim());
    for (const endpoint of chatEndpoints) {
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
          <HomePage
            isRealtimeRunning={realtime.isRunning}
            onToggleRealtime={() => {
              if (realtime.isRunning) {
                realtime.stopRealtime();
              } else {
                void realtime.startRealtime();
              }
            }}
            clipSearch={clipSearch}
            onChangeClipSearch={setClipSearch}
            clipCategoryFilter={clipCategoryFilter}
            onChangeClipCategoryFilter={setClipCategoryFilter}
            clipSort={clipSort}
            onChangeClipSort={setClipSort}
            clipCategories={clipCategories}
            filteredClips={filteredClips}
            selectedClip={selectedClip}
            onSelectClip={setSelectedClipId}
            manifestStatus={manifestStatus}
            onRefreshManifest={() => {
              void loadManifest();
            }}
            waveformBars={waveformBars}
            safePlayheadMs={timeline.safePlayheadMs}
            selectedDurationMs={selectedDurationMs}
            onSetPlayheadMs={timeline.setPlayheadMs}
            isTimelinePlaying={timeline.isPlaying}
            onToggleTimelinePlay={timeline.togglePlay}
            onSeekBackward={() => timeline.seekByMs(-3000)}
            onSeekForward={() => timeline.seekByMs(3000)}
            onRequestMicAccessAndRefresh={() => {
              void requestMicAccessAndRefresh();
            }}
            onRefreshMicPermission={() => {
              void refreshMicPermission();
            }}
            onOpenSettings={() => setActivePage("settings")}
            realtimeStatus={realtime.realtimeStatus}
            micPermissionText={micPermissionText}
            realtimeError={realtime.realtimeError}
            realtimeText={realtime.realtimeText}
            sentAudioChunks={realtime.sentAudioChunks}
            receivedEvents={realtime.receivedEvents}
            lastEventType={realtime.lastEventType}
            onSelectFile={setSelectedFile}
            canSubmit={canSubmit}
            onTranscribe={() => {
              void onTranscribe();
            }}
            status={status}
            attemptedEndpoint={attemptedEndpoint}
            transcriptionError={error}
            transcriptionResult={result}
          />
        ) : (
          <SettingsPage
            baseUrl={baseUrl}
            setBaseUrl={setBaseUrl}
            model={model}
            setModel={setModel}
            apiKey={apiKey}
            setApiKey={setApiKey}
            selectedMicId={selectedMicId}
            setSelectedMicId={setSelectedMicId}
            audioInputs={audioInputs}
            isAlwaysOnEnabled={isAlwaysOnEnabled}
            setIsAlwaysOnEnabled={setIsAlwaysOnEnabled}
            onRequestMicAccessAndRefresh={() => {
              void requestMicAccessAndRefresh();
            }}
            onRefreshMicPermission={() => {
              void refreshMicPermission();
            }}
            micPermissionText={micPermissionText}
            micPermission={micPermission}
            llmEnabled={llmEnabled}
            setLlmEnabled={setLlmEnabled}
            llmBaseUrl={llmBaseUrl}
            setLlmBaseUrl={setLlmBaseUrl}
            llmModel={llmModel}
            setLlmModel={setLlmModel}
            llmApiKey={llmApiKey}
            setLlmApiKey={setLlmApiKey}
            endpoints={endpoints}
          />
        )}
      </div>
    </main>
  );
}
