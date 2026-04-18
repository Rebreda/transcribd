import type { TranscriptionResult } from "../lib/transcriptionParsing";

type UploadPageProps = {
  onSelectFile: (file: File | null) => void;
  canSubmit: boolean;
  onTranscribe: () => void;
  status: string;
  attemptedEndpoint: string;
  transcriptionError: string;
  transcriptionResult: TranscriptionResult | null;
};

export function UploadPage(props: UploadPageProps): JSX.Element {
  const {
    onSelectFile,
    canSubmit,
    onTranscribe,
    status,
    attemptedEndpoint,
    transcriptionError,
    transcriptionResult,
  } = props;

  return (
    <section className="uploadPage">
      <header className="hero uploadHero">
        <h2>File Transcription</h2>
        <p>Upload an audio file and run a direct Lemonade transcription request.</p>
      </header>

      <section className="panel uploadPanel">
        <div className="uploadDropZone">
          <h3>Choose audio input</h3>
          <p>Use this for one-off files. Always-on live capture stays on the Home page.</p>
          <input
            type="file"
            accept="audio/*"
            onChange={event => onSelectFile(event.target.files?.[0] ?? null)}
          />
          <button className="primary" onClick={onTranscribe} disabled={!canSubmit}>
            Transcribe File
          </button>
        </div>

        <div className="uploadResults">
          <h3>Results</h3>
          <p className="status">Status: {status}</p>
          {attemptedEndpoint.length > 0 && <p className="status">Endpoint: {attemptedEndpoint}</p>}
          {transcriptionError.length > 0 && <p className="error">{transcriptionError}</p>}
          <div className="resultBlock uploadResultBlock">{transcriptionResult?.text || "No transcript yet."}</div>
          <p className="status">Segments: {transcriptionResult?.segments.length ?? 0}</p>
        </div>
      </section>
    </section>
  );
}
