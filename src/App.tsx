import { useEffect, useMemo, useRef, useState } from "react";
import { bytesToBase64, pcm16ToWav } from "./lib/audioCodec";
import {
  type Artifact,
  type AppPage,
  type AudioInputDevice,
  type ClipMetadata,
  type ClipSort,
  type Manifest,
  type MicPermission,
} from "./lib/appTypes";
import { extractRecordCategories, filterAndSortRecords } from "./lib/clipFinder";
import { buildFallbackTitle } from "./lib/metadata";
import {
  formatMicrophoneError,
  getMicrophonePermissionState,
  getMicrophonePermissionText,
} from "./lib/microphone";
import { loadManifestSafe, persistClipSafe } from "./lib/manifestStore";
import { buildLocalFallbackMetadata, buildObjectId } from "./lib/objectHelpers";
import { SerialTaskQueue } from "./lib/serialTaskQueue";
import {
  buildTranscriptionEndpoints,
  extractTranscriptionResult,
  type TranscriptionResult,
} from "./lib/transcriptionParsing";
import {
  buildArtifactExportJson,
  buildClipByTranscriptMap,
  buildRealtimeArtifacts,
  buildWaveformBars,
  mapClipToArtifact,
  mergeArtifacts,
  normalizeTranscriptKey,
} from "./lib/artifactDomain";
import { inferClipMetadataWithLlm, transcribePcmFallback } from "./lib/transcriptionWorkflow";
import { AUDIO_CHANNELS, AUDIO_SAMPLE_RATE, MIN_CLIP_BYTES } from "./lib/constants";
import { parseTranscriptionRequestOptions } from "./lib/apiSchemas";
import { HomePage } from "./components/HomePage";
import { LiveBar } from "./components/LiveBar";
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
    realtimeOptions,
    setRealtimeOptions,
    transcriptionOptions,
    setTranscriptionOptions,
    llmInferenceOptions,
    setLlmInferenceOptions,
    showSuppressedRecords,
    setShowSuppressedRecords,
  } = useAppConfig();
  

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
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
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [audioUrls, setAudioUrls] = useState<Map<string, string>>(() => new Map());
  const [micPermission, setMicPermission] = useState<MicPermission>("unknown");
  const [realtimeMetadataByRecordId, setRealtimeMetadataByRecordId] = useState<Record<string, {
    title: string;
    notes: string;
    categories: string[];
    inferenceState: "pending" | "ready" | "error";
  }>>({});
  const realtimeInferenceInFlightRef = useRef(new Set<string>());
  const llmQueueRef = useRef(new SerialTaskQueue());
  const metadataByRecordIdRef = useRef(realtimeMetadataByRecordId);
  const audioUrlsRef = useRef(audioUrls);

  const endpoints = useMemo(() => buildTranscriptionEndpoints(baseUrl), [baseUrl]);
  const resolvedTranscriptionOptions = useMemo(
    () => parseTranscriptionRequestOptions(transcriptionOptions),
    [
      transcriptionOptions.language,
      transcriptionOptions.prompt,
      transcriptionOptions.responseFormat,
      transcriptionOptions.temperature,
    ],
  );
  const canSubmit = selectedFiles.length > 0 && model.trim().length > 0;

  const persistedArtifacts = useMemo<Artifact[]>(
    () => [...manifest.clips].map(clip => mapClipToArtifact(clip)).sort((a, b) => b.updatedAtMs - a.updatedAtMs),
    [manifest.clips],
  );

  const waveformBars = useMemo(() => buildWaveformBars(selectedArtifactId), [selectedArtifactId]);

  const micPermissionText = useMemo(() => getMicrophonePermissionText(micPermission), [micPermission]);
  const newestClips = useMemo(
    () => [...manifest.clips].sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, 80),
    [manifest.clips],
  );

  const clipByTranscript = useMemo(() => buildClipByTranscriptMap(newestClips), [newestClips]);

  const realtime = useRealtimeCapture({
    baseUrl,
    apiKey,
    model,
    selectedMicId,
    isAlwaysOnEnabled,
    realtimeOptions,
    onClipCaptured: async input => {
      await handleClipCaptured(input);
    },
  });

  const realtimeArtifacts = useMemo<Artifact[]>(
    () => buildRealtimeArtifacts({
      realtimeRecords: realtime.realtimeRecords,
      clipByTranscript,
      metadataByRecordId: realtimeMetadataByRecordId,
    }),
    [realtime.realtimeRecords, clipByTranscript, realtimeMetadataByRecordId],
  );

  const artifacts = useMemo(
    () => mergeArtifacts([...persistedArtifacts, ...realtimeArtifacts]),
    [persistedArtifacts, realtimeArtifacts],
  );

  const filteredRealtimeRecords = useMemo(
    () =>
      filterAndSortRecords({
        records: artifacts,
        searchQuery: clipSearch,
        categoryFilter: clipCategoryFilter,
        sortBy: clipSort,
        includeSuppressed: showSuppressedRecords,
      }),
    [artifacts, clipSearch, clipCategoryFilter, clipSort, showSuppressedRecords],
  );

  const selectedArtifact = useMemo(
    () => filteredRealtimeRecords.find(record => record.id === selectedArtifactId) ?? filteredRealtimeRecords[0] ?? null,
    [filteredRealtimeRecords, selectedArtifactId],
  );

  const selectedClipFromArtifact = useMemo(() => {
    if (selectedArtifact?.clipId) {
      return manifest.clips.find(clip => clip.id === selectedArtifact.clipId) ?? null;
    }

    return null;
  }, [selectedArtifact, manifest.clips]);

  const selectedDurationMsResolved = selectedClipFromArtifact?.durationMs ?? 0;
  const selectedClipAudioUrl = selectedClipFromArtifact ? audioUrls.get(selectedClipFromArtifact.id) : undefined;
  const timelineResolved = useTimelinePlayback(selectedClipFromArtifact?.id ?? "", selectedDurationMsResolved, selectedClipAudioUrl);

  const clipCategories = useMemo(() => {
    return extractRecordCategories(artifacts);
  }, [artifacts]);

  useEffect(() => {
    metadataByRecordIdRef.current = realtimeMetadataByRecordId;
  }, [realtimeMetadataByRecordId]);

  useEffect(() => {
    audioUrlsRef.current = audioUrls;
  }, [audioUrls]);

  useEffect(() => {
    return () => {
      for (const url of audioUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  useEffect(() => {
    const liveClipIds = new Set(manifest.clips.map(clip => clip.id));
    setAudioUrls(previous => {
      let hasChanges = false;
      const next = new Map(previous);

      for (const [clipId, url] of next.entries()) {
        if (!liveClipIds.has(clipId)) {
          URL.revokeObjectURL(url);
          next.delete(clipId);
          hasChanges = true;
        }
      }

      return hasChanges ? next : previous;
    });
  }, [manifest.clips]);

  useEffect(() => {
    if (filteredRealtimeRecords.length === 0) {
      setSelectedArtifactId(null);
      return;
    }

    if (!selectedArtifactId || !filteredRealtimeRecords.some(artifact => artifact.id === selectedArtifactId)) {
      setSelectedArtifactId(filteredRealtimeRecords[0]?.id ?? null);
    }
  }, [filteredRealtimeRecords, selectedArtifactId]);

  async function handleClipCaptured(input: {
    pcm: Uint8Array;
    transcript: string;
    startedAtMs: number;
    endedAtMs: number;
  }): Promise<void> {
    const { pcm, transcript, startedAtMs, endedAtMs } = input;
    let transcriptTrimmed = transcript.trim();

    if (pcm.byteLength < MIN_CLIP_BYTES) {
      return;
    }

    if (transcriptTrimmed.length === 0) {
      const recovered = await transcribeClipAudioFallback(pcm);
      transcriptTrimmed = recovered.trim();
    }

    const transcriptForStorage = transcriptTrimmed.length > 0 ? transcriptTrimmed : "(no transcript returned)";

    const metadata = llmEnabled && transcriptTrimmed.length > 0
      ? await enrichMetadataWithLlm({ transcript: transcriptForStorage, titleFallback: buildFallbackTitle(transcriptForStorage) })
      : buildLocalFallbackMetadata(transcriptForStorage, endedAtMs);

    const wav = pcm16ToWav(pcm, AUDIO_SAMPLE_RATE, AUDIO_CHANNELS);
    const payload = {
      objectId: buildObjectId(endedAtMs),
      audioBase64: bytesToBase64(wav),
      transcript: transcriptForStorage,
      title: metadata.title,
      notes: metadata.notes,
      categories: metadata.categories,
      startedAtMs,
      endedAtMs,
      sampleRate: AUDIO_SAMPLE_RATE,
      channels: AUDIO_CHANNELS,
    };

    try {
      const { clip } = await persistClipSafe(payload);
      const audioBlob = new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" });
      const url = URL.createObjectURL(audioBlob);
      setAudioUrls(previous => {
        const next = new Map(previous);
        const existing = next.get(clip.id);
        if (existing) {
          URL.revokeObjectURL(existing);
        }
        next.set(clip.id, url);
        return next;
      });
      setManifest(previous => ({ ...previous, updatedAtMs: Date.now(), clips: [...previous.clips, clip] }));
      setManifestStatus(`Saved clip ${clip.id}`);
    } catch (persistError) {
      const detail = persistError instanceof Error ? persistError.message : String(persistError);
      setManifestStatus(`Failed to save clip: ${detail}`);
    }
  }

  async function transcribeClipAudioFallback(pcm: Uint8Array): Promise<string> {
    const wav = pcm16ToWav(pcm, AUDIO_SAMPLE_RATE, AUDIO_CHANNELS);
    return transcribePcmFallback({
      pcmWavBytes: wav,
      model,
      apiKey,
      endpoints,
      options: resolvedTranscriptionOptions,
    });
  }

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
  }, [
    isAlwaysOnEnabled,
    micPermission,
    selectedMicId,
    baseUrl,
    apiKey,
    model,
    realtime.isRunning,
    realtimeOptions.turnDetectionType,
    realtimeOptions.vadThreshold,
    realtimeOptions.silenceDurationMs,
    realtimeOptions.prefixPaddingMs,
  ]);

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
      const { manifest: loaded } = await loadManifestSafe();
      setManifest(loaded);
      setManifestStatus(`Loaded ${loaded.clips.length} clips`);
    } catch (manifestError) {
      const detail = manifestError instanceof Error ? manifestError.message : String(manifestError);
      setManifestStatus(`Manifest unavailable: ${detail}`);
    }
  }

  async function onTranscribe(): Promise<void> {
    if (selectedFiles.length === 0) {
      setError("Pick one or more audio files first.");
      return;
    }

    setError("");
    setResult(null);

    const headers = new Headers();
    if (apiKey.trim().length > 0) {
      headers.set("Authorization", `Bearer ${apiKey.trim()}`);
    }

    let firstClipArtifactId: string | null = null;
    let successCount = 0;
    let lastResult: TranscriptionResult | null = null;
    const allErrors: string[] = [];

    for (const file of selectedFiles) {
      setStatus(`Transcribing ${file.name}…`);

      let succeeded = false;
      for (const endpoint of endpoints) {
        setAttemptedEndpoint(endpoint);
        const formData = new FormData();
        formData.append("model", model.trim());
        formData.append("file", file, file.name);
        if (resolvedTranscriptionOptions.language.length > 0) {
          formData.append("language", resolvedTranscriptionOptions.language);
        }
        if (resolvedTranscriptionOptions.prompt.length > 0) {
          formData.append("prompt", resolvedTranscriptionOptions.prompt);
        }
        formData.append("response_format", resolvedTranscriptionOptions.responseFormat);
        formData.append("temperature", String(resolvedTranscriptionOptions.temperature));

        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers,
            body: formData,
          });
          const body = await response.text();

          if (!response.ok) {
            allErrors.push(`${response.status} ${endpoint} (${file.name})`);
            continue;
          }

          const parsed = extractTranscriptionResult(body);
          lastResult = parsed;
          setResult(parsed);

          const transcript = parsed.text.trim();
          const fallbackTitle = buildFallbackTitle(transcript);
          const metadata = llmEnabled
            ? await enrichMetadataWithLlm({ transcript, titleFallback: fallbackTitle })
            : buildLocalFallbackMetadata(transcript, Date.now());

          const now = Date.now();
          try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBase64 = bytesToBase64(new Uint8Array(arrayBuffer));
            const { clip } = await persistClipSafe({
              objectId: buildObjectId(now),
              audioBase64,
              transcript,
              title: metadata.title,
              notes: metadata.notes,
              categories: metadata.categories,
              startedAtMs: now,
              endedAtMs: now,
              sampleRate: AUDIO_SAMPLE_RATE,
              channels: AUDIO_CHANNELS,
            });
            setManifest(previous => ({ ...previous, updatedAtMs: Date.now(), clips: [...previous.clips, clip] }));
            if (firstClipArtifactId === null) {
              firstClipArtifactId = `clip-${clip.id}`;
            }
          } catch (persistError) {
            const detail = persistError instanceof Error ? persistError.message : String(persistError);
            setManifestStatus(`Failed to save upload: ${detail}`);
          }

          successCount += 1;
          succeeded = true;
          break;
        } catch (requestError) {
          const detail = requestError instanceof Error ? requestError.message : String(requestError);
          allErrors.push(`ERR ${endpoint} (${file.name}): ${detail}`);
        }
      }

      if (!succeeded) {
        allErrors.push(`All endpoints failed for ${file.name}`);
      }
    }

    if (successCount > 0) {
      if (firstClipArtifactId !== null) {
        setSelectedArtifactId(firstClipArtifactId);
      }
      setActivePage("home");
      setStatus(`Done — ${successCount} file${successCount > 1 ? "s" : ""} transcribed`);
    } else {
      setStatus("Failed");
      setError(allErrors.join(" | "));
    }

    if (lastResult) {
      setResult(lastResult);
    }
  }

  async function enrichMetadataWithLlm(input: { transcript: string; titleFallback: string }): Promise<ClipMetadata> {
    return inferClipMetadataWithLlm({
      transcript: input.transcript,
      titleFallback: input.titleFallback,
      llmModel,
      llmBaseUrl,
      llmApiKey,
      llmOptions: llmInferenceOptions,
    });
  }

  useEffect(() => {
    for (const record of realtime.realtimeRecords) {
      if (!record.isFinal) {
        continue;
      }

      const matchedClip = clipByTranscript.get(normalizeTranscriptKey(record.text));
      if (matchedClip) {
        continue;
      }

      if (metadataByRecordIdRef.current[record.id] || realtimeInferenceInFlightRef.current.has(record.id)) {
        continue;
      }

      realtimeInferenceInFlightRef.current.add(record.id);
      const immediateMetadata = buildLocalFallbackMetadata(record.text, record.updatedAtMs);
      metadataByRecordIdRef.current = {
        ...metadataByRecordIdRef.current,
        [record.id]: {
          ...immediateMetadata,
          notes: llmEnabled ? "Inferring metadata for live object..." : immediateMetadata.notes,
          inferenceState: "pending" as const,
        },
      };

      setRealtimeMetadataByRecordId(previous => ({
        ...previous,
        [record.id]: {
          ...immediateMetadata,
          notes: llmEnabled ? "Inferring metadata for live object..." : immediateMetadata.notes,
          inferenceState: "pending" as const,
        },
      }));

      llmQueueRef.current.enqueue(async () => {
        try {
          const inferred = llmEnabled
            ? await enrichMetadataWithLlm({ transcript: record.text, titleFallback: immediateMetadata.title })
            : immediateMetadata;

          metadataByRecordIdRef.current = {
            ...metadataByRecordIdRef.current,
            [record.id]: {
              ...inferred,
              inferenceState: "ready",
            },
          };

          setRealtimeMetadataByRecordId(previous => ({
            ...previous,
            [record.id]: {
              ...inferred,
              inferenceState: "ready",
            },
          }));
        } catch {
          metadataByRecordIdRef.current = {
            ...metadataByRecordIdRef.current,
            [record.id]: {
              ...immediateMetadata,
              notes: "Metadata inference failed for this live object.",
              inferenceState: "error",
            },
          };

          setRealtimeMetadataByRecordId(previous => ({
            ...previous,
            [record.id]: {
              ...immediateMetadata,
              notes: "Metadata inference failed for this live object.",
              inferenceState: "error",
            },
          }));
        } finally {
          realtimeInferenceInFlightRef.current.delete(record.id);
        }
      });
    }
  }, [realtime.realtimeRecords, clipByTranscript, llmEnabled]);

  function handleExportJson(): void {
    const json = buildArtifactExportJson(artifacts);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `vocalis-export-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
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
          className={`navButton ${activePage === "upload" ? "active" : ""}`}
          onClick={() => setActivePage("upload")}
        >
          Upload
        </button>
        <button
          className={`navButton ${activePage === "settings" ? "active" : ""}`}
          onClick={() => setActivePage("settings")}
        >
          Settings
        </button>
        <button
          className="navButton"
          onClick={handleExportJson}
          disabled={artifacts.length === 0}
        >
          Export JSON
        </button>
      </aside>

      <div className="app">
        <LiveBar
          isRunning={realtime.isRunning}
          onToggle={() => {
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
          realtimeText={realtime.realtimeText}
          audioLevelBars={realtime.audioLevelBars}
          realtimeStatus={realtime.realtimeStatus}
          realtimeError={realtime.realtimeError}
          realtimeLog={realtime.realtimeLog}
          sentAudioChunks={realtime.sentAudioChunks}
          receivedEvents={realtime.receivedEvents}
          lastEventType={realtime.lastEventType}
        />

        {activePage === "home" ? (
          <HomePage
            clipSearch={clipSearch}
            onChangeClipSearch={setClipSearch}
            clipCategoryFilter={clipCategoryFilter}
            onChangeClipCategoryFilter={setClipCategoryFilter}
            clipSort={clipSort}
            onChangeClipSort={setClipSort}
            clipCategories={clipCategories}
            artifacts={filteredRealtimeRecords}
            selectedClip={selectedClipFromArtifact}
            selectedArtifact={selectedArtifact}
            selectedArtifactId={selectedArtifactId}
            onSelectArtifact={setSelectedArtifactId}
            manifestStatus={manifestStatus}
            onRefreshManifest={() => {
              void loadManifest();
            }}
            waveformBars={waveformBars}
            safePlayheadMs={timelineResolved.safePlayheadMs}
            selectedDurationMs={selectedDurationMsResolved}
            onSetPlayheadMs={timelineResolved.setPlayheadMs}
            isTimelinePlaying={timelineResolved.isPlaying}
            onToggleTimelinePlay={timelineResolved.togglePlay}
            onSeekBackward={() => timelineResolved.seekByMs(-3000)}
            onSeekForward={() => timelineResolved.seekByMs(3000)}
          />
        ) : activePage === "upload" ? (
          <section className="pageMain">
            <UploadPage
              onSelectFiles={files => setSelectedFiles(files)}
              canSubmit={canSubmit}
              onTranscribe={() => {
                void onTranscribe();
              }}
              status={status}
              attemptedEndpoint={attemptedEndpoint}
              transcriptionError={error}
              transcriptionResult={result}
            />
          </section>
        ) : (
          <section className="pageMain">
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
              realtimeOptions={realtimeOptions}
              setRealtimeOptions={setRealtimeOptions}
              transcriptionOptions={transcriptionOptions}
              setTranscriptionOptions={setTranscriptionOptions}
              llmInferenceOptions={llmInferenceOptions}
              setLlmInferenceOptions={setLlmInferenceOptions}
              showSuppressedRecords={showSuppressedRecords}
              setShowSuppressedRecords={setShowSuppressedRecords}
              endpoints={endpoints}
            />
          </section>
        )}
      </div>
    </main>
  );
}


