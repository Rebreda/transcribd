import { useEffect, useRef, useState } from "react";

type TimelinePlayback = {
  playheadMs: number;
  safePlayheadMs: number;
  isPlaying: boolean;
  setPlayheadMs: (value: number) => void;
  togglePlay: () => void;
  seekByMs: (deltaMs: number) => void;
};

export function useTimelinePlayback(selectedClipId: string, durationMs: number, audioUrl?: string): TimelinePlayback {
  const [playheadMs, setPlayheadMsState] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const safePlayheadMs = Math.min(Math.max(playheadMs, 0), durationMs);

  // Reset when clip changes.
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setPlayheadMsState(0);
    setIsPlaying(false);
  }, [selectedClipId]);

  // Wire up a real audio element when we have a URL.
  useEffect(() => {
    if (!audioUrl) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
      audioRef.current = null;
      return;
    }

    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    const onTimeUpdate = (): void => {
      setPlayheadMsState(Math.floor(audio.currentTime * 1000));
    };
    const onEnded = (): void => {
      setIsPlaying(false);
      setPlayheadMsState(durationMs);
    };
    const onPlay = (): void => setIsPlaying(true);
    const onPause = (): void => setIsPlaying(false);

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.src = "";
    };
  }, [audioUrl, durationMs]);

  // Timer-based fallback when there is no audio URL.
  useEffect(() => {
    if (audioUrl || !isPlaying || durationMs <= 0) {
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
  }, [isPlaying, durationMs, audioUrl]);

  function setPlayheadMs(value: number): void {
    setPlayheadMsState(value);
    if (audioRef.current) {
      audioRef.current.currentTime = value / 1000;
    }
  }

  function togglePlay(): void {
    if (durationMs <= 0) {
      return;
    }
    if (audioRef.current) {
      if (audioRef.current.paused) {
        void audioRef.current.play();
      } else {
        audioRef.current.pause();
      }
    } else {
      setIsPlaying(previous => !previous);
    }
  }

  function seekByMs(deltaMs: number): void {
    const newMs = Math.min(durationMs, Math.max(0, playheadMs + deltaMs));
    setPlayheadMsState(newMs);
    if (audioRef.current) {
      audioRef.current.currentTime = newMs / 1000;
    }
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
