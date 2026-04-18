import { useEffect, useRef, useState } from "react";
import { bytesToBase64, concatChunks, float32ToPcm16Bytes } from "../lib/audioCodec";
import type { RealtimeMessage } from "../lib/appTypes";
import { getBestEffortMicrophoneStream } from "../lib/microphone";
import { discoverRealtimeEndpoint, extractRealtimeText } from "../lib/realtime";

type UseRealtimeCaptureInput = {
  baseUrl: string;
  apiKey: string;
  model: string;
  selectedMicId: string;
  isAlwaysOnEnabled: boolean;
  onClipCaptured: (input: {
    pcm: Uint8Array;
    transcript: string;
    startedAtMs: number;
    endedAtMs: number;
    reason: "vad-stop" | "max-duration";
  }) => Promise<void>;
};

type UseRealtimeCaptureOutput = {
  realtimeStatus: string;
  realtimeText: string;
  realtimeError: string;
  isRunning: boolean;
  sentAudioChunks: number;
  receivedEvents: number;
  lastEventType: string;
  startRealtime: () => Promise<void>;
  stopRealtime: () => void;
  setRealtimeError: (value: string) => void;
};

const TARGET_SAMPLE_RATE = 16000;
const PRE_ROLL_MS = 1200;
const MAX_CLIP_SECONDS = 90;
const MIN_CLIP_BYTES = 3200;

export function useRealtimeCapture(input: UseRealtimeCaptureInput): UseRealtimeCaptureOutput {
  const { baseUrl, apiKey, model, selectedMicId, isAlwaysOnEnabled, onClipCaptured } = input;

  const [realtimeStatus, setRealtimeStatus] = useState("Idle");
  const [realtimeText, setRealtimeText] = useState("");
  const [realtimeError, setRealtimeError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [sentAudioChunks, setSentAudioChunks] = useState(0);
  const [receivedEvents, setReceivedEvents] = useState(0);
  const [lastEventType, setLastEventType] = useState("(none)");

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);

  const preRollChunksRef = useRef<Uint8Array[]>([]);
  const preRollBytesRef = useRef(0);
  const activeClipChunksRef = useRef<Uint8Array[]>([]);
  const activeClipBytesRef = useRef(0);
  const activeClipStartedMsRef = useRef(0);
  const activeClipTranscriptRef = useRef("");
  const speechActiveRef = useRef(false);
  const lastTextPieceRef = useRef("");
  const pendingCloseAfterCommitRef = useRef(false);
  const commitCloseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      stopRealtime();
    };
  }, []);

  async function startRealtime(): Promise<void> {
    if (wsRef.current) {
      setRealtimeError("Realtime session already running.");
      return;
    }

    setRealtimeError("");
    setRealtimeText("");
    setRealtimeStatus("Connecting...");
    setSentAudioChunks(0);
    setReceivedEvents(0);
    setLastEventType("(none)");

    const wsInfo = await discoverRealtimeEndpoint(baseUrl, apiKey.trim(), model.trim());
    if (!wsInfo.ok) {
      setRealtimeStatus("Failed");
      setRealtimeError(wsInfo.error);
      return;
    }

    const audioConstraints: MediaTrackConstraints = {
      channelCount: 1,
      noiseSuppression: true,
      echoCancellation: true,
    };
    if (selectedMicId.length > 0) {
      audioConstraints.deviceId = { exact: selectedMicId };
    }

    const stream = await getBestEffortMicrophoneStream(audioConstraints);
    if (!stream.ok) {
      setRealtimeStatus("Failed");
      setRealtimeError(stream.error);
      return;
    }

    mediaStreamRef.current = stream.value;

    const ws = new WebSocket(wsInfo.url);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsRunning(true);
      pendingCloseAfterCommitRef.current = false;
      setRealtimeStatus(isAlwaysOnEnabled ? "Connected (Always-On)" : "Connected");
      ws.send(
        JSON.stringify({
          type: "session.update",
          session: {
            model: model.trim(),
            input_audio_format: "pcm16",
            input_audio_transcription: {
              model: model.trim(),
            },
            turn_detection: {
              type: "server_vad",
              threshold: 0.45,
              silence_duration_ms: 500,
              prefix_padding_ms: 320,
            },
          },
        }),
      );

      setupRealtimeAudioPipeline(stream.value, ws);
    };

    ws.onmessage = event => {
      if (typeof event.data === "string") {
        try {
          const message = parseRealtimeFrame(event.data);
          handleRealtimeMessage(message);
        } catch {
          // Ignore non-JSON websocket frames.
        }
        return;
      }

      if (event.data instanceof Blob) {
        void event.data
          .text()
          .then(raw => {
            try {
              const message = parseRealtimeFrame(raw);
              handleRealtimeMessage(message);
            } catch {
              // Ignore non-JSON websocket frames.
            }
          })
          .catch(() => {
            // Ignore blob decode failures.
          });
        return;
      }

      if (event.data instanceof ArrayBuffer) {
        try {
          const raw = new TextDecoder().decode(event.data);
          const message = parseRealtimeFrame(raw);
          handleRealtimeMessage(message);
        } catch {
          // Ignore binary decode failures.
        }
      }
    };

    ws.onerror = () => {
      setRealtimeStatus("Error");
      setRealtimeError("Realtime websocket connection error.");
    };

    ws.onclose = () => {
      clearCommitCloseTimer();
      teardownRealtimeAudioPipeline();
      wsRef.current = null;
      setIsRunning(false);
      setRealtimeStatus("Stopped");
    };
  }

  function stopRealtime(): void {
    const ws = wsRef.current;
    if (!ws) {
      teardownRealtimeAudioPipeline();
      setRealtimeStatus("Idle");
      return;
    }

    teardownRealtimeAudioPipeline();

    if (ws.readyState !== WebSocket.OPEN) {
      ws.close();
      wsRef.current = null;
      setIsRunning(false);
      setRealtimeStatus("Stopped");
      return;
    }

    pendingCloseAfterCommitRef.current = true;
    setRealtimeStatus("Committing...");

    try {
      ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    } catch {
      ws.close();
      wsRef.current = null;
      setIsRunning(false);
      setRealtimeStatus("Stopped");
      return;
    }

    scheduleCloseAfterCommit(ws);
  }

  function scheduleCloseAfterCommit(ws: WebSocket): void {
    clearCommitCloseTimer();
    commitCloseTimerRef.current = window.setTimeout(() => {
      if (pendingCloseAfterCommitRef.current && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      pendingCloseAfterCommitRef.current = false;
      clearCommitCloseTimer();
    }, 30000);
  }

  function clearCommitCloseTimer(): void {
    if (commitCloseTimerRef.current !== null) {
      window.clearTimeout(commitCloseTimerRef.current);
      commitCloseTimerRef.current = null;
    }
  }

  function setupRealtimeAudioPipeline(stream: MediaStream, ws: WebSocket): void {
    const ctx = new AudioContext();
    audioContextRef.current = ctx;
    void ctx.resume();

    const source = ctx.createMediaStreamSource(stream);
    sourceNodeRef.current = source;

    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processorNodeRef.current = processor;

    processor.onaudioprocess = event => {
      if (ws.readyState !== WebSocket.OPEN) {
        return;
      }

      const inputBuffer = event.inputBuffer.getChannelData(0);
      const pcm16 = float32ToPcm16Bytes(inputBuffer, event.inputBuffer.sampleRate, TARGET_SAMPLE_RATE);
      if (pcm16.length === 0) {
        return;
      }

      pushPreRollChunk(pcm16);

      if (speechActiveRef.current) {
        activeClipChunksRef.current.push(pcm16);
        activeClipBytesRef.current += pcm16.byteLength;
        if (activeClipBytesRef.current > TARGET_SAMPLE_RATE * 2 * MAX_CLIP_SECONDS) {
          void finalizeActiveClip("max-duration");
        }
      }

      const base64 = bytesToBase64(pcm16);
      ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: base64 }));
      setSentAudioChunks(previous => previous + 1);
    };

    source.connect(processor);
    processor.connect(ctx.destination);
  }

  function teardownRealtimeAudioPipeline(): void {
    speechActiveRef.current = false;
    activeClipChunksRef.current = [];
    activeClipBytesRef.current = 0;
    activeClipTranscriptRef.current = "";

    if (processorNodeRef.current) {
      try {
        processorNodeRef.current.disconnect();
      } catch {
        // ignore
      }
      processorNodeRef.current.onaudioprocess = null;
      processorNodeRef.current = null;
    }

    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        // ignore
      }
      sourceNodeRef.current = null;
    }

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }

    preRollChunksRef.current = [];
    preRollBytesRef.current = 0;
  }

  function pushPreRollChunk(chunk: Uint8Array): void {
    const maxBytes = Math.floor((TARGET_SAMPLE_RATE * 2 * PRE_ROLL_MS) / 1000);
    preRollChunksRef.current.push(chunk);
    preRollBytesRef.current += chunk.byteLength;

    while (preRollBytesRef.current > maxBytes && preRollChunksRef.current.length > 0) {
      const removed = preRollChunksRef.current.shift();
      preRollBytesRef.current -= removed?.byteLength ?? 0;
    }
  }

  function handleRealtimeMessage(message: RealtimeMessage): void {
    setReceivedEvents(previous => previous + 1);
    setLastEventType(message.type || "(unknown)");

    const textPiece = extractRealtimeText(message);
    if (textPiece.length > 0) {
      if (textPiece !== lastTextPieceRef.current) {
        setRealtimeText(previous => (previous.length > 0 ? `${previous} ${textPiece}` : textPiece));
        lastTextPieceRef.current = textPiece;
      }
      if (speechActiveRef.current) {
        const current = activeClipTranscriptRef.current.trim();
        if (!current.endsWith(textPiece)) {
          activeClipTranscriptRef.current = `${current} ${textPiece}`.trim();
        }
      }
    }

    if (message.type === "input_audio_buffer.speech_started") {
      beginActiveClip();
      return;
    }

    if (message.type === "input_audio_buffer.speech_stopped") {
      if (isAlwaysOnEnabled) {
        void finalizeActiveClip("vad-stop");
      } else {
        speechActiveRef.current = false;
      }
      return;
    }

    if (
      pendingCloseAfterCommitRef.current
      && (
        message.type === "input_audio_buffer.committed"
        || message.type === "conversation.item.input_audio_transcription.completed"
      )
    ) {
      if (message.type === "input_audio_buffer.committed") {
        setRealtimeStatus("Transcribing...");
        return;
      }

      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      pendingCloseAfterCommitRef.current = false;
      clearCommitCloseTimer();
      return;
    }

    if (message.type === "error") {
      setRealtimeError(message.error?.message ?? "Unknown realtime error");
    }
  }

  function beginActiveClip(): void {
    speechActiveRef.current = true;
    activeClipStartedMsRef.current = Date.now();
    activeClipTranscriptRef.current = "";
    activeClipChunksRef.current = [...preRollChunksRef.current];
    activeClipBytesRef.current = activeClipChunksRef.current.reduce((total, chunk) => total + chunk.byteLength, 0);
  }

  async function finalizeActiveClip(reason: "vad-stop" | "max-duration"): Promise<void> {
    if (!speechActiveRef.current && reason !== "max-duration") {
      return;
    }

    speechActiveRef.current = false;
    const endedAtMs = Date.now();
    const startedAtMs = activeClipStartedMsRef.current || endedAtMs;
    const pcm = concatChunks(activeClipChunksRef.current);
    const transcript = activeClipTranscriptRef.current.trim();

    activeClipChunksRef.current = [];
    activeClipBytesRef.current = 0;
    activeClipTranscriptRef.current = "";

    if (pcm.byteLength < MIN_CLIP_BYTES || transcript.length === 0) {
      return;
    }

    await onClipCaptured({
      pcm,
      transcript,
      startedAtMs,
      endedAtMs,
      reason,
    });
  }

  return {
    realtimeStatus,
    realtimeText,
    realtimeError,
    isRunning,
    sentAudioChunks,
    receivedEvents,
    lastEventType,
    startRealtime,
    stopRealtime,
    setRealtimeError,
  };
}

function parseRealtimeFrame(raw: string): RealtimeMessage {
  const trimmed = raw.trim();
  if (trimmed.startsWith("data:")) {
    const dataPayload = trimmed
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trim())
      .join("\n");
    return JSON.parse(dataPayload) as RealtimeMessage;
  }

  return JSON.parse(trimmed) as RealtimeMessage;
}
