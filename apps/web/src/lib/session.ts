/**
 * Where the token lives.
 *
 * `localStorage`, which is the wrong answer in a threat model that includes
 * XSS — a script on the page can read it, and an httpOnly cookie could not.
 * It is the answer here for one reason: the SPA and the API are separate
 * origins by design (ADR-001), so a cookie session needs `SameSite=None`,
 * CORS credentials and CSRF protection on every mutation. That is the right
 * work, and it is Phase 5 work, alongside TLS and a real deployment.
 *
 * Recorded as a known gap in SECURITY.md rather than left as an implied
 * decision. The mitigations that do exist: a 12-hour expiry, and a token that
 * carries no secret beyond the session itself.
 */

const TOKEN_KEY = "clinicpilot.token";

/** In-memory mirror, so a blocked or full localStorage degrades to a session
 *  that works until the tab closes rather than a login that silently fails. */
let cached: string | null = null;

export function getToken(): string | null {
  if (cached !== null) return cached;

  try {
    cached = window.localStorage.getItem(TOKEN_KEY);
  } catch {
    cached = null;
  }

  return cached;
}

export function setToken(token: string | null): void {
  cached = token;

  try {
    if (token === null) window.localStorage.removeItem(TOKEN_KEY);
    else window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Private mode, quota, or a locked-down browser. The in-memory copy above
    // still works for this tab.
  }
}

/** Called by the API layer on any 401, so a revoked session cannot loop. */
export function clearToken(): void {
  setToken(null);
}
