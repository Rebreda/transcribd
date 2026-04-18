export const MICROPHONE_TROUBLESHOOTING_STEPS = [
  "Close other apps that may hold the microphone exclusively.",
  "Ensure an input device appears in the Microphone dropdown.",
  "After changing permissions, fully restart the app and try Start Realtime again.",
] as const;

export function normalizeEndpointList(endpoints: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const endpoint of endpoints) {
    const trimmed = endpoint.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}