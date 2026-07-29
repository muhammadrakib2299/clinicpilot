export const DEFAULT_WEB_ORIGIN = "http://localhost:5173";

/**
 * Parses the `WEB_ORIGIN` allowlist.
 *
 * Comma-separated so one deploy can serve the Vite dev server and the
 * containerised nginx build at once; the AI service reads the same variable
 * the same way, so the two backends can never drift apart.
 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  const value = raw?.trim() ? raw : DEFAULT_WEB_ORIGIN;

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
