import { useEffect, useState } from "react";

type TimelinePlayback = {
  playheadMs: number;
  safePlayheadMs: number;
  isPlaying: boolean;
  setPlayheadMs: (value: number) => void;
  togglePlay: () => void;
  seekByMs: (deltaMs: number) => void;
};

export function useTimelinePlayback(selectedClipId: string, durationMs: number): TimelinePlayback {
  const [playheadMs, setPlayheadMsState] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const safePlayheadMs = Math.min(Math.max(playheadMs, 0), durationMs);

  useEffect(() => {
    setPlayheadMsState(0);
    setIsPlaying(false);
  }, [selectedClipId]);

  useEffect(() => {
    if (!isPlaying || durationMs <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setPlayheadMsState(previous => {
        const next = previous + 125;
        if (next >= durationMs) {
          setIsPlaying(false);
          return durationMs;
        }
        return next;
      });
    }, 125);

    return () => {
      window.clearInterval(timer);
    };
  }, [isPlaying, durationMs]);

  function setPlayheadMs(value: number): void {
    setPlayheadMsState(value);
  }

  function togglePlay(): void {
    if (durationMs <= 0) {
      return;
    }
    setIsPlaying(previous => !previous);
  }

  function seekByMs(deltaMs: number): void {
    setPlayheadMsState(previous => Math.min(durationMs, Math.max(0, previous + deltaMs)));
  }

  return {
    playheadMs,
    safePlayheadMs,
    isPlaying,
    setPlayheadMs,
    togglePlay,
    seekByMs,
  };
}
