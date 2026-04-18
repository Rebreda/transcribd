import type { LivePanelProps } from "./types";

export function LivePanel(props: LivePanelProps): JSX.Element {
  const {
    isRealtimeRunning,
    realtimeRecords,
    realtimeCurrentRecord,
    realtimeText,
    audioLevelBars,
    onOpenRecordClip,
  } = props;

  return (
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

      <div className="liveBars" role="img" aria-label="Realtime microphone level visualization">
        {audioLevelBars.map((value, index) => (
          <span key={`live-bar-${index}`} style={{ height: `${10 + value * 90}%` }} />
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

        {realtimeRecords.length === 0 && <p className="status">No live records match the current filter.</p>}

        {realtimeRecords.map(record => (
          <article key={record.id} className="liveRecordCard">
            <header>
              <strong>{record.title}</strong>
              <span>{new Date(record.updatedAtMs).toLocaleTimeString()}</span>
            </header>
            <p>{record.text}</p>
            <footer>
              <span>{record.categories.join(" • ") || "uncategorized"}</span>
              <span>{record.hasAudioFile ? "saved clip" : record.inferenceState === "pending" ? "inferring" : "no audio file"}</span>
            </footer>
            <p className="status">{record.notes}</p>
            {record.clipId && (
              <button className="textButton" onClick={() => onOpenRecordClip(record.clipId!)}>
                Open Clip
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
