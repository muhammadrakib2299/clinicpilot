# 04 · UI / UX

The UI has one job beyond being usable: **make a hiring manager believe this is a real, shipped enterprise product within 10 seconds.** That means a calm, dense-but-legible data application aesthetic (think Linear / Vercel / Retool), not a flashy landing page.

---

## Design principles

1. **Clarity over cleverness.** It's an operations tool; legibility and scannability win.
2. **Show the agent's mind.** Surfacing reasoning traces and tool calls is the product's signature — never hide the AI behind a spinner.
3. **Status is always visible.** Every agent, workflow, and task has an unambiguous state (color + label + icon, never color alone).
4. **Trust through transparency.** Audit trails, cost, and escalations are first-class, not buried.
5. **Progressive disclosure.** Overview → drill into an agent → drill into a single task/trace. Never overwhelm the first screen.
6. **Fast.** Optimistic updates, streamed traces, skeleton loaders; the app should feel instant.

---

## Information architecture / navigation

Left sidebar (persistent), tenant switcher at the top, user/role menu at the bottom.

```
ClinicPilot
├── Dashboard (Fleet Overview)      ← default landing
├── Agents
│   ├── Scheduling Agent
│   ├── Follow-up Agent
│   └── Document Q&A Agent
│        └── [Config · Runs · Traces · Analytics]
├── Tasks / Inbox                   ← live task stream + human hand-off queue
├── Workflows (n8n)                 ← list + deep-link to editor
├── FHIR Explorer                   ← patients, appointments, resources
├── Analytics                       ← cross-agent metrics + cost
├── Audit Log                       ← filterable compliance trail
└── Settings
    ├── Team & Roles (RBAC)
    ├── Integrations (EHR/FHIR, LLM keys)
    └── Organization / Tenant
```

Nav visibility is **RBAC-driven**: a `Viewer` sees Dashboard, Analytics, and read-only Agents; an `Admin` sees everything including Settings and Audit Log.

---

## Key screens / pages

| Screen | Purpose | Key components |
|--------|---------|----------------|
| **Fleet Overview (Dashboard)** | At-a-glance health of the whole agent fleet + tenant KPIs | KPI tiles, agent status cards, activity feed, cost sparkline |
| **Agent Detail** | Manage one agent | Tabbed: Config, Runs, Traces, Analytics; Active toggle; guardrails editor |
| **Task Inbox / Simulator** | Watch agents work + handle escalations | Live task list, streaming trace panel, hand-off queue, "simulate message" box |
| **Trace Viewer** | Inspect a single agent run | Step timeline (reason → tool call → observation → action), token/cost per step, latency |
| **Workflows** | Bridge to n8n automations | Workflow cards, run history, "Open in n8n" deep link |
| **FHIR Explorer** | Prove the EHR integration is real | Patient search, patient detail, appointment list, raw resource JSON viewer |
| **Analytics** | Business + technical metrics | Time-series charts, per-agent breakdown, cost-per-task, filters |
| **Audit Log** | Compliance trail | Virtualized table, filter by actor/tenant/resource/action, export |
| **Settings → Team & Roles** | RBAC management | User table, role assignment, invite flow |
| **Auth (Login / Org select)** | Entry + multi-tenant | Login, tenant switcher, seeded demo accounts |

---

## Design system suggestion

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Component library** | **shadcn/ui** (Radix primitives + Tailwind) | Accessible by default (Radix), fully ownable code, the current "serious SaaS" look |
| **Styling** | **Tailwind CSS** | Fast, consistent, tokens map cleanly to a design system |
| **Icons** | **Lucide** | Ships with shadcn; clean, consistent |
| **Charts** | **Recharts** (or Tremor for speed) | Declarative React charts; Tremor gives dashboard blocks fast |
| **Data/tables** | **TanStack Table** + virtualization | Handles large audit/task tables performantly |
| **State/data** | **TanStack Query** | Server-state, caching, background refetch, optimistic updates |
| **Realtime** | WebSocket / SSE for trace streaming | Live agent traces are the signature UX |
| **Motion** | Framer Motion (sparingly) | Subtle transitions, not decoration |

### Visual direction — "Clinical Futurism" (no gradients)

The look is **flat, high-contrast, and precise** — a control-plane for a serious operation, not a consumer app. Reference points: Linear, Vercel dashboard, Retool, Datadog. The rules below are binding for the build.

**Hard rules**
1. **No gradients. Anywhere.** No `bg-gradient-*`, no gradient borders, no gradient text, no soft radial glows. Depth comes from **flat surfaces + hairline borders + subtle elevation**, never from color blends.
2. **Solid fills only.** Every surface, button, badge, and chart series uses a single solid token.
3. **Borders do the work.** 1px hairline borders (`border`) and a layered surface scale create hierarchy instead of shadows/gradients. Shadows are allowed but kept tight and neutral (`shadow-sm`), never colored glows.
4. **One accent, used sparingly.** The accent marks *action and active-state only*. Data/status colors are separate and semantic.
5. **Motion is functional** — state transitions and streaming, never decorative. Respect `prefers-reduced-motion`.

**Surface scale (the futuristic depth trick — flat layers, not shadows)**

| Token | Dark (primary theme) | Light | Use |
|-------|----------------------|-------|-----|
| `bg` (canvas) | `#0A0C10` | `#F7F8FA` | App background |
| `surface-1` | `#12151C` | `#FFFFFF` | Cards, panels |
| `surface-2` | `#181C25` | `#F1F3F6` | Nested panels, table headers, hover |
| `border` | `#242A35` | `#E3E6EB` | Hairline dividers/outlines |
| `border-strong` | `#323947` | `#CDD2DA` | Focus outlines, active edges |
| `text` | `#E6E9EF` | `#0B0E14` | Primary text |
| `text-muted` | `#8B94A7` | `#5A6372` | Secondary/labels |

**Accent + semantic status** (solid, WCAG-checked in both themes):

| Token | Value | Use |
|-------|-------|-----|
| Accent / primary | `#3B82F6` (blue-500) | Primary actions, active nav, focus — **action only** |
| Success | `#10B981` (emerald-500) | Agent active, task resolved |
| Warning | `#F59E0B` (amber-500) | Escalation, degraded |
| Danger | `#F43F5E` (rose-500) | Error, failed run |
| Info | `#0EA5E9` (sky-500) | In-progress, informational |

> Dark theme is the **primary/default** (a control-plane reads as more "futuristic" and shows off status colors); light theme is a full first-class alternative. Status is **always** color + icon + label, never color alone. The accent blue is reserved for interaction — it must never compete with the semantic status hues.

**Signature futuristic details (all gradient-free):** hairline-bordered cards on a near-black canvas, a persistent thin top status bar, monospace tabular numerals for all metrics, a fine 1px grid backdrop on empty states, crisp status "pills" (dot + label), and the streaming Trace Viewer as the centerpiece motion.

**Spacing & layout** — 4px base grid (Tailwind default), `space-4`/`space-6` rhythm, max content width ~1440px, 12-col responsive grid, generous whitespace in data-dense views.

**Typography** — `Inter` (UI) + `JetBrains Mono` (traces, JSON, code). Type scale: 12 / 14 / 16 / 20 / 24 / 32. Tabular numbers for metrics.

---

## Accessibility (WCAG 2.2 AA target)

- **Radix/shadcn primitives** give correct roles, focus management, and keyboard nav out of the box.
- **Never rely on color alone** — status = color + icon + text label.
- **Contrast ≥ 4.5:1** for text; verify accent/status pairs in both themes.
- **Full keyboard operability**; visible focus rings; logical tab order.
- **ARIA live regions** for streaming traces and toast notifications so screen readers announce agent activity.
- **Respect `prefers-reduced-motion`**; disable non-essential animation.
- **Semantic tables** with headers/scope for audit and analytics grids.
- **Form labels + inline error messaging** on all config/settings forms.

Accessibility is called out deliberately — it's a differentiator that signals professional front-end maturity in interviews.

---

## Text wireframe — main dashboard (Fleet Overview)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  ClinicPilot   [🏥 Northside Family Clinic ▾]                 🔔   Priya (Admin) ▾│
├──────────────┬────────────────────────────────────────────────────────────────┤
│              │  Fleet Overview                              Last 7 days ▾   ⟳    │
│ ▣ Dashboard  │                                                                  │
│ ◱ Agents     │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│ ✉ Tasks  (3) │  │ Appts    │ │ Follow-  │ │ No-show  │ │ Calls    │            │
│ ⚙ Workflows  │  │ booked   │ │ ups sent │ │ rate     │ │ deflected│            │
│ ⛃ FHIR       │  │  128     │ │  342     │ │ 11% ▼4pp │ │  76%     │            │
│ ▤ Analytics  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘            │
│ ⧉ Audit Log  │                                                                  │
│ ⚙ Settings   │  Agents                                                          │
│              │  ┌───────────────────────────┐ ┌───────────────────────────┐    │
│              │  │ ● Scheduling Agent  ACTIVE │ │ ● Follow-up Agent  ACTIVE  │    │
│              │  │ tasks today: 54            │ │ tasks today: 118           │    │
│              │  │ success 92% · esc 8%       │ │ success 96% · esc 4%       │    │
│              │  │ cost/task $0.031  ▁▂▄▃▅    │ │ cost/task $0.012  ▁▁▂▂▃    │    │
│              │  │ [Configure] [Pause]        │ │ [Configure] [Pause]        │    │
│              │  └───────────────────────────┘ └───────────────────────────┘    │
│              │  ┌───────────────────────────┐                                   │
│              │  │ ◐ Document Q&A     ACTIVE  │   Live Activity                  │
│              │  │ queries today: 37          │   • 09:41 Scheduling booked appt │
│              │  │ success 89% · esc 11%      │   • 09:39 Follow-up SMS sent x12 │
│              │  │ cost/query $0.021 ▁▃▂▄▂    │   • 09:37 ⚠ Escalation: clinical │
│              │  │ [Configure] [Pause]        │       question → human queue     │
│              │  └───────────────────────────┘   • 09:35 DocQ&A answered (cited) │
│              │                                                                  │
│              │  Task volume (7d)   ▁▂▃▅▆▇▇▆▅▄▅▆   Cost (7d) ▂▂▃▃▄▄▅  $  42.18   │
└──────────────┴────────────────────────────────────────────────────────────────┘
```

**Signature interaction:** clicking any Live Activity item or agent card opens the **Trace Viewer** — a streamed, step-by-step timeline of the agent reasoning, calling FHIR/n8n tools, and acting. That view is the single most memorable thing in the demo, so it gets the most design polish.
