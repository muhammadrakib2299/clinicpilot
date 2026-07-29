import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";

/** Minimal WebSocket stand-in — jsdom has none. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  private listeners: Record<string, ((event: unknown) => void)[]> = {};

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void) {
    (this.listeners[type] ??= []).push(handler);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", {});
  }

  /** Test helpers. */
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open", {});
  }

  receive(frame: unknown) {
    this.emit("message", { data: JSON.stringify(frame) });
  }

  private emit(type: string, event: unknown) {
    for (const handler of this.listeners[type] ?? []) handler(event);
  }
}

const TASK = {
  id: "11111111-2222-4333-8444-555555555555",
  agentId: "agent-1",
  channel: "web",
  input: "Move my Thursday appointment.",
  status: "running",
  outcome: null,
  createdAt: "2026-07-29T10:00:00.000Z",
  resolvedAt: null,
};

const AGENTS_RESPONSE = [
  {
    id: "agent-1",
    kind: "scheduling",
    name: "Scheduling Agent",
    status: "active",
    tasksToday: 3,
    totalTasks: 3,
    successRate: 1,
    escalationRate: 0,
    costPerTask: 0.007,
    totalCostUsd: 0.021,
  },
];

const OVERVIEW_RESPONSE = {
  kpis: {
    tasksTotal: 3,
    tasksToday: 3,
    tasksOpen: 1,
    resolved: 2,
    escalated: 0,
    failed: 0,
    successRate: 1,
    totalCostUsd: 0.021,
    costPerResolvedTask: 0.0105,
    modelCalls: 4,
    tokensIn: 6945,
    tokensOut: 710,
  },
  activity: [],
};

/** Every endpoint the dashboard hits on mount. */
const BASE_HANDLERS = {
  "/api/overview": OVERVIEW_RESPONSE,
  "/api/agents": AGENTS_RESPONSE,
};

function step(overrides: Record<string, unknown> = {}) {
  return {
    id: "step-1",
    taskId: TASK.id,
    stepNo: 1,
    kind: "reason",
    label: "Reason",
    detail: "Checking the current booking.",
    content: null,
    tokensIn: 1487,
    tokensOut: 269,
    costUsd: 0.00566,
    latencyMs: 4150,
    createdAt: "2026-07-29T10:00:01.000Z",
    ...overrides,
  };
}

function mockFetch(handlers: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const match = Object.entries(handlers)
      .sort(([a], [b]) => b.length - a.length)
      .find(([key]) => url.includes(key));
    if (!match) throw new Error(`unstubbed fetch: ${url}`);
    return { ok: true, json: async () => match[1] } as Response;
  });
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("app shell", () => {
  it("renders the fleet heading and agent cards from the API", async () => {
    vi.stubGlobal("fetch", mockFetch({ ...BASE_HANDLERS }));
    render(<App />);

    expect(screen.getByRole("heading", { name: "Fleet Overview" })).toBeInTheDocument();
    // Agent cards come from GET /api/agents now, not from the fixture module.
    await waitFor(() => expect(screen.getByText("Scheduling Agent")).toBeInTheDocument());
  });

  it("defaults to the dark theme and toggles it on <html>", () => {
    vi.stubGlobal("fetch", mockFetch({ ...BASE_HANDLERS }));
    render(<App />);

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    fireEvent.click(screen.getByLabelText("Toggle theme"));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });
});

describe("trace drawer", () => {
  it("stays closed until a task exists to watch", () => {
    vi.stubGlobal("fetch", mockFetch({ ...BASE_HANDLERS }));
    render(<App />);

    expect(screen.queryByText(/Agent trace/i)).not.toBeInTheDocument();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("creates a real task from the composer and opens the stream for it", async () => {
    const fetchMock = mockFetch({ ...BASE_HANDLERS, "/api/tasks": TASK });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(screen.getByText(/Agent trace/i)).toBeInTheDocument());

    // The dashboard fetches overview + agents on mount, so the POST is not
    // necessarily the first call — find it by method.
    const post = (fetchMock.mock.calls as unknown as [string, RequestInit?][]).find(
      ([, init]) => init?.method === "POST",
    );
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ agentKind: "scheduling" });
    expect(screen.getByText(TASK.id)).toBeInTheDocument();
  });

  it("subscribes to the task id once the socket opens", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ ...BASE_HANDLERS, [`/api/tasks/${TASK.id}`]: { task: TASK, steps: [] }, "/api/tasks": TASK }),
    );
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;
    await act(async () => socket.open());

    expect(JSON.parse(socket.sent[0]!)).toEqual({
      event: "subscribe",
      data: { taskId: TASK.id },
    });
  });

  it("renders steps pushed over the socket, with tokens and cost", async () => {
    vi.stubGlobal("fetch", mockFetch({ ...BASE_HANDLERS, [`/api/tasks/${TASK.id}`]: { task: TASK, steps: [] }, "/api/tasks": TASK }));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;
    await act(async () => socket.open());
    await act(async () => socket.receive({ event: "trace:step", data: { taskId: TASK.id, step: step() } }));

    expect(screen.getByText("Reason")).toBeInTheDocument();
    expect(screen.getByText("Checking the current booking.")).toBeInTheDocument();
    expect(screen.getByText("↑1487 ↓269 tok")).toBeInTheDocument();
    expect(screen.getByText("total cost $0.00566")).toBeInTheDocument();
  });

  it("orders steps by stepNo regardless of arrival order", async () => {
    vi.stubGlobal("fetch", mockFetch({ ...BASE_HANDLERS, [`/api/tasks/${TASK.id}`]: { task: TASK, steps: [] }, "/api/tasks": TASK }));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;
    await act(async () => socket.open());

    await act(async () =>
      socket.receive({
        event: "trace:step",
        data: { taskId: TASK.id, step: step({ id: "s2", stepNo: 2, label: "Observation" }) },
      }),
    );
    await act(async () =>
      socket.receive({ event: "trace:step", data: { taskId: TASK.id, step: step() } }),
    );

    const labels = screen.getAllByText(/Reason|Observation/).map((node) => node.textContent);
    expect(labels).toEqual(["Reason", "Observation"]);
  });

  it("shows a step once when it arrives over both the backfill and the socket", async () => {
    // The backfill and the live stream overlap by design; stepNo is the
    // dedupe key so a step written mid-subscribe is not rendered twice.
    vi.stubGlobal(
      "fetch",
      mockFetch({ ...BASE_HANDLERS, [`/api/tasks/${TASK.id}`]: { task: TASK, steps: [step()] }, "/api/tasks": TASK }),
    );
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;
    await act(async () => socket.open());
    await act(async () =>
      socket.receive({ event: "trace:step", data: { taskId: TASK.id, step: step() } }),
    );

    await waitFor(() => expect(screen.getAllByText("Reason")).toHaveLength(1));
  });

  it("reflects a terminal status pushed over the socket", async () => {
    vi.stubGlobal("fetch", mockFetch({ ...BASE_HANDLERS, [`/api/tasks/${TASK.id}`]: { task: TASK, steps: [] }, "/api/tasks": TASK }));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;
    await act(async () => socket.open());

    await act(async () =>
      socket.receive({
        event: "task:status",
        data: { taskId: TASK.id, status: "resolved", outcome: "Moved to Tue 10:30." },
      }),
    );

    expect(screen.getByText("✓ Resolved")).toBeInTheDocument();
    expect(screen.getByText("Moved to Tue 10:30.")).toBeInTheDocument();
  });

  it("closes the socket when the drawer closes", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ ...BASE_HANDLERS, [`/api/tasks/${TASK.id}`]: { task: TASK, steps: [] }, "/api/tasks": TASK }),
    );
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;
    await act(async () => socket.open());

    fireEvent.click(screen.getByLabelText("Close trace"));

    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
  });
});
