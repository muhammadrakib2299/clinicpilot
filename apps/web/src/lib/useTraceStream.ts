import { useEffect, useRef, useState } from "react";

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

/**
 * Live trace steps for one task.
 *
 * Fetches the existing steps before trusting the socket. A run that started
 * before the drawer opened has already written steps that will never be
 * broadcast again, so a socket-only view would show a trace beginning
 * mid-thought. Steps are merged by `stepNo`, which the producer assigns and
 * the database enforces unique — so a step that arrives over both paths is
 * shown once.
 */
export function useTraceStream(taskId: string | null) {
  const [steps, setSteps] = useState<LiveTraceStep[]>([]);
  const [status, setStatus] = useState<Task["status"]>("queued");
  const [outcome, setOutcome] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!taskId) {
      setSteps([]);
      setStatus("queued");
      setOutcome(null);
      setConnection("idle");
      return;
    }

    let cancelled = false;
    setConnection("connecting");
    setSteps([]);

    const merge = (incoming: LiveTraceStep[] | undefined) => {
      // The socket is the primary source; the backfill is a convenience. A
      // malformed or unexpected backfill payload must not take the live stream
      // down with it, so this tolerates a non-array rather than throwing
      // inside a state updater where React cannot recover.
      if (!Array.isArray(incoming) || incoming.length === 0) return;

      setSteps((current) => {
        const byStep = new Map(current.map((step) => [step.stepNo, step]));
        for (const step of incoming) {
          if (step && typeof step.stepNo === "number") byStep.set(step.stepNo, step);
        }
        return [...byStep.values()].sort((a, b) => a.stepNo - b.stepNo);
      });
    };

    const socket = new WebSocket(traceSocketUrl());
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      if (cancelled) return;
      socket.send(JSON.stringify({ event: "subscribe", data: { taskId } }));
      setConnection("live");

      // Backfill after subscribing, never before: doing it the other way round
      // leaves a gap where a step written between the two is lost entirely.
      void getTask(taskId)
        .then(({ task, steps: existing }) => {
          if (cancelled) return;
          merge(existing);
          setStatus(task.status);
          setOutcome(task.outcome);
        })
        .catch(() => {
          /* the socket is still the primary source; a failed backfill is not fatal */
        });
    });

    socket.addEventListener("message", (event) => {
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
        setStatus(frame.data.status);
        setOutcome(frame.data.outcome ?? null);
      }
    });

    socket.addEventListener("close", () => {
      if (!cancelled) setConnection("closed");
    });
    socket.addEventListener("error", () => {
      if (!cancelled) setConnection("closed");
    });

    return () => {
      cancelled = true;
      socketRef.current = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    };
  }, [taskId]);

  const totalCostUsd = steps.reduce((sum, step) => sum + (step.costUsd ?? 0), 0);

  return { steps, status, outcome, connection, totalCostUsd };
}
