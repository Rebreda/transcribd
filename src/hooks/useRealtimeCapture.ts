import { useEffect, useRef, useState } from "react";
import { bytesToBase64, concatChunks, float32ToPcm16Bytes } from "../lib/audioCodec";
import type { RealtimeMessage, RealtimeTranscriptRecord } from "../lib/appTypes";
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

export type RealtimeLogEntry = {
  ts: number;
  type: string;
  text: string;
  raw: string;
};

type UseRealtimeCaptureOutput = {
  realtimeStatus: string;
  realtimeText: string;
  realtimeRecords: RealtimeTranscriptRecord[];
  realtimeCurrentRecord: RealtimeTranscriptRecord | null;
  realtimeError: string;
  isRunning: boolean;
  liveAudioLevel: number;
  audioLevelBars: number[];
  sentAudioChunks: number;
  receivedEvents: number;
  lastEventType: string;
  realtimeLog: RealtimeLogEntry[];
  startRealtime: () => Promise<void>;
  stopRealtime: () => void;
  setRealtimeError: (value: string) => void;
};

const TARGET_SAMPLE_RATE = 16000;
const PRE_ROLL_MS = 1200;
const MAX_CLIP_SECONDS = 90;
const MIN_CLIP_BYTES = 3200;

type PendingSegment = {
  pcm: Uint8Array;
  startedAtMs: number;
  endedAtMs: number;
  reason: "vad-stop" | "max-duration";
};

export function useRealtimeCapture(input: UseRealtimeCaptureInput): UseRealtimeCaptureOutput {
  const { baseUrl, apiKey, model, selectedMicId, isAlwaysOnEnabled, onClipCaptured } = input;

  const [realtimeStatus, setRealtimeStatus] = useState("Idle");
  const [realtimeText, setRealtimeText] = useState("");
  const [realtimeRecords, setRealtimeRecords] = useState<RealtimeTranscriptRecord[]>([]);
  const [realtimeCurrentRecord, setRealtimeCurrentRecord] = useState<RealtimeTranscriptRecord | null>(null);
  const [realtimeError, setRealtimeError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [liveAudioLevel, setLiveAudioLevel] = useState(0);
  const [audioLevelBars, setAudioLevelBars] = useState<number[]>(() => Array.from({ length: 48 }, () => 0));
  const [sentAudioChunks, setSentAudioChunks] = useState(0);
  const [receivedEvents, setReceivedEvents] = useState(0);
  const [lastEventType, setLastEventType] = useState("(none)");
  const [realtimeLog, setRealtimeLog] = useState<RealtimeLogEntry[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);

  const preRollChunksRef = useRef<Uint8Array[]>([]);
  const preRollBytesRef = useRef(0);
  const segmentChunksRef = useRef<Uint8Array[]>([]);
  const segmentBytesRef = useRef(0);
  const segmentStartedMsRef = useRef(0);
  const activeClipChunksRef = useRef<Uint8Array[]>([]);
  const activeClipBytesRef = useRef(0);
  const activeClipStartedMsRef = useRef(0);
  const activeClipTranscriptRef = useRef("");
  const activeClipItemIdRef = useRef("");
  const speechActiveRef = useRef(false);
  const currentInterimItemIdRef = useRef("");
  const currentInterimTextRef = useRef("");
  const pendingSegmentsRef = useRef<Map<string, PendingSegment>>(new Map());
  const fallbackPendingSegmentRef = useRef<PendingSegment | null>(null);
  const smoothedLevelRef = useRef(0);
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
    setRealtimeRecords([]);
    setRealtimeCurrentRecord(null);
    setRealtimeStatus("Connecting...");
    setLiveAudioLevel(0);
    setAudioLevelBars(Array.from({ length: 48 }, () => 0));
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
      // Lemonade transcribes by default — no input_audio_transcription needed.
      // Keep turn_detection minimal: let the server apply its own VAD defaults,
      // only override silence timing for a reasonable capture window.
      ws.send(
        JSON.stringify({
          type: "session.update",
          session: {
            model: model.trim(),
            turn_detection: {
              threshold: 0.05,
              silence_duration_ms: 1200,
              prefix_padding_ms: 300,
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
          handleRealtimeMessage(message, event.data);
        } catch {
          console.warn("[realtime] non-JSON frame:", event.data.slice(0, 200));
        }
        return;
      }

      if (event.data instanceof Blob) {
        void event.data
          .text()
          .then(raw => {
            try {
              const message = parseRealtimeFrame(raw);
              handleRealtimeMessage(message, raw);
            } catch {
              console.warn("[realtime] non-JSON blob:", raw.slice(0, 200));
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
          handleRealtimeMessage(message, raw);
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

    teardownRealtimeAudioInput();

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
      const rms = calculateRms(inputBuffer);
      const smoothed = smoothedLevelRef.current * 0.75 + rms * 0.25;
      smoothedLevelRef.current = smoothed;
      setLiveAudioLevel(smoothed);
      setAudioLevelBars(previous => {
        const next = [...previous.slice(1), Math.min(1, smoothed * 5)];
        return next;
      });

      const pcm16 = float32ToPcm16Bytes(inputBuffer, event.inputBuffer.sampleRate, TARGET_SAMPLE_RATE);
      if (pcm16.length === 0) {
        return;
      }

      pushPreRollChunk(pcm16);
      pushSegmentChunk(pcm16);

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

  function teardownRealtimeAudioInput(): void {
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

    smoothedLevelRef.current = 0;
    setLiveAudioLevel(0);
    setAudioLevelBars(Array.from({ length: 48 }, () => 0));
  }

  function teardownRealtimeAudioPipeline(): void {
    teardownRealtimeAudioInput();

    speechActiveRef.current = false;
    activeClipChunksRef.current = [];
    activeClipBytesRef.current = 0;
    activeClipTranscriptRef.current = "";
    activeClipItemIdRef.current = "";
    currentInterimItemIdRef.current = "";
    currentInterimTextRef.current = "";
    setRealtimeCurrentRecord(null);
    pendingSegmentsRef.current.clear();
    fallbackPendingSegmentRef.current = null;

    preRollChunksRef.current = [];
    preRollBytesRef.current = 0;
    segmentChunksRef.current = [];
    segmentBytesRef.current = 0;
    segmentStartedMsRef.current = 0;
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

  function pushSegmentChunk(chunk: Uint8Array): void {
    if (segmentStartedMsRef.current === 0) {
      segmentStartedMsRef.current = Date.now();
    }

    segmentChunksRef.current.push(chunk);
    segmentBytesRef.current += chunk.byteLength;

    const maxBytes = TARGET_SAMPLE_RATE * 2 * MAX_CLIP_SECONDS;
    while (segmentBytesRef.current > maxBytes && segmentChunksRef.current.length > 0) {
      const removed = segmentChunksRef.current.shift();
      segmentBytesRef.current -= removed?.byteLength ?? 0;
      if (segmentStartedMsRef.current !== 0) {
        segmentStartedMsRef.current += Math.round(((removed?.byteLength ?? 0) / (TARGET_SAMPLE_RATE * 2)) * 1000);
      }
    }
  }

  function handleRealtimeMessage(message: RealtimeMessage, raw: string): void {
    setReceivedEvents(previous => previous + 1);
    setLastEventType(message.type || "(unknown)");

    const textPiece = extractRealtimeText(message);

    const entry: RealtimeLogEntry = {
      ts: Date.now(),
      type: message.type || "(unknown)",
      text: textPiece,
      raw: raw.length > 400 ? `${raw.slice(0, 400)}…` : raw,
    };
    console.log("[realtime]", entry.type, textPiece ? `text=${JSON.stringify(textPiece)}` : "", JSON.parse(raw));
    setRealtimeLog(prev => [entry, ...prev].slice(0, 80));

    if (message.type === "conversation.item.input_audio_transcription.delta") {
      const itemId = message.item_id ?? message.item?.id ?? "";
      const interimText = textPiece;
      if (interimText.length > 0) {
        currentInterimItemIdRef.current = itemId;
        currentInterimTextRef.current = interimText;
        setRealtimeText(interimText);
        setRealtimeCurrentRecord({
          id: itemId.length > 0 ? `interim-${itemId}` : `interim-${Date.now()}`,
          itemId,
          text: interimText,
          isFinal: false,
          updatedAtMs: Date.now(),
        });
        if (speechActiveRef.current) {
          activeClipTranscriptRef.current = mergeTranscriptText(activeClipTranscriptRef.current, interimText);
        }
      }
    }

    // Broad fallback for servers that use non-standard event types with a text/transcript/delta payload.
    const isKnownEvent =
      message.type === "conversation.item.input_audio_transcription.delta"
      || message.type === "conversation.item.input_audio_transcription.completed"
      || message.type === "input_audio_buffer.speech_started"
      || message.type === "input_audio_buffer.speech_stopped"
      || message.type === "input_audio_buffer.committed"
      || message.type === "error";

    if (!isKnownEvent && textPiece.length > 0) {
      const typeHint = message.type.toLowerCase();
      const isFinalHint = typeHint.includes("completed") || typeHint.includes("final") || typeHint.includes("result");
      const itemId = message.item_id ?? message.item?.id ?? "";
      if (isFinalHint) {
        const now = Date.now();
        const recordId = itemId.length > 0 ? `final-${itemId}` : `final-${now}`;
        setRealtimeRecords(previous =>
          [{ id: recordId, itemId, text: textPiece, isFinal: true, updatedAtMs: now }, ...previous].slice(0, 120)
        );
        activeClipTranscriptRef.current = mergeTranscriptText(activeClipTranscriptRef.current, textPiece);
        setRealtimeText("");
        setRealtimeCurrentRecord(null);
        void finalizeCompletedSegment(itemId, textPiece);
      } else {
        // Treat as in-progress interim text.
        setRealtimeText(textPiece);
        setRealtimeCurrentRecord({
          id: itemId.length > 0 ? `interim-${itemId}` : `interim-${Date.now()}`,
          itemId,
          text: textPiece,
          isFinal: false,
          updatedAtMs: Date.now(),
        });
        if (speechActiveRef.current) {
          activeClipTranscriptRef.current = mergeTranscriptText(activeClipTranscriptRef.current, textPiece);
        }
      }
    }

    if (message.type === "conversation.item.input_audio_transcription.completed") {
      const transcript = textPiece || "";
      if (transcript.length > 0) {
        const itemId = message.item_id ?? message.item?.id ?? "";
        if (itemId.length === 0 || itemId === currentInterimItemIdRef.current) {
          currentInterimItemIdRef.current = "";
          currentInterimTextRef.current = "";
          setRealtimeText("");
          setRealtimeCurrentRecord(null);
        }
        activeClipTranscriptRef.current = mergeTranscriptText(activeClipTranscriptRef.current, transcript);
        const now = Date.now();
        const recordId = itemId.length > 0 ? `final-${itemId}` : `final-${now}`;
        setRealtimeRecords(previous => [{
          id: recordId,
          itemId,
          text: transcript,
          isFinal: true,
          updatedAtMs: now,
        }, ...previous].slice(0, 120));
        void finalizeCompletedSegment(itemId, transcript);
      }
    }

    if (message.type === "input_audio_buffer.speech_started") {
      currentInterimItemIdRef.current = "";
      currentInterimTextRef.current = "";
      setRealtimeText("");
      setRealtimeCurrentRecord(null);
      beginActiveClip(message.item_id ?? message.item?.id ?? "");
      return;
    }

    if (message.type === "input_audio_buffer.speech_stopped") {
      if (isAlwaysOnEnabled) {
        stageActiveClipForItem(message.item_id ?? activeClipItemIdRef.current, "vad-stop");
      } else {
        speechActiveRef.current = false;
      }
      return;
    }

    if (message.type === "input_audio_buffer.committed") {
      const itemId = message.item_id ?? "";
      if (itemId.length > 0 && !pendingSegmentsRef.current.has(itemId)) {
        stageBufferedSegmentForItem(itemId, "vad-stop");
      }
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

  function beginActiveClip(itemId: string): void {
    speechActiveRef.current = true;
    activeClipItemIdRef.current = itemId;
    activeClipStartedMsRef.current = Date.now();
    activeClipTranscriptRef.current = "";
    activeClipChunksRef.current = [...preRollChunksRef.current];
    activeClipBytesRef.current = activeClipChunksRef.current.reduce((total, chunk) => total + chunk.byteLength, 0);
    segmentChunksRef.current = [...preRollChunksRef.current];
    segmentBytesRef.current = segmentChunksRef.current.reduce((total, chunk) => total + chunk.byteLength, 0);
    segmentStartedMsRef.current = Date.now() - PRE_ROLL_MS;
  }

  async function finalizeCompletedSegment(itemId: string, transcript: string): Promise<void> {
    const pending = resolvePendingSegment(itemId);
    if (!pending || transcript.trim().length === 0) {
      return;
    }

    await onClipCaptured({
      pcm: pending.pcm,
      transcript: transcript.trim(),
      startedAtMs: pending.startedAtMs,
      endedAtMs: pending.endedAtMs,
      reason: pending.reason,
    });
  }

  function stageActiveClipForItem(itemId: string, reason: "vad-stop" | "max-duration"): void {
    if (!speechActiveRef.current && reason !== "max-duration") {
      return;
    }

    speechActiveRef.current = false;
    const endedAtMs = Date.now();
    const startedAtMs = activeClipStartedMsRef.current || endedAtMs;
    const pcm = concatChunks(activeClipChunksRef.current);

    activeClipChunksRef.current = [];
    activeClipBytesRef.current = 0;
    activeClipTranscriptRef.current = "";
    activeClipItemIdRef.current = "";
    clearSegmentBuffer();

    if (pcm.byteLength < MIN_CLIP_BYTES) {
      return;
    }

    const pending: PendingSegment = {
      pcm,
      startedAtMs,
      endedAtMs,
      reason,
    };

    if (itemId.length > 0) {
      pendingSegmentsRef.current.set(itemId, pending);
      return;
    }

    fallbackPendingSegmentRef.current = pending;
  }

  function stageBufferedSegmentForItem(itemId: string, reason: "vad-stop" | "max-duration"): void {
    const pcm = concatChunks(segmentChunksRef.current);
    const endedAtMs = Date.now();
    const startedAtMs = segmentStartedMsRef.current || endedAtMs;

    clearSegmentBuffer();

    if (pcm.byteLength < MIN_CLIP_BYTES) {
      return;
    }

    pendingSegmentsRef.current.set(itemId, {
      pcm,
      startedAtMs,
      endedAtMs,
      reason,
    });
  }

  function resolvePendingSegment(itemId: string): PendingSegment | null {
    if (itemId.length > 0) {
      const exact = pendingSegmentsRef.current.get(itemId) ?? null;
      if (exact) {
        pendingSegmentsRef.current.delete(itemId);
        return exact;
      }
    }

    const fallback = fallbackPendingSegmentRef.current;
    fallbackPendingSegmentRef.current = null;
    return fallback;
  }

  function clearSegmentBuffer(): void {
    segmentChunksRef.current = [];
    segmentBytesRef.current = 0;
    segmentStartedMsRef.current = 0;
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
    activeClipItemIdRef.current = "";

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
    realtimeRecords,
    realtimeCurrentRecord,
    realtimeError,
    isRunning,
    liveAudioLevel,
    audioLevelBars,
    sentAudioChunks,
    receivedEvents,
    lastEventType,
    realtimeLog,
    startRealtime,
    stopRealtime,
    setRealtimeError,
  };
}

function mergeTranscriptText(existing: string, nextChunk: string): string {
  const trimmedNext = nextChunk.trim();
  if (trimmedNext.length === 0) {
    return existing.trim();
  }

  const trimmedExisting = existing.trim();
  if (trimmedExisting.length === 0) {
    return trimmedNext;
  }

  if (trimmedNext === trimmedExisting || trimmedNext.startsWith(trimmedExisting)) {
    return trimmedNext;
  }

  if (trimmedExisting.endsWith(trimmedNext)) {
    return trimmedExisting;
  }

  return `${trimmedExisting} ${trimmedNext}`;
}

function calculateRms(buffer: Float32Array): number {
  if (buffer.length === 0) {
    return 0;
  }

  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const sample = buffer[i] ?? 0;
    sum += sample * sample;
  }

  return Math.sqrt(sum / buffer.length);
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
