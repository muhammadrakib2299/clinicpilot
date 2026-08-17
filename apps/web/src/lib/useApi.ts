import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  /** First load only. A background refresh does not raise it. */
  loading: boolean;
  /** When the data on screen was last successfully fetched. */
  updatedAt: Date | null;
  reload: () => void;
}

export interface ApiOptions {
  /** Refresh this often in the background. Omit for a screen that never moves. */
  pollMs?: number;
  /** Refresh when the tab comes back to the foreground. */
  refetchOnFocus?: boolean;
}

/**
 * Minimal fetch-on-mount hook with manual reload, background polling and
 * refetch-on-focus.
 *
 * Not TanStack Query — that is planned, but it is ~13 KB for caching and
 * request deduplication this app still does not need. What it *did* need was
 * liveness: a dashboard describing itself as "live status across your deployed
 * AI agents" that only changed when you pressed a Refresh button is telling a
 * small lie, and the task you just submitted finishing without the tile moving
 * is the moment a viewer notices.
 *
 * Two rules make polling tolerable:
 *
 *  - `loading` is raised for the *first* load of a given dependency set and
 *    never for a background refresh. Otherwise every skeleton on the page would
 *    blink on the poll interval.
 *  - Nothing polls a hidden tab. A dashboard left open on a second monitor
 *    overnight should not bill the gateway for it.
 */
export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
  { pollMs, refetchOnFocus = true }: ApiOptions = {},
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [nonce, setNonce] = useState(0);

  // Callers pass inline arrows (`() => listEscalations(status)`), so the
  // function identity changes every render. Depending on it would refetch in a
  // loop; the deps array is what callers actually control.
  const call = useRef(fetcher);
  call.current = fetcher;

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    call
      .current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setUpdatedAt(new Date());
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Request failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  useEffect(() => {
    if (!pollMs && !refetchOnFocus) return;

    let cancelled = false;

    const refresh = () => {
      if (document.hidden) return;
      call
        .current()
        .then((result) => {
          if (cancelled) return;
          setData(result);
          setError(null);
          setUpdatedAt(new Date());
        })
        .catch((cause: unknown) => {
          // The last good data stays on screen and the error is shown beside
          // it, not instead of it. Silently serving stale numbers as if they
          // were live is the worse failure for a control plane.
          if (!cancelled) setError(cause instanceof Error ? cause.message : "Request failed");
        });
    };

    const timer = pollMs ? window.setInterval(refresh, pollMs) : undefined;
    const onVisibility = () => {
      if (!document.hidden) refresh();
    };
    if (refetchOnFocus) document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, pollMs, refetchOnFocus]);

  return { data, error, loading, updatedAt, reload };
}
