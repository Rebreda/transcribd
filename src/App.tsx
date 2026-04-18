import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, House, Settings, Upload } from "lucide-react";
import { bytesToBase64, pcm16ToWav } from "./lib/audioCodec";
import {
  type AppPage,
  type AudioInputDevice,
  type ClipMetadata,
  type ClipSort,
  type Manifest,
  type MicPermission,
  type RealtimeObjectRecord,
  type TranscriptObject,
} from "./lib/appTypes";
import { extractClipCategories, filterAndSortClips, selectClip } from "./lib/clipFinder";
import { buildChatEndpoints, tryParseMetadata } from "./lib/metadata";
import {
  formatMicrophoneError,
  getMicrophonePermissionState,
  getMicrophonePermissionText,
} from "./lib/microphone";
import { loadManifestSafe, persistClipSafe } from "./lib/manifestStore";
import { SerialTaskQueue } from "./lib/serialTaskQueue";
import { loadTranscriptObjects, persistTranscriptObjects } from "./lib/transcriptObjectStore";
import { createPendingTranscriptObject, mapTranscriptObjectToRealtimeRecord } from "./lib/transcriptObjectPipeline";
import {
  AUDIO_SAMPLE_RATE,
  AUDIO_CHANNELS,
  DEFAULT_LLM_MODEL,
  LLM_CLASSIFY_SYSTEM_PROMPT,
  MAX_REALTIME_DISPLAY,
  MAX_TRANSCRIPT_OBJECTS,
  MIN_CLIP_BYTES,
  STORAGE_KEY_NAV_COLLAPSED,
} from "./lib/constants";
import {
  buildLocalFallbackMetadata,
  buildObjectFallbackTitle,
  buildObjectId,
  normalizeLiveRecordKey,
} from "./lib/objectHelpers";
import {
  buildTranscriptionEndpoints,
  extractTranscriptionResult,
  type TranscriptionResult,
} from "./lib/transcriptionParsing";
import { HomePage } from "./components/HomePage";
import { SettingsPage } from "./components/SettingsPage";
import { UploadPage } from "./components/UploadPage";
import { AppConfigProvider, useAppConfig } from "./context/AppConfigContext";
import { useRealtimeCapture } from "./hooks/useRealtimeCapture";
import { useTimelinePlayback } from "./hooks/useTimelinePlayback";

export function App(): JSX.Element {
  return (
    <AppConfigProvider>
      <AppContainer />
    </AppConfigProvider>
  );
}

function AppContainer(): JSX.Element {
  const [activePage, setActivePage] = useState<AppPage>("home");
  const [isNavCollapsed, setIsNavCollapsed] = useState(false);
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
  const [transcriptObjects, setTranscriptObjects] = useState<TranscriptObject[]>([]);

  const queueRef = useRef(new SerialTaskQueue());

  useEffect(() => {
    const persisted = window.localStorage.getItem(STORAGE_KEY_NAV_COLLAPSED);
    if (persisted === "1") {
      setIsNavCollapsed(true);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY_NAV_COLLAPSED, isNavCollapsed ? "1" : "0");
  }, [isNavCollapsed]);

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

  const manifestClipCategories = useMemo(() => extractClipCategories(manifest.clips), [manifest.clips]);
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

  const realtimeObjectRecords = useMemo<RealtimeObjectRecord[]>(() => {
    const fromObjects = [...transcriptObjects]
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
      .slice(0, MAX_REALTIME_DISPLAY)
      .map(mapTranscriptObjectToRealtimeRecord);

    const existingIds = new Set(fromObjects.map(record => record.id));
    const existingKeys = new Set(fromObjects.map(record => normalizeLiveRecordKey(record.text)));
    const fromRealtime = realtime.realtimeRecords
      .filter(record => record.isFinal)
      .filter(record => !existingIds.has(record.id))
      .filter(record => !existingKeys.has(normalizeLiveRecordKey(record.text)))
      .map(record => ({
        id: record.id,
        itemId: record.itemId,
        text: record.text,
        updatedAtMs: record.updatedAtMs,
        title: buildObjectFallbackTitle(record.updatedAtMs),
        notes: "Live transcript received. Awaiting object persistence.",
        categories: ["capture"],
        inferenceState: "pending" as const,
        hasAudioFile: false,
        clipId: null,
      }));

    return [...fromObjects, ...fromRealtime]
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
      .slice(0, MAX_REALTIME_DISPLAY);
  }, [transcriptObjects, realtime.realtimeRecords]);

  const clipCategories = useMemo(() => {
    const values = new Set<string>(manifestClipCategories);
    for (const record of realtimeObjectRecords) {
      for (const category of record.categories) {
        const clean = category.trim();
        if (clean.length > 0) {
          values.add(clean);
        }
      }
    }

    return [...values].sort((a, b) => a.localeCompare(b));
  }, [manifestClipCategories, realtimeObjectRecords]);

  const filteredRealtimeRecords = useMemo(() => {
    const query = clipSearch.trim().toLowerCase();

    return realtimeObjectRecords.filter(record => {
      if (clipCategoryFilter !== "all" && !record.categories.includes(clipCategoryFilter)) {
        return false;
      }

      if (query.length === 0) {
        return true;
      }

      const haystack = [record.title, record.text, record.notes, record.categories.join(" ")]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [realtimeObjectRecords, clipSearch, clipCategoryFilter]);

  useEffect(() => {
    if (selectedClip) {
      setSelectedClipId(selectedClip.id);
    } else {
      setSelectedClipId("");
    }
  }, [selectedClip]);

  useEffect(() => {
    if (!isAlwaysOnEnabled) {
      if (realtime.isRunning) {
        realtime.stopRealtime();
      }
      return;
    }

    if (micPermission !== "granted" || realtime.isRunning) {
      return;
    }

    const timer = window.setTimeout(() => {
      void realtime.startRealtime();
    }, 350);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isAlwaysOnEnabled, micPermission, selectedMicId, baseUrl, apiKey, model, realtime.isRunning]);

  useEffect(() => {
    setTranscriptObjects(loadTranscriptObjects());
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

  useEffect(() => {
    persistTranscriptObjects(transcriptObjects);
  }, [transcriptObjects]);

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
      const { manifest: loaded } = await loadManifestSafe();
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

  async function enrichMetadataWithLlm(input: { transcript: string; titleFallback: string }): Promise<ClipMetadata> {
    const requestBody = {
      model: llmModel.trim() || DEFAULT_LLM_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: LLM_CLASSIFY_SYSTEM_PROMPT,
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

    throw new Error("All LLM endpoints failed or returned unparseable responses.");
  }

  async function handleClipCaptured(input: {
    pcm: Uint8Array;
    transcript: string;
    startedAtMs: number;
    endedAtMs: number;
  }): Promise<void> {
    const transcript = input.transcript.trim();
    if (input.pcm.byteLength < MIN_CLIP_BYTES || transcript.length === 0) {
      return;
    }

    const createdAtMs = Date.now();
    const objectId = buildObjectId(createdAtMs);
    const object: TranscriptObject = createPendingTranscriptObject({
      id: objectId,
      source: "realtime",
      itemId: "",
      transcript,
      startedAtMs: input.startedAtMs,
      endedAtMs: input.endedAtMs,
      createdAtMs,
    });

    setTranscriptObjects(previous => [object, ...previous].slice(0, MAX_TRANSCRIPT_OBJECTS));

    queueRef.current.enqueue(async () => {
      await processTranscriptObject(object, input.pcm, {
        llmEnabled,
      });
    });
  }

  async function processTranscriptObject(
    object: TranscriptObject,
    pcm: Uint8Array,
    options: { llmEnabled: boolean },
  ): Promise<void> {
    updateTranscriptObject(object.id, {
      inferenceState: "processing",
      notes: "Classifying and preparing files.",
      fileError: "",
    });

    const fallback = buildLocalFallbackMetadata(object.transcript, object.createdAtMs);

    let metadata: ClipMetadata = fallback;

    if (options.llmEnabled) {
      try {
        metadata = await enrichMetadataWithLlm({ transcript: object.transcript, titleFallback: fallback.title });
      } catch {
        metadata = {
          ...fallback,
          notes: "Metadata inference failed. Using fallback metadata.",
        };
      }
    }

    updateTranscriptObject(object.id, {
      title: metadata.title,
      notes: metadata.notes,
      categories: metadata.categories,
      inferenceState: "ready",
    });

    try {
      const wav = pcm16ToWav(pcm, AUDIO_SAMPLE_RATE, AUDIO_CHANNELS);
      const payload = {
        objectId: object.id,
        audioBase64: bytesToBase64(wav),
        transcript: object.transcript,
        title: metadata.title,
        notes: metadata.notes,
        categories: metadata.categories,
        startedAtMs: object.startedAtMs,
        endedAtMs: object.endedAtMs,
        sampleRate: AUDIO_SAMPLE_RATE,
        channels: AUDIO_CHANNELS,
      };

      const { clip } = await persistClipSafe(payload);
      setManifest(previous => ({ ...previous, updatedAtMs: Date.now(), clips: [...previous.clips, clip] }));
      setManifestStatus(`Saved clip ${clip.id}`);

      updateTranscriptObject(object.id, {
        fileState: "saved",
        clipId: clip.id,
        fileName: clip.fileName,
        transcriptFileName: clip.transcriptFileName ?? "",
        objectFileName: clip.objectFileName ?? "",
      });
    } catch (persistError) {
      const detail = persistError instanceof Error ? persistError.message : String(persistError);
      setManifestStatus(`Failed to save clip: ${detail}`);

      updateTranscriptObject(object.id, {
        fileState: "error",
        fileError: detail,
      });
    }
  }

  function updateTranscriptObject(objectId: string, patch: Partial<TranscriptObject>): void {
    setTranscriptObjects(previous =>
      previous.map(object => {
        if (object.id !== objectId) {
          return object;
        }

        return {
          ...object,
          ...patch,
          updatedAtMs: Date.now(),
        };
      }),
    );
  }

  return (
    <main className={`appShell ${isNavCollapsed ? "navCollapsed" : ""}`}>
      <aside className={`sidebar ${isNavCollapsed ? "collapsed" : ""}`}>
        <div className="sidebarHeader">
          <div className="sidebarBrand">
            <h1>Transcribd</h1>
            <p>Transcription workspace</p>
          </div>
          <button
            type="button"
            className="collapseButton"
            onClick={() => {
              setIsNavCollapsed(previous => !previous);
            }}
            aria-label={isNavCollapsed ? "Expand navigation" : "Collapse navigation"}
            title={isNavCollapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {isNavCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        <button
          className={`navButton ${activePage === "home" ? "active" : ""}`}
          onClick={() => setActivePage("home")}
          aria-label="Home"
          title="Home"
        >
          <House size={16} />
          <span>Home</span>
        </button>
        <button
          className={`navButton ${activePage === "upload" ? "active" : ""}`}
          onClick={() => setActivePage("upload")}
          aria-label="Upload"
          title="Upload"
        >
          <Upload size={16} />
          <span>Upload</span>
        </button>
        <button
          className={`navButton ${activePage === "settings" ? "active" : ""}`}
          onClick={() => setActivePage("settings")}
          aria-label="Settings"
          title="Settings"
        >
          <Settings size={16} />
          <span>Settings</span>
        </button>
      </aside>

      <div className="app">
        {activePage === "home" ? (
          <HomePage
            isAlwaysOnEnabled={isAlwaysOnEnabled}
            isRealtimeRunning={realtime.isRunning}
            onToggleRealtime={() => {
              if (realtime.isRunning) {
                setIsAlwaysOnEnabled(false);
                realtime.stopRealtime();
              } else {
                if (!isAlwaysOnEnabled) {
                  setIsAlwaysOnEnabled(true);
                }
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
            realtimeStatus={realtime.realtimeStatus}
            realtimeRecords={filteredRealtimeRecords}
            realtimeCurrentRecord={realtime.realtimeCurrentRecord}
            micPermissionText={micPermissionText}
            realtimeError={realtime.realtimeError}
            realtimeText={realtime.realtimeText}
            audioLevelBars={realtime.audioLevelBars}
            sentAudioChunks={realtime.sentAudioChunks}
            receivedEvents={realtime.receivedEvents}
            lastEventType={realtime.lastEventType}
            onOpenRecordClip={setSelectedClipId}
          />
        ) : activePage === "upload" ? (
          <UploadPage
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


