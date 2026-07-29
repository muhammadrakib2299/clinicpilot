import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { AGENTS, ORG, SAMPLE_TRACE } from "@/data/mock";

const STREAM_INTERVAL_MS = 520;

afterEach(() => {
  vi.useRealTimers();
});

describe("app shell", () => {
  it("renders the org, the fleet heading and every agent card", () => {
    render(<App />);

    expect(screen.getByText(ORG.name)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Fleet Overview" })).toBeInTheDocument();

    for (const agent of AGENTS) {
      expect(screen.getByText(agent.name)).toBeInTheDocument();
    }
  });

  it("defaults to the dark theme and toggles it on <html>", () => {
    render(<App />);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    fireEvent.click(screen.getByLabelText("Toggle theme"));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");

    fireEvent.click(screen.getByLabelText("Toggle theme"));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });
});

describe("trace drawer", () => {
  it("stays closed until an agent card asks for it", () => {
    render(<App />);
    expect(screen.queryByText(/Agent trace/i)).not.toBeInTheDocument();
  });

  it("streams steps one at a time and settles on the resolved total cost", () => {
    vi.useFakeTimers();
    render(<App />);

    fireEvent.click(screen.getAllByRole("button", { name: /view traces/i })[0]!);

    // Opens empty — the point of the drawer is watching the run arrive.
    expect(screen.getByText(/streaming/i)).toBeInTheDocument();
    expect(screen.getByText(/Running…/)).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(STREAM_INTERVAL_MS));
    expect(screen.getByText(SAMPLE_TRACE.steps[0]!.label)).toBeInTheDocument();
    expect(screen.queryByText(SAMPLE_TRACE.steps[1]!.label)).not.toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(STREAM_INTERVAL_MS * SAMPLE_TRACE.steps.length));

    // "Observation" repeats across steps, so assert on occurrence counts:
    // that proves every step rendered, not just every distinct label.
    const perLabel = new Map<string, number>();
    for (const step of SAMPLE_TRACE.steps) {
      perLabel.set(step.label, (perLabel.get(step.label) ?? 0) + 1);
    }
    for (const [label, count] of perLabel) {
      expect(screen.getAllByText(label)).toHaveLength(count);
    }

    expect(screen.getByText(/Resolved — appointment rescheduled/)).toBeInTheDocument();
    expect(screen.queryByText(/streaming/i)).not.toBeInTheDocument();

    const expected = SAMPLE_TRACE.steps.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
    expect(screen.getByText(`total cost $${expected.toFixed(3)}`)).toBeInTheDocument();
  });

  it("closes again on the dismiss button", () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole("button", { name: /view traces/i })[0]!);
    expect(screen.getByText(/Agent trace/i)).toBeInTheDocument();

    // The drawer header's icon-only close button is the last control in it.
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1]!);

    expect(screen.queryByText(/Agent trace/i)).not.toBeInTheDocument();
  });
});
