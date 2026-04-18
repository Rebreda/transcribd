import type { HomeStatusBarProps } from "./types";

export function HomeStatusBar(props: HomeStatusBarProps): JSX.Element {
  const { realtimeStatus, sentAudioChunks, receivedEvents, lastEventType, micPermissionText, realtimeError } = props;

  return (
    <nav className="bottomStatusBar" aria-label="Live transcription status">
      <span>Realtime: {realtimeStatus}</span>
      <span className="debugLine">sent={sentAudioChunks} recv={receivedEvents} event={lastEventType}</span>
      <span>{micPermissionText}</span>
      {realtimeError.length > 0 && <span className="error">{realtimeError}</span>}
    </nav>
  );
}
