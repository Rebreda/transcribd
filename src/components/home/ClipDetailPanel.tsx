import type { ClipDetailPanelProps } from "./types";
import { formatClock } from "./formatClock";

export function ClipDetailPanel(props: ClipDetailPanelProps): JSX.Element {
  const {
    selectedClip,
    waveformBars,
    safePlayheadMs,
    selectedDurationMs,
    onSetPlayheadMs,
    isTimelinePlaying,
    onToggleTimelinePlay,
    onSeekBackward,
    onSeekForward,
  } = props;

  if (!selectedClip) {
    return <p className="status">Select a recording to view details.</p>;
  }

  return (
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
                opacity: index / waveformBars.length <= safePlayheadMs / Math.max(selectedDurationMs, 1) ? 1 : 0.5,
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
  );
}
