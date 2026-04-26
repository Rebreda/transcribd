import type { Artifact, ClipSort, ManifestClip } from "../lib/appTypes";

type HomePageProps = {
  clipSearch: string;
  onChangeClipSearch: (value: string) => void;
  clipCategoryFilter: string;
  onChangeClipCategoryFilter: (value: string) => void;
  clipSort: ClipSort;
  onChangeClipSort: (value: ClipSort) => void;
  clipCategories: string[];
  artifacts: Artifact[];
  selectedArtifact: Artifact | null;
  selectedArtifactId: string | null;
  onSelectArtifact: (artifactId: string | null) => void;

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
};

export function HomePage(props: HomePageProps): JSX.Element {
  const {
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
  } = props;

  return (
    <section className="studioLayout">
      <aside className="recordingsPane">
        <label className="field">
          <span>Filter</span>
          <input
            value={clipSearch}
            onChange={event => onChangeClipSearch(event.target.value)}
            placeholder="Filter by category, text, title…"
          />
        </label>

        <div className="finderControls compact">
          <label className="field">
            <span>Category</span>
            <select
              value={clipCategoryFilter}
              onChange={event => onChangeClipCategoryFilter(event.target.value)}
            >
              <option value="all">All</option>
              {clipCategories.map(category => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Sort</span>
            <select
              value={clipSort}
              onChange={event => onChangeClipSort(event.target.value as ClipSort)}
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="title">Title A–Z</option>
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
          {artifacts.map(artifact => (
            <button
              key={artifact.id}
              className={`clipItemButton ${selectedArtifactId === artifact.id ? "active" : ""}`}
              onClick={() => onSelectArtifact(artifact.id)}
            >
              <strong>{artifact.title}</strong>
              <span>
                {new Date(artifact.updatedAtMs).toLocaleTimeString()}
                {artifact.hasAudioFile ? " · saved" : ""}
                {artifact.categories.length > 0 ? ` · ${artifact.categories.join(", ")}` : ""}
              </span>
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
              <span>{selectedArtifact.categories.join(" · ") || "uncategorized"}</span>
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
                    onChange={event => onSetPlayheadMs(Number(event.target.value))}
                  />
                  <span>{formatClock(selectedDurationMs)}</span>
                </div>

                <div className="transportRow">
                  <button className="iconButton" onClick={onSeekBackward}>◀◀</button>
                  <button className="playButton" onClick={onToggleTimelinePlay}>
                    {isTimelinePlaying ? "Pause" : "Play"}
                  </button>
                  <button className="iconButton" onClick={onSeekForward}>▶▶</button>
                </div>
              </section>
            )}

            <section className="transcriptCard">
              <h3>Transcript</h3>
              <p>{selectedArtifact.text || "No transcript captured."}</p>
              {selectedArtifact.notes && (
                <p className="status">{selectedArtifact.notes}</p>
              )}
            </section>
          </>
        )}
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
