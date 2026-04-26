import { useMemo } from "react";
import type { AudioInputDevice, MicPermission } from "../lib/appTypes";
import { MICROPHONE_TROUBLESHOOTING_STEPS, normalizeEndpointList } from "../lib/settingsUploadUtils";
import type { LlmInferenceOptions, RealtimeSessionOptions, TranscriptionRequestOptions } from "../lib/apiSchemas";

function parseNumberOrFallback(raw: string, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

type SettingsPageProps = {
  baseUrl: string;
  setBaseUrl: (value: string) => void;
  model: string;
  setModel: (value: string) => void;
  apiKey: string;
  setApiKey: (value: string) => void;
  selectedMicId: string;
  setSelectedMicId: (value: string) => void;
  audioInputs: AudioInputDevice[];
  isAlwaysOnEnabled: boolean;
  setIsAlwaysOnEnabled: (value: boolean) => void;
  onRequestMicAccessAndRefresh: () => void;
  onRefreshMicPermission: () => void;
  micPermissionText: string;
  micPermission: MicPermission;

  llmEnabled: boolean;
  setLlmEnabled: (value: boolean) => void;
  llmBaseUrl: string;
  setLlmBaseUrl: (value: string) => void;
  llmModel: string;
  setLlmModel: (value: string) => void;
  llmApiKey: string;
  setLlmApiKey: (value: string) => void;
  realtimeOptions: RealtimeSessionOptions;
  setRealtimeOptions: (value: RealtimeSessionOptions) => void;
  transcriptionOptions: TranscriptionRequestOptions;
  setTranscriptionOptions: (value: TranscriptionRequestOptions) => void;
  llmInferenceOptions: LlmInferenceOptions;
  setLlmInferenceOptions: (value: LlmInferenceOptions) => void;
  showSuppressedRecords: boolean;
  setShowSuppressedRecords: (value: boolean) => void;

  endpoints: string[];
};

export function SettingsPage(props: SettingsPageProps): JSX.Element {
  const {
    baseUrl,
    setBaseUrl,
    model,
    setModel,
    apiKey,
    setApiKey,
    selectedMicId,
    setSelectedMicId,
    audioInputs,
    isAlwaysOnEnabled,
    setIsAlwaysOnEnabled,
    onRequestMicAccessAndRefresh,
    onRefreshMicPermission,
    micPermissionText,
    micPermission,
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
    endpoints,
  } = props;

  const endpointList = useMemo(() => normalizeEndpointList(endpoints), [endpoints]);

  return (
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

          <label className="field">
            <span>Turn Detection Type</span>
            <select
              value={realtimeOptions.turnDetectionType}
              onChange={event => setRealtimeOptions({
                ...realtimeOptions,
                turnDetectionType: event.target.value as RealtimeSessionOptions["turnDetectionType"],
              })}
            >
              <option value="server_vad">server_vad</option>
              <option value="none">none</option>
            </select>
          </label>

          <label className="field">
            <span>VAD Threshold (0-1)</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={realtimeOptions.vadThreshold}
              onChange={event => setRealtimeOptions({
                ...realtimeOptions,
                vadThreshold: parseNumberOrFallback(event.target.value, realtimeOptions.vadThreshold),
              })}
            />
          </label>

          <label className="field">
            <span>Silence Duration (ms)</span>
            <input
              type="number"
              min={200}
              max={10000}
              step={50}
              value={realtimeOptions.silenceDurationMs}
              onChange={event => setRealtimeOptions({
                ...realtimeOptions,
                silenceDurationMs: parseNumberOrFallback(event.target.value, realtimeOptions.silenceDurationMs),
              })}
            />
          </label>

          <label className="field">
            <span>Prefix Padding (ms)</span>
            <input
              type="number"
              min={0}
              max={5000}
              step={25}
              value={realtimeOptions.prefixPaddingMs}
              onChange={event => setRealtimeOptions({
                ...realtimeOptions,
                prefixPaddingMs: parseNumberOrFallback(event.target.value, realtimeOptions.prefixPaddingMs),
              })}
            />
          </label>
        </div>

        <div className="row">
          <button className="secondary" onClick={onRequestMicAccessAndRefresh}>
            Detect Microphones
          </button>
          <button className="secondary" onClick={onRefreshMicPermission}>
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
            {MICROPHONE_TROUBLESHOOTING_STEPS.map(step => (
              <li key={step}>{step}</li>
            ))}
          </ul>
          <p className="status">Linux hint: check portal and PipeWire permissions/settings for desktop audio input.</p>
        </section>
      )}

      <section className="panel">
        <h2>Transcription API Settings</h2>
        <div className="grid2">
          <label className="field">
            <span>Language (optional)</span>
            <input
              value={transcriptionOptions.language}
              onChange={event => setTranscriptionOptions({
                ...transcriptionOptions,
                language: event.target.value,
              })}
              placeholder="en"
            />
          </label>

          <label className="field">
            <span>Response Format</span>
            <select
              value={transcriptionOptions.responseFormat}
              onChange={event => setTranscriptionOptions({
                ...transcriptionOptions,
                responseFormat: event.target.value as TranscriptionRequestOptions["responseFormat"],
              })}
            >
              <option value="verbose_json">verbose_json</option>
              <option value="json">json</option>
              <option value="text">text</option>
            </select>
          </label>

          <label className="field">
            <span>Temperature (0-1)</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={transcriptionOptions.temperature}
              onChange={event => setTranscriptionOptions({
                ...transcriptionOptions,
                temperature: parseNumberOrFallback(event.target.value, transcriptionOptions.temperature),
              })}
            />
          </label>

          <label className="field fullSpanField">
            <span>Prompt (optional)</span>
            <input
              value={transcriptionOptions.prompt}
              onChange={event => setTranscriptionOptions({
                ...transcriptionOptions,
                prompt: event.target.value,
              })}
              placeholder="Bias terms and style hints for transcription"
            />
          </label>
        </div>
      </section>

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
            <input value={llmModel} onChange={event => setLlmModel(event.target.value)} placeholder="Gemma-4-E4B-it-GGUF" />
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

          <label className="field">
            <span>Inference Response Format</span>
            <select
              value={llmInferenceOptions.responseFormat}
              onChange={event => setLlmInferenceOptions({
                ...llmInferenceOptions,
                responseFormat: event.target.value as LlmInferenceOptions["responseFormat"],
              })}
            >
              <option value="json_object">json_object</option>
              <option value="text">text</option>
            </select>
          </label>

          <label className="field">
            <span>Inference Temperature (0-2)</span>
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={llmInferenceOptions.temperature}
              onChange={event => setLlmInferenceOptions({
                ...llmInferenceOptions,
                temperature: parseNumberOrFallback(event.target.value, llmInferenceOptions.temperature),
              })}
            />
          </label>

          <label className="field fullSpanField">
            <span>Inference System Prompt</span>
            <textarea
              value={llmInferenceOptions.systemPrompt}
              onChange={event => setLlmInferenceOptions({
                ...llmInferenceOptions,
                systemPrompt: event.target.value,
              })}
              rows={4}
            />
          </label>

          <label className="checkRow fullSpanField">
            <input
              type="checkbox"
              checked={showSuppressedRecords}
              onChange={event => setShowSuppressedRecords(event.target.checked)}
            />
            <span>Show suppressed "silence/no audio" records in Home list</span>
          </label>
        </div>
      </section>

      <section className="panel">
        <h2>Endpoint Resolution</h2>
        <ul>
          {endpointList.map(endpoint => (
            <li key={endpoint}>{endpoint}</li>
          ))}
        </ul>
      </section>
    </>
  );
}
