import { useState } from "react";
import type { Artifact, ClipSort, ManifestClip, RealtimeTranscriptRecord } from "../lib/appTypes";
import type { RealtimeLogEntry } from "../hooks/useRealtimeCapture";
type HomePageProps = {
  isAlwaysOnEnabled: boolean;
  isRealtimeRunning: boolean;
  onToggleRealtime: () => void;

  clipSearch: string;
  onChangeClipSearch: (value: string) => void;
  clipCategoryFilter: string;
  onChangeClipCategoryFilter: (value: string) => void;
  clipSort: ClipSort;
  onChangeClipSort: (value: ClipSort) => void;
  clipCategories: string[];
  /** Sidebar list — already filtered + sorted by App.tsx. */
  artifacts: Artifact[];
  selectedArtifact: Artifact | null;
  selectedArtifactId: string | null;
  onSelectArtifact: (artifactId: string | null) => void;

  /** Kept for the audio waveform / timeline when the selected record has a saved file. */
  selectedClip: ManifestClip | null;
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

  realtimeStatus: string;
  realtimeCurrentRecord: RealtimeTranscriptRecord | null;
  micPermissionText: string;
  realtimeError: string;
  realtimeText: string;
  audioLevelBars: number[];
  sentAudioChunks: number;
  receivedEvents: number;
  lastEventType: string;
  realtimeLog: RealtimeLogEntry[];
};

export function HomePage(props: HomePageProps): JSX.Element {
  const {
    isAlwaysOnEnabled,
    isRealtimeRunning,
    onToggleRealtime,
    clipSearch,
    onChangeClipSearch,
    clipCategoryFilter,
    onChangeClipCategoryFilter,
    clipSort,
    onChangeClipSort,
    clipCategories,
    artifacts,
    selectedArtifact,
    selectedArtifactId,
    onSelectArtifact,
    selectedClip,
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
    realtimeStatus,
    realtimeCurrentRecord,
    micPermissionText,
    realtimeError,
    realtimeText,
    audioLevelBars,
    sentAudioChunks,
    receivedEvents,
    lastEventType,
    realtimeLog,
  } = props;

  return (
    <section className="studioLayout">
      <aside className="recordingsPane">
        <div className="recordingsToolbar">
          <button className="recordAction" onClick={onToggleRealtime}>
            {isRealtimeRunning
              ? "Pause"
              : isAlwaysOnEnabled
                ? "Listening"
                : "Enable Live"}
          </button>
        </div>

        <label className="field">
          <span>Filter</span>
          <input
            value={clipSearch}
            onChange={(event) => onChangeClipSearch(event.target.value)}
            placeholder="Filter by category, text, title..."
          />
        </label>

        <div className="finderControls compact">
          <label className="field">
            <span>Category</span>
            <select
              value={clipCategoryFilter}
              onChange={(event) =>
                onChangeClipCategoryFilter(event.target.value)
              }
            >
              <option value="all">All Dates</option>
              {clipCategories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Sort</span>
            <select
              value={clipSort}
              onChange={(event) =>
                onChangeClipSort(event.target.value as ClipSort)
              }
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="title">Title A-Z</option>
            </select>
          </label>
        </div>

        <div className="clipListCompact listMode">
          {artifacts.length === 0 && (
            <p className="status">
              {clipSearch.trim().length > 0 || clipCategoryFilter !== "all"
                ? "No recordings match the current filter."
                : "No recordings yet. Enable live listening to start."}
            </p>
          )}
          {artifacts.map((artifact) => (
            <button
              key={artifact.id}
              className={`clipItemButton ${selectedArtifactId === artifact.id ? "active" : ""}`}
              onClick={() => {
                onSelectArtifact(artifact.id);
              }}
            >
              <strong>{artifact.title}</strong>
              <span>
                {new Date(artifact.updatedAtMs).toLocaleTimeString()}
                {artifact.hasAudioFile ? " • saved" : ""}
              </span>
              <span>{artifact.categories.join(" • ") || "uncategorized"}</span>
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
        <section className="livePanel">
          <header className="livePanelHeader">
            <div>
              <h2>Live Transcription</h2>
              <p>
                {isRealtimeRunning
                  ? "Always-on transcription is active. Speech clips are auto-saved to disk and indexed below."
                  : "Enable live listening to continuously transcribe and auto-save searchable clips."}
              </p>
            </div>
            <div className={`liveDot ${isRealtimeRunning ? "active" : ""}`} />
          </header>

          <div
            className="liveBars"
            role="img"
            aria-label="Realtime microphone level visualization"
          >
            {audioLevelBars.map((value, index) => (
              <span
                key={`live-bar-${index}`}
                style={{ height: `${10 + value * 90}%` }}
              />
            ))}
          </div>

          <div className="liveTranscriptFeed">
            <div className="liveRecordCard liveRecordCardCurrent">
              <header>
                <strong>Current turn</strong>
                <span>{isRealtimeRunning ? "live" : "idle"}</span>
              </header>
              <p>{realtimeCurrentRecord?.text || realtimeText || "Waiting for speech input..."}</p>
            </div>
          </div>
        </section>

        {!selectedArtifact && (
          <p className="status">Select a recording to view details.</p>
        )}

        {selectedArtifact && (
          <>
            <header className="clipHeaderBar">
              <h2>{selectedArtifact.title}</h2>
              <span>
                {selectedArtifact.hasAudioFile ? (selectedClip?.fileName ?? "saved") : selectedArtifact.inferenceState}
              </span>
            </header>

            <div className="clipMetaRow">
              <span>{new Date(selectedArtifact.updatedAtMs).toLocaleTimeString()}</span>
              {selectedClip && <span>{formatClock(selectedClip.durationMs)}</span>}
              <span>{selectedArtifact.categories.join(" • ") || "uncategorized"}</span>
            </div>

            {selectedClip && (
              <section className="wavePanel">
                <div
                  className="waveBars"
                  role="img"
                  aria-label="Recording waveform preview"
                >
                  {waveformBars.map((value, index) => (
                    <span
                      key={`${selectedClip.id}-${index}`}
                      style={{
                        height: `${18 + value * 88}%`,
                        opacity:
                          index / waveformBars.length <=
                          safePlayheadMs / Math.max(selectedDurationMs, 1)
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
                    onChange={(event) =>
                      onSetPlayheadMs(Number(event.target.value))
                    }
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
            )}

            <section className="transcriptCard">
              <h3>Transcript</h3>
              <p>{selectedArtifact.text || "No transcript captured."}</p>
              <p className="status">{selectedArtifact.notes}</p>
            </section>
          </>
        )}

      </section>

      <nav className="bottomStatusBar" aria-label="Live transcription status">
        <span>Realtime: {realtimeStatus}</span>
        <span className="debugLine">sent={sentAudioChunks} recv={receivedEvents} event={lastEventType}</span>
        <span>{micPermissionText}</span>
        {realtimeError.length > 0 && <span className="error">{realtimeError}</span>}
        <RealtimeEventLog entries={realtimeLog} />
      </nav>
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

function RealtimeEventLog({ entries }: { entries: RealtimeLogEntry[] }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="realtimeLogToggle">
      <button className="textButton" onClick={() => setOpen(prev => !prev)}>
        {open ? "Hide log" : `Events (${entries.length})`}
      </button>
      {open && (
        <div className="realtimeLogPanel">
          {entries.length === 0 && <span className="status">No events yet.</span>}
          {entries.map(entry => (
            <div key={entry.ts} className="realtimeLogRow">
              <span className="logType">{entry.type}</span>
              {entry.text.length > 0 && <span className="logText">&ldquo;{entry.text}&rdquo;</span>}
              <span className="logRaw">{entry.raw}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
