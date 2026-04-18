import type { ClipSort, ManifestClip, RealtimeObjectRecord, RealtimeTranscriptRecord } from "../../lib/appTypes";

export type RecordingsPaneProps = {
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
  filteredClips: ManifestClip[];
  selectedClipId: string | null;
  onSelectClip: (clipId: string) => void;
  manifestStatus: string;
  onRefreshManifest: () => void;
};

export type LivePanelProps = {
  isRealtimeRunning: boolean;
  realtimeRecords: RealtimeObjectRecord[];
  realtimeCurrentRecord: RealtimeTranscriptRecord | null;
  realtimeText: string;
  audioLevelBars: number[];
  onOpenRecordClip: (clipId: string) => void;
};

export type ClipDetailPanelProps = {
  selectedClip: ManifestClip | null;
  waveformBars: number[];
  safePlayheadMs: number;
  selectedDurationMs: number;
  onSetPlayheadMs: (value: number) => void;
  isTimelinePlaying: boolean;
  onToggleTimelinePlay: () => void;
  onSeekBackward: () => void;
  onSeekForward: () => void;
};

export type HomeStatusBarProps = {
  realtimeStatus: string;
  sentAudioChunks: number;
  receivedEvents: number;
  lastEventType: string;
  micPermissionText: string;
  realtimeError: string;
};
