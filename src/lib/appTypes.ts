export type ManifestClip = {
  id: string;
  fileName: string;
  createdAtMs: number;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  sampleRate: number;
  channels: number;
  transcript: string;
  title: string;
  notes: string;
  categories: string[];
};

export type Manifest = {
  version: number;
  updatedAtMs: number;
  clips: ManifestClip[];
};

export type RealtimeMessage = {
  type: string;
  event_id?: string;
  item_id?: string;
  content_index?: number;
  transcript?: string;
  delta?: string;
  item?: {
    id?: string;
    transcript?: string;
    text?: string;
    delta?: string;
    content?: Array<{
      transcript?: string;
      text?: string;
      delta?: string;
    }>;
  };
  data?: {
    transcript?: string;
    text?: string;
    delta?: string;
  };
  error?: {
    message?: string;
  };
};

export type RealtimeEndpointResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export type RealtimeTranscriptRecord = {
  id: string;
  itemId: string;
  text: string;
  isFinal: boolean;
  updatedAtMs: number;
};

export type RealtimeObjectRecord = {
  id: string;
  itemId: string;
  text: string;
  updatedAtMs: number;
  title: string;
  notes: string;
  categories: string[];
  inferenceState: "pending" | "ready" | "error" | "from-clip";
  hasAudioFile: boolean;
  clipId: string | null;
};

export type ClipMetadata = {
  title: string;
  notes: string;
  categories: string[];
};

export type AudioInputDevice = {
  id: string;
  label: string;
};

export type ClipSort = "newest" | "oldest" | "title";
export type AppPage = "home" | "upload" | "settings";
export type MicPermission = "unknown" | "granted" | "denied" | "prompt";
