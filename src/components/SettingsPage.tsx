import type { AudioInputDevice, MicPermission } from "../lib/appTypes";

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
    endpoints,
  } = props;

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
  );
}
