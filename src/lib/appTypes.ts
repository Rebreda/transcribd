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
  transcript?: string;
  delta?: string;
  item?: {
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
