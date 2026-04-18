import type { MicPermission } from "./appTypes";

type StreamResult =
  | { ok: true; value: MediaStream }
  | { ok: false; error: string };

export async function getBestEffortMicrophoneStream(audioConstraints: MediaTrackConstraints): Promise<StreamResult> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    return { ok: true, value: stream };
  } catch (errorWithSelectedDevice) {
    const hasExplicitDevice = typeof audioConstraints.deviceId !== "undefined";
    if (!hasExplicitDevice) {
      return { ok: false, error: formatMicrophoneError(errorWithSelectedDevice) };
    }

    try {
      const fallbackAudioConstraints: MediaTrackConstraints = {};
      if (typeof audioConstraints.channelCount !== "undefined") {
        fallbackAudioConstraints.channelCount = audioConstraints.channelCount;
      }
      if (typeof audioConstraints.noiseSuppression !== "undefined") {
        fallbackAudioConstraints.noiseSuppression = audioConstraints.noiseSuppression;
      }
      if (typeof audioConstraints.echoCancellation !== "undefined") {
        fallbackAudioConstraints.echoCancellation = audioConstraints.echoCancellation;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: fallbackAudioConstraints,
      });
      return { ok: true, value: stream };
    } catch (fallbackError) {
      return { ok: false, error: formatMicrophoneError(fallbackError) };
    }
  }
}

export function formatMicrophoneError(error: unknown): string {
  const asDomError = error as { name?: string; message?: string };
  const name = asDomError.name ?? "UnknownError";
  const detail = asDomError.message ?? String(error);

  if (name === "NotAllowedError") {
    return "Microphone access denied. Allow microphone for this app/window in your OS privacy settings, then click Detect Microphones and try again.";
  }

  if (name === "NotFoundError") {
    return "No microphone input found. Plug in a microphone, then click Detect Microphones.";
  }

  if (name === "NotReadableError") {
    return "Microphone is busy or unavailable. Close other recording apps and try again.";
  }

  if (name === "OverconstrainedError") {
    return "Selected microphone is unavailable. Choose another device from Settings or click Detect Microphones.";
  }

  return `Microphone access failed: ${detail}`;
}

export async function getMicrophonePermissionState(): Promise<MicPermission> {
  const permissionsApi = navigator.permissions;
  if (!permissionsApi?.query) {
    return "unknown";
  }

  try {
    const status = await permissionsApi.query({ name: "microphone" as PermissionName });
    if (status.state === "granted") {
      return "granted";
    }
    if (status.state === "denied") {
      return "denied";
    }

    return "prompt";
  } catch {
    return "unknown";
  }
}

export function getMicrophonePermissionText(permission: MicPermission): string {
  if (permission === "granted") {
    return "Microphone permission: granted";
  }
  if (permission === "denied") {
    return "Microphone permission: denied";
  }
  if (permission === "prompt") {
    return "Microphone permission: prompt required";
  }
  return "Microphone permission: unknown (platform does not report status)";
}
