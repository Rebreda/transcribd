import { useState } from "react";
import type { RealtimeLogEntry } from "../hooks/useRealtimeCapture";

type LiveBarProps = {
  isRunning: boolean;
  onToggle: () => void;
  realtimeText: string;
  audioLevelBars: number[];
  realtimeStatus: string;
  realtimeError: string;
  realtimeLog: RealtimeLogEntry[];
  sentAudioChunks: number;
  receivedEvents: number;
  lastEventType: string;
};

export function LiveBar(props: LiveBarProps): JSX.Element {
  const {
    isRunning,
    onToggle,
    realtimeText,
    audioLevelBars,
    realtimeStatus,
    realtimeError,
    realtimeLog,
    sentAudioChunks,
    receivedEvents,
    lastEventType,
  } = props;

  const displayText = realtimeText.trim()
    || (isRunning ? "Listening for speech…" : "Start live transcription to capture audio");

  return (
    <div className="liveBar">
      <div className={`liveDot ${isRunning ? "active" : ""}`} />

      <div className="liveBarBars" aria-hidden="true">
        {audioLevelBars.slice(0, 14).map((value, index) => (
          <span key={index} style={{ height: `${15 + value * 85}%` }} />
        ))}
      </div>

      <span className={`liveBarText ${realtimeText.trim() ? "active" : ""}`}>
        {displayText}
      </span>

      <span className="liveBarStatus">{realtimeStatus}</span>

      {realtimeError.length > 0 && (
        <span className="liveBarError">{realtimeError}</span>
      )}

      <button className="liveBarToggle" onClick={onToggle}>
        {isRunning ? "Stop" : "Start"}
      </button>

      <RealtimeEventLog
        entries={realtimeLog}
        sentAudioChunks={sentAudioChunks}
        receivedEvents={receivedEvents}
        lastEventType={lastEventType}
      />
    </div>
  );
}

function RealtimeEventLog({
  entries,
  sentAudioChunks,
  receivedEvents,
  lastEventType,
}: {
  entries: RealtimeLogEntry[];
  sentAudioChunks: number;
  receivedEvents: number;
  lastEventType: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="realtimeLogToggle">
      <button className="textButton" onClick={() => setOpen(prev => !prev)}>
        {open ? "Hide" : `Debug (${entries.length})`}
      </button>
      {open && (
        <div className="realtimeLogPanel">
          <div className="debugLine" style={{ marginBottom: "0.3rem" }}>
            sent={sentAudioChunks} recv={receivedEvents} event={lastEventType}
          </div>
          {entries.length === 0 && <span className="status">No events yet.</span>}
          {entries.map(entry => (
            <div key={entry.ts} className="realtimeLogRow">
              <span className="logType">{entry.type}</span>
              {entry.text.length > 0 && (
                <span className="logText">&ldquo;{entry.text}&rdquo;</span>
              )}
              <span className="logRaw">{entry.raw}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
