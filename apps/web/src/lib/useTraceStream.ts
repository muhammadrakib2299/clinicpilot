import { useEffect, useState } from "react";

import { getTask, traceSocketUrl, type LiveTraceStep, type Task } from "@/lib/api";

export type ConnectionState = "idle" | "connecting" | "live" | "closed";

interface Frame {
  event: string;
  data: {
    taskId?: string;
    step?: LiveTraceStep;
    status?: Task["status"];
    outcome?: string | null;
  };
}

const TERMINAL = new Set<Task["status"]>(["resolved", "escalated", "failed"]);

/** 0.5s, 1s, 2s… capped. Long enough to let a restarting gateway come back. */
const backoff = (attempt: number) => Math.min(15_000, 500 * 2 ** attempt);

/**
 * Live trace steps for one task.
 *
 * Steps are merged by `stepNo`, which the producer assigns and the database
 * enforces unique — so a step arriving over both the backfill and the socket is
 * shown once, and arrival order does not matter.
 *
 * Two things this gets right that are easy to get wrong:
 *
 *  - **The backfill does not wait for the socket.** It used to run inside the
 *    socket's `open` handler, which meant a gateway with a broken or blocked
 *    WebSocket showed an empty drawer for a task that had *finished* and whose
 *    entire trace was sitting there over plain HTTP. The stream is how a live
 *    run arrives; it is not how a past one is read. It now fetches immediately
 *    and again on open — the second call is what closes the gap where a step
 *    written during the subscribe handshake would otherwise be missed, and
 *    merging makes the overlap free.
 *
 *  - **A late backfill cannot undo a newer socket status.** Once the stream has
 *    reported a status, an in-flight HTTP response is stale by definition, so
 *    it contributes steps and nothing else. Without that, a slow backfill could
 *    flip a resolved task back to `running`.
 */
export function useTraceStream(taskId: string | null) {
  const [steps, setSteps] = useState<LiveTraceStep[]>([]);
  const [status, setStatus] = useState<Task["status"]>("queued");
  const [outcome, setOutcome] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("idle");

  useEffect(() => {
    // Every field resets, not just the steps. Opening a second trace used to
    // inherit the first one's status and outcome until something replaced them.
    setSteps([]);
    setStatus("queued");
    setOutcome(null);

    if (!taskId) {
      setConnection("idle");
      return;
    }

    let cancelled = false;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let attempt = 0;
    /** The run is over; there is nothing left to stream, so stop redialling. */
    let finished = false;
    /** The stream has spoken. HTTP no longer gets a say on status. */
    let streamed = false;

    setConnection("connecting");

    const merge = (incoming: LiveTraceStep[] | undefined) => {
      // A malformed payload must not take the view down with it, so this
      // tolerates a non-array rather than throwing inside a state updater
      // where React cannot recover.
      if (!Array.isArray(incoming) || incoming.length === 0) return;

      setSteps((current) => {
        const byStep = new Map(current.map((step) => [step.stepNo, step]));
        for (const step of incoming) {
          if (step && typeof step.stepNo === "number") byStep.set(step.stepNo, step);
        }
        return [...byStep.values()].sort((a, b) => a.stepNo - b.stepNo);
      });
    };

    const backfill = () =>
      getTask(taskId)
        .then(({ task, steps: existing }) => {
          if (cancelled) return;
          merge(existing);
          if (streamed) return;
          setStatus(task.status);
          setOutcome(task.outcome);
          if (TERMINAL.has(task.status)) finished = true;
        })
        .catch(() => {
          /* the socket is the primary source; a failed backfill is not fatal */
        });

    void backfill();

    const connect = () => {
      if (cancelled || finished) return;

      const ws = new WebSocket(traceSocketUrl());
      socket = ws;
      // `close` and `error` both fire on a failed connection; only one of them
      // may schedule the retry.
      let settled = false;

      ws.addEventListener("open", () => {
        if (cancelled) return;
        attempt = 0;
        ws.send(JSON.stringify({ event: "subscribe", data: { taskId } }));
        setConnection("live");
        void backfill();
      });

      ws.addEventListener("message", (event) => {
        if (cancelled) return;
        let frame: Frame;
        try {
          frame = JSON.parse(String(event.data)) as Frame;
        } catch {
          return;
        }

        if (frame.event === "trace:step" && frame.data.step) {
          merge([frame.data.step]);
        } else if (frame.event === "task:status" && frame.data.status) {
          streamed = true;
          setStatus(frame.data.status);
          setOutcome(frame.data.outcome ?? null);
          if (TERMINAL.has(frame.data.status)) finished = true;
        }
      });

      const dropped = () => {
        if (cancelled || settled) return;
        settled = true;
        setConnection("closed");
        if (finished) return;
        retry = window.setTimeout(connect, backoff(attempt++));
      };

      ws.addEventListener("close", dropped);
      ws.addEventListener("error", dropped);
    };

    connect();

    return () => {
      cancelled = true;
      if (retry) window.clearTimeout(retry);
      if (
        socket &&
        (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
      ) {
        socket.close();
      }
    };
  }, [taskId]);

  const totalCostUsd = steps.reduce((sum, step) => sum + (step.costUsd ?? 0), 0);

  return { steps, status, outcome, connection, totalCostUsd };
}
