import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { setToken } from "@/lib/session";

const SESSION = {
  id: "user-1",
  email: "admin@demo.clinicpilot.io",
  name: "Priya Nair",
  tenantId: "00000000-0000-4000-8000-000000000001",
  role: "admin",
  memberships: [
    {
      tenantId: "00000000-0000-4000-8000-000000000001",
      tenantName: "Northside Family Clinic",
      role: "admin",
    },
    {
      tenantId: "00000000-0000-4000-8000-000000000002",
      tenantName: "Riverside Medical Group",
      role: "clinician",
    },
  ],
};

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

/** Every endpoint the signed-in dashboard hits on mount. */
const BASE_HANDLERS = {
  "/api/auth/me": SESSION,
  "/api/overview": OVERVIEW_RESPONSE,
  "/api/agents": AGENTS_RESPONSE,
};

/** Renders and waits out the "verifying your stored token" gate. */
async function renderSignedIn() {
  render(<App />);
  await waitFor(() => expect(screen.getByText("Priya Nair")).toBeInTheDocument());
}

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
  // A stored token, which the app verifies against /auth/me before rendering.
  setToken("test-token");
});

afterEach(() => {
  setToken(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("app shell", () => {
  it("renders the fleet heading and agent cards from the API", async () => {
    vi.stubGlobal("fetch", mockFetch({ ...BASE_HANDLERS }));
    await renderSignedIn();

    expect(screen.getByRole("heading", { name: "Fleet Overview" })).toBeInTheDocument();
    // Agent cards come from GET /api/agents now, not from the fixture module.
    await waitFor(() => expect(screen.getByText("Scheduling Agent")).toBeInTheDocument());
  });

  it("defaults to the dark theme and toggles it on <html>", async () => {
    vi.stubGlobal("fetch", mockFetch({ ...BASE_HANDLERS }));
    await renderSignedIn();

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    fireEvent.click(screen.getByLabelText("Toggle theme"));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("sends the session token on every request", async () => {
    const fetchMock = mockFetch({ ...BASE_HANDLERS });
    vi.stubGlobal("fetch", fetchMock);
    await renderSignedIn();

    for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit?][]) {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token");
    }
  });
});

describe("signed out", () => {
  it("shows the login screen and never mounts the dashboard", async () => {
    setToken(null);
    const fetchMock = mockFetch({ ...BASE_HANDLERS });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument(),
    );
    // Nothing behind the gate is mounted, so nothing can fire a request that
    // 401s while the user looks at a half-rendered dashboard.
    expect(screen.queryByRole("heading", { name: "Fleet Overview" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drops to the login screen when a stored token is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }) as Response),
    );

    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument(),
    );
  });
});

describe("role-gated navigation", () => {
  it("shows admin-only destinations to an admin", async () => {
    vi.stubGlobal("fetch", mockFetch({ ...BASE_HANDLERS }));
    await renderSignedIn();

    expect(screen.getByRole("link", { name: /Audit Log/ })).toBeInTheDocument();
  });

  it("hides them from a viewer", async () => {
    // Hiding is not the enforcement — the API guard is. This stops the nav
    // advertising a door that opens onto a 403.
    vi.stubGlobal(
      "fetch",
      mockFetch({ ...BASE_HANDLERS, "/api/auth/me": { ...SESSION, role: "viewer" } }),
    );
    await renderSignedIn();

    expect(screen.queryByRole("link", { name: /Audit Log/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Tasks/ })).toBeInTheDocument();
  });
});

describe("tenant switcher", () => {
  it("lists the organisations the user belongs to", async () => {
    vi.stubGlobal("fetch", mockFetch({ ...BASE_HANDLERS }));
    await renderSignedIn();

    fireEvent.click(screen.getByRole("button", { name: /Northside Family Clinic/ }));

    expect(screen.getByRole("menuitem", { name: /Riverside Medical Group/ })).toBeInTheDocument();
  });

  it("does not offer a switch to someone who belongs to one clinic", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        ...BASE_HANDLERS,
        "/api/auth/me": { ...SESSION, memberships: [SESSION.memberships[0]] },
      }),
    );
    await renderSignedIn();

    expect(screen.getByRole("button", { name: /Northside Family Clinic/ })).toBeDisabled();
  });
});

describe("trace drawer", () => {
  it("stays closed until a task exists to watch", async () => {
    vi.stubGlobal("fetch", mockFetch({ ...BASE_HANDLERS }));
    await renderSignedIn();

    expect(screen.queryByText(/Agent trace/i)).not.toBeInTheDocument();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("creates a real task from the composer and opens the stream for it", async () => {
    const fetchMock = mockFetch({ ...BASE_HANDLERS, "/api/tasks": TASK });
    vi.stubGlobal("fetch", fetchMock);

    await renderSignedIn();
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
    await renderSignedIn();
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
    await renderSignedIn();
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
    await renderSignedIn();
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
    await renderSignedIn();
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
    await renderSignedIn();
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
    await renderSignedIn();
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;
    await act(async () => socket.open());

    fireEvent.click(screen.getByLabelText("Close trace"));

    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
  });
});
