import type { ClipSort, ManifestClip } from "../lib/appTypes";
import type { TranscriptionResult } from "../lib/transcriptionParsing";

type HomePageProps = {
  isRealtimeRunning: boolean;
  onToggleRealtime: () => void;

  clipSearch: string;
  onChangeClipSearch: (value: string) => void;
  clipCategoryFilter: string;
  onChangeClipCategoryFilter: (value: string) => void;
  clipSort: ClipSort;
  onChangeClipSort: (value: ClipSort) => void;
  clipCategories: string[];
  filteredClips: ManifestClip[];
  selectedClip: ManifestClip | null;
  onSelectClip: (clipId: string) => void;
  manifestStatus: string;
  onRefreshManifest: () => void;

  waveformBars: number[];
  safePlayheadMs: number;
  selectedDurationMs: number;
  onSetPlayheadMs: (value: number) => void;
  isTimelinePlaying: boolean;
  onToggleTimelinePlay: () => void;
  onSeekBackward: () => void;
  onSeekForward: () => void;

  onRequestMicAccessAndRefresh: () => void;
  onRefreshMicPermission: () => void;
  onOpenSettings: () => void;
  realtimeStatus: string;
  micPermissionText: string;
  realtimeError: string;
  realtimeText: string;

  onSelectFile: (file: File | null) => void;
  canSubmit: boolean;
  onTranscribe: () => void;
  status: string;
  attemptedEndpoint: string;
  transcriptionError: string;
  transcriptionResult: TranscriptionResult | null;
};

export function HomePage(props: HomePageProps): JSX.Element {
  const {
    isRealtimeRunning,
    onToggleRealtime,
    clipSearch,
    onChangeClipSearch,
    clipCategoryFilter,
    onChangeClipCategoryFilter,
    clipSort,
    onChangeClipSort,
    clipCategories,
    filteredClips,
    selectedClip,
    onSelectClip,
    manifestStatus,
    onRefreshManifest,
    waveformBars,
    safePlayheadMs,
    selectedDurationMs,
    onSetPlayheadMs,
    isTimelinePlaying,
    onToggleTimelinePlay,
    onSeekBackward,
    onSeekForward,
    onRequestMicAccessAndRefresh,
    onRefreshMicPermission,
    onOpenSettings,
    realtimeStatus,
    micPermissionText,
    realtimeError,
    realtimeText,
    onSelectFile,
    canSubmit,
    onTranscribe,
    status,
    attemptedEndpoint,
    transcriptionError,
    transcriptionResult,
  } = props;

  return (
    <section className="studioLayout">
      <aside className="recordingsPane">
        <div className="recordingsToolbar">
          <button className="recordAction" onClick={onToggleRealtime}>
            {isRealtimeRunning ? "Stop" : "Record"}
          </button>
          <strong className="paneBrand">Transcribd</strong>
        </div>

        <label className="field">
          <span>Filter</span>
          <input
            value={clipSearch}
            onChange={event => onChangeClipSearch(event.target.value)}
            placeholder="Filter by category, text, title..."
          />
        </label>

        <div className="finderControls compact">
          <label className="field">
            <span>Category</span>
            <select value={clipCategoryFilter} onChange={event => onChangeClipCategoryFilter(event.target.value)}>
              <option value="all">All Dates</option>
              {clipCategories.map(category => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Sort</span>
            <select value={clipSort} onChange={event => onChangeClipSort(event.target.value as ClipSort)}>
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="title">Title A-Z</option>
            </select>
          </label>
        </div>

        <div className="clipListCompact listMode">
          {filteredClips.length === 0 && <p className="status">No matching recordings.</p>}
          {filteredClips.map(clip => (
            <button
              key={clip.id}
              className={`clipItemButton ${selectedClip?.id === clip.id ? "active" : ""}`}
              onClick={() => onSelectClip(clip.id)}
            >
              <strong>{clip.title}</strong>
              <span>
                {new Date(clip.createdAtMs).toLocaleTimeString()} | {formatClock(clip.durationMs)}
              </span>
              <span>{clip.categories.join(" • ") || "uncategorized"}</span>
            </button>
          ))}
        </div>

        <div className="paneStatusRow">
          <span>{manifestStatus}</span>
          <button className="textButton" onClick={onRefreshManifest}>
            Refresh
          </button>
        </div>
      </aside>

      <section className="detailPane">
        {!selectedClip && <p className="status">Select a recording to view details.</p>}

        {selectedClip && (
          <>
            <header className="clipHeaderBar">
              <h2>{selectedClip.title}</h2>
              <span>{selectedClip.fileName}</span>
            </header>

            <div className="clipMetaRow">
              <span>{new Date(selectedClip.createdAtMs).toLocaleTimeString()}</span>
              <span>{formatClock(selectedClip.durationMs)}</span>
              <span>{selectedClip.categories.join(" • ") || "uncategorized"}</span>
            </div>

            <section className="wavePanel">
              <div className="waveBars" role="img" aria-label="Recording waveform preview">
                {waveformBars.map((value, index) => (
                  <span
                    key={`${selectedClip.id}-${index}`}
                    style={{
                      height: `${18 + value * 88}%`,
                      opacity: index / waveformBars.length <= safePlayheadMs / Math.max(selectedDurationMs, 1)
                        ? 1
                        : 0.5,
                    }}
                  />
                ))}
              </div>

              <div className="timelineRow">
                <span>{formatClock(safePlayheadMs)}</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(selectedDurationMs, 1)}
                  step={25}
                  value={safePlayheadMs}
                  onChange={event => onSetPlayheadMs(Number(event.target.value))}
                />
                <span>{formatClock(selectedDurationMs)}</span>
              </div>

              <div className="transportRow">
                <button className="iconButton" onClick={onSeekBackward}>
                  ◀◀
                </button>
                <button className="playButton" onClick={onToggleTimelinePlay}>
                  {isTimelinePlaying ? "Pause" : "Play"}
                </button>
                <button className="iconButton" onClick={onSeekForward}>
                  ▶▶
                </button>
              </div>
            </section>

            <section className="transcriptCard">
              <h3>Transcript</h3>
              <p>{selectedClip.transcript || "No transcript captured."}</p>
              <p className="status">{selectedClip.notes}</p>
            </section>
          </>
        )}

        <section className="panel subtlePanel">
          <h2>Quick Actions</h2>
          <div className="row">
            <button className="secondary" onClick={onRequestMicAccessAndRefresh}>
              Detect Microphones
            </button>
            <button className="secondary" onClick={onRefreshMicPermission}>
              Refresh Permission
            </button>
            <button className="secondary" onClick={onOpenSettings}>Open Settings</button>
          </div>
          <p className="status">Realtime: {realtimeStatus}</p>
          <p className="status">{micPermissionText}</p>
          {realtimeError.length > 0 && <p className="error">{realtimeError}</p>}
          <p className="resultBlock">{realtimeText || "(no realtime transcript yet)"}</p>
        </section>

        <section className="panel subtlePanel">
          <h2>Manual File Transcription</h2>
          <div className="grid2">
            <label className="field">
              <span>Audio File</span>
              <input
                type="file"
                accept="audio/*"
                onChange={event => onSelectFile(event.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          <button className="primary" onClick={onTranscribe} disabled={!canSubmit}>
            Transcribe File
          </button>

          <p className="status">Status: {status}</p>
          {attemptedEndpoint.length > 0 && <p className="status">Last endpoint: {attemptedEndpoint}</p>}
          {transcriptionError.length > 0 && <p className="error">{transcriptionError}</p>}
          <p>Parsed text: {transcriptionResult?.text || "(empty)"}</p>
          <p>Segments: {transcriptionResult?.segments.length ?? 0}</p>
        </section>
      </section>
    </section>
  );
}

function formatClock(durationMs: number): string {
  const totalMs = Math.max(0, Math.floor(durationMs));
  const totalSeconds = Math.floor(totalMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor((totalMs % 1000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(2, "0")}`;
}
