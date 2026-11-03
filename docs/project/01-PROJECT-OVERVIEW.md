# 01 · Project Overview

## What ClinicPilot is

ClinicPilot is an **AI Healthcare Agent Dashboard** — a multi-tenant SaaS "control plane" that lets a healthcare clinic deploy and manage a fleet of AI agents that automate high-volume administrative and patient-engagement work. Each agent is a purpose-built assistant (scheduling, follow-up, document Q&A) whose actions are executed through **n8n workflows** and reasoned by the **Claude API**, with **FHIR/EHR** as the data backbone and a **real-time analytics + audit** layer on top.

Think of it as *"Vercel for clinic automation"*: a place to spin up, watch, and govern agents, without every clinic having to wire LLMs, EHR APIs, queues, and compliance controls from scratch.

---

## The problem

Clinics and small-to-mid health systems are drowning in **administrative labor**:

- Front-desk staff spend hours daily on the phone booking, confirming, and rescheduling appointments.
- Post-visit and post-discharge follow-up is inconsistent, driving avoidable readmissions and no-shows.
- Clinical and operational knowledge is buried in documents (policies, discharge instructions, patient records) that staff must dig through manually.

Meanwhile:

- **Administrative costs** account for roughly a quarter of US healthcare spending, and staffing shortages make the problem worse.
- Agentic AI is proven to help here — e.g., Hyro's conversational agents cut **call abandonment by 85%** and improved speed-to-answer by 79% at Intermountain Health ([keragon.com](https://www.keragon.com/blog/ai-agent-companies)) — **but adoption is early**: as of Q4 2025 only **19%** of US healthcare organizations had implemented agentic AI, and **51%** were still stuck in proof-of-concept ([aimultiple.com](https://research.aimultiple.com/ai-agents-in-healthcare/)).

The gap: most clinics can't build safe, integrated, observable multi-agent systems themselves. **ClinicPilot is the missing product layer** — deploy agents, connect them to the EHR via FHIR, and govern them from one dashboard.

---

## Target users

| Persona | Role | What they need from ClinicPilot |
|---------|------|--------------------------------|
| **Priya — Practice Operations Manager** | Runs day-to-day clinic ops | Deploy/monitor agents, see ROI (calls deflected, no-shows reduced), configure workflows without code |
| **Dr. Chen — Physician / Clinical Lead** | Delivers care | Trust that agents stay in scope (non-diagnostic), review escalations, query documents fast |
| **Sam — Front-desk / Care Coordinator** | Handles scheduling & intake | Let the Scheduling & Follow-up agents absorb repetitive calls; step in on hand-offs |
| **Alex — Clinic IT / Compliance Officer** | Owns security & HIPAA posture | RBAC, audit logs, BAA-aligned vendors, data-isolation guarantees |
| **(Buyer) Health-system CIO** | Signs the contract | Multi-tenant scalability, standards compliance (FHIR), observability, cost control |

Primary buyer = **operations + IT**; primary daily users = **ops managers and care coordinators**.

---

## Elevator pitch

> **"ClinicPilot is the deploy-and-monitor dashboard for healthcare AI agents. Clinics use it to launch scheduling, follow-up, and document-Q&A agents that plug into their EHR through FHIR, run on transparent n8n workflows, and are reasoned by Claude — all with role-based access, real-time analytics, and an audit trail built for HIPAA. It turns 'we should use AI agents' into 'we deployed three this afternoon.'"**

**15-second version:** *"It's mission control for a clinic's AI workforce — deploy agents, connect the EHR, watch the results, stay compliant."*

---

## How a demo flows end-to-end

The demo is designed to be **skimmable in 2 minutes** and to showcase full-stack + AI + infra depth. It runs entirely on **synthetic data against the public HAPI FHIR R4 sandbox**.

### Scene 1 — Land & orient (Dashboard)
1. Log in as `admin@demo.clinicpilot.io`.
2. Land on the **Fleet Overview**: 3 agents shown as status cards (Scheduling · Follow-up · Document Q&A), each with live health, today's task count, success rate, and Claude token cost.
3. Top strip shows tenant-wide KPIs: appointments booked, follow-ups sent, no-show rate delta, calls deflected.

### Scene 2 — Deploy / configure an agent
4. Click **Scheduling Agent → Configure**. Show the config: system prompt, tools it can call (FHIR `Appointment` create/read, availability lookup), guardrails ("never give clinical advice"), and the linked n8n workflow.
5. Toggle it **Active**. A live status pill flips to green.

### Scene 3 — Watch an agent work (the "wow")
6. Open the **Simulator / Inbox**: a synthetic patient message arrives — *"Hi, I need to move my Thursday appointment to next week."*
7. Watch the **agent trace** stream in real time: Claude reasons → calls `find_availability` tool → n8n hits HAPI FHIR to read the `Appointment` and `Slot` → proposes a new time → writes the updated `Appointment` back → drafts a confirmation.
8. A **hand-off rule** fires on ambiguity (e.g., patient asks a clinical question) → task is escalated to a human queue and flagged in the UI.

### Scene 4 — Analytics
9. Go to **Analytics**: time-series of tasks/day per agent, success vs. escalation rate, average handling time, and **cost per resolved task** (Claude tokens × price). Filter by agent and date range.

### Scene 5 — Governance
10. Open **Audit Log**: every agent action, tool call, and data access is timestamped with actor, tenant, and resource — filterable and exportable. 
11. Switch to the `viewer@` role to show **RBAC** in action: configuration controls disappear; read-only analytics remain.

### Scene 6 — Extensibility
12. Open the embedded **n8n editor** to show the Follow-up Agent's visual workflow — proving automations are transparent and customizable, not a black box.

**Takeaway for the viewer:** end-to-end system — real UI, real API, real LLM tool-use, real healthcare standard, real observability, real governance.

---

## What makes it credible (not a toy)

- **Standards-based**: talks FHIR R4, the actual healthcare interoperability standard.
- **Production-shaped**: multi-tenant, queued, cached, containerized, CI'd, observable.
- **Agentic depth**: genuine multi-agent orchestration (routing, tool-use, hand-off, reflection) — not a single chat box.
- **Governance-first**: RBAC + audit + BAA-aligned vendor choices, mirroring how real health-tech is built.
- **Honest scope**: agents are explicitly **non-diagnostic**, matching how the market's safest players (e.g., Hippocratic AI) position themselves.
