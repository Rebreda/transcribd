/**
 * Normalize user input into Lemonade's OpenAI-compatible HTTP base:
 *   http(s)://host[:port][/optional-prefix]/api/v1
 */
export function normalizeOpenAiHttpBase(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) {
    return "http://localhost:13305/api/v1";
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    parsed = new URL(`http://${trimmed}`);
  }

  const rawPath = parsed.pathname.replace(/\/+$/, "");
  if (rawPath.endsWith("/api/v1")) {
    parsed.pathname = rawPath;
  } else if (rawPath.endsWith("/v1")) {
    parsed.pathname = `${rawPath.slice(0, -3)}/api/v1`;
  } else if (rawPath.length === 0 || rawPath === "/") {
    parsed.pathname = "/api/v1";
  } else {
    parsed.pathname = `${rawPath}/api/v1`;
  }

  return parsed.toString().replace(/\/+$/, "");
}

export function buildOpenAiEndpoint(baseUrl: string, path: string): string {
  const base = normalizeOpenAiHttpBase(baseUrl);
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return `${base}/${normalizedPath}`;
}
