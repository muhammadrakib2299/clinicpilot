# 02 · Purpose, Goals & Impact

## Purpose

**Primary purpose (career):** Produce a single, portfolio-defining project that proves the developer can design and ship a **production-shaped, multi-agent AI system in a regulated, high-value domain** — and land AI / full-stack roles and contracts off the back of it.

**Secondary purpose (product):** Demonstrate a genuinely useful pattern — a control plane that lets clinics safely deploy and govern AI agents against their EHR — in a market that is real, funded, and growing fast but still early in adoption.

These two purposes reinforce each other: the more the project looks like a real product, the stronger the career signal.

---

## Goals (SMART)

Goals are split into **build goals** (ship the artifact) and **career goals** (convert it into offers). Timeframe assumes a working full-time developer building nights/weekends.

### Build goals

| # | Goal (SMART) | Metric | Target date |
|---|--------------|--------|-------------|
| B1 | Ship a **vertical slice** — one agent (Scheduling) working end-to-end from UI → API → Claude tool-use → n8n → HAPI FHIR → analytics | Demoable happy path | **Week 4** |
| B2 | Reach **MVP**: all 3 agents, multi-tenant auth, RBAC, audit log, real-time analytics dashboard | Feature checklist in `03-FEATURES.md` complete | **Week 10** |
| B3 | **Deploy publicly** with a live demo URL, seeded synthetic data, and a 2-min walkthrough video | Working link + video in README | **Week 12** |
| B4 | **Test + document** to enterprise standard: >70% coverage on core services, architecture diagram, ADRs, clean README | CI green, docs published | **Week 13** |
| B5 | Instrument **cost + performance observability** (token cost per task, p95 latency, queue depth) | Metrics visible in dashboard | **Week 11** |

### Career goals

| # | Goal (SMART) | Metric | Target date |
|---|--------------|--------|-------------|
| C1 | Publish repo + demo + a written **case study / blog post** ("How I built a multi-agent healthcare platform") | Post live, cross-posted to LinkedIn/dev.to | **Week 14** |
| C2 | Add the project to CV, LinkedIn, and portfolio site as the **lead project** | Updated in 3 places | **Week 14** |
| C3 | Apply to **20 targeted AI/full-stack roles + 10 contracts** using this as the flagship | Applications sent, tracked | **Weeks 14–18** |
| C4 | Convert into **≥5 first-round interviews** where the project is discussed | Interview count | **Weeks 16–22** |
| C5 | Land **≥1 offer or contract** at or above the AI wage premium (see impact section) | Signed | **Weeks 20–26** |

---

## Benefits

### For the developer (the point)
- **Rare skill combo on display**: LLM tool-use + multi-agent orchestration + healthcare interop (FHIR) + multi-tenant SaaS + DevOps. Few portfolio projects hit all five.
- **Talking points for every interview round**: system design (multi-tenancy, queues), AI engineering (tool-use, RAG, eval, cost control), product thinking (personas, ROI), and compliance awareness (HIPAA, RBAC, audit).
- **Domain premium**: healthcare AI is one of the highest-paying, fastest-growing niches.

### For a hypothetical clinic (the narrative)
- Deflects repetitive calls (scheduling/reschedule/confirm) — the exact workload where peers report **50–85%** automation/deflection.
- Reduces no-shows and readmissions via consistent follow-up.
- Makes institutional knowledge instantly queryable (Document Q&A).
- Keeps IT/compliance in control via RBAC + audit + standards-based integration.

---

## Real-world impact

Grounding the "why this matters" narrative in researched numbers (full citations in [`07-MARKET-RESEARCH.md`](./07-MARKET-RESEARCH.md)):

- **Market is huge and accelerating.** AI in healthcare was ~**$36.7B in 2025**, projected to **$505.6B by 2033** (38.9% CAGR) ([Grand View Research](https://www.grandviewresearch.com/industry-analysis/artificial-intelligence-ai-healthcare-market)). The **agentic** slice specifically is projected from ~**$1.1B (2025) to ~$6.9B (2030) at 44% CAGR** ([MarketsandMarkets](https://www.marketsandmarkets.com/Market-Reports/ai-agents-in-healthcare-market-231362627.html)).
- **Adoption gap = opportunity.** Only **19%** of US healthcare orgs had deployed agentic AI by Q4 2025; **51%** were still in POC ([aimultiple.com](https://research.aimultiple.com/ai-agents-in-healthcare/)). Building the enabling layer is timely.
- **Proven operational value.** Peer platforms report **85% call-abandonment reduction** (Hyro @ Intermountain) and **~$1M savings in 3 months** with 79% call deflection (Hyro @ Baptist Health) ([keragon.com](https://www.keragon.com/blog/ai-agent-companies)).
- **Compliance stakes are real.** The average healthcare data breach cost **$7.42M in 2025** ([securelayer7](https://blog.securelayer7.net/hipaa-compliance/)) — which is exactly why RBAC/audit/data-isolation design is a feature, not an afterthought.

---

## Why this specifically helps land jobs & contracts

The project is engineered to map onto **the job descriptions and pay bands that are actually hiring in 2025–2026.**

### Pay context (the upside)
- Average **AI engineer salary ~$206K in 2025**, up a further ~7% in Q1 2026 ([Acceler8 Talent](https://www.acceler8talent.com/resources/blog/ai-engineer--salary---market-rates-2025-2026/)).
- **Healthcare** AI engineering median total pay ~**$147K** ([Acceler8 Talent](https://www.acceler8talent.com/resources/blog/ai-engineer--salary---market-rates-2025-2026/)).
- **Contract** senior AI engineers command **$95–$130/hr** in the US ([Acceler8 Talent](https://www.acceler8talent.com/resources/blog/ai-engineer--salary---market-rates-2025-2026/)).
- PwC's 2025 barometer found a **56% wage premium** for AI skills, up from 25% a year earlier ([Acceler8 Talent](https://www.acceler8talent.com/resources/blog/ai-engineer--salary---market-rates-2025-2026/)).

### Role → project-signal mapping

| Target role / contract | What they screen for | Where ClinicPilot proves it |
|------------------------|----------------------|------------------------------|
| **AI / LLM Engineer** | Tool-use, agents, RAG, evals, cost/latency control | 3 agents with Claude tool-use, pgvector RAG, token-cost dashboard, eval harness |
| **AI Agent / Automation Engineer** | Multi-agent orchestration, workflow tooling | Orchestrator + n8n workflows, hand-off/escalation patterns |
| **Full-Stack Engineer (AI SaaS)** | React + Node/Python, real product, auth, multi-tenancy | Full React dashboard + NestJS + FastAPI + Postgres, tenant isolation |
| **Health-tech / Healthcare SaaS Engineer** | FHIR, HIPAA awareness, EHR integration | FHIR R4 integration (HAPI), RBAC, audit log, BAA-aligned stack |
| **Backend / Platform Engineer** | Queues, caching, scaling, observability | Redis/BullMQ, caching, horizontal-scaling design, metrics |
| **Solutions / Forward-Deployed Engineer** | Turning AI into shipped customer value | End-to-end demo, ROI framing, extensible workflows |

### The interview leverage
Because hiring managers "want to figure out if you can think like someone who has built real systems" and value **problems solved and value delivered over clever code** ([Medium — ML portfolio](https://medium.com/@santosh.rout.cr7/ml-engineer-portfolio-projects-that-will-get-you-hired-in-2025-d1f2e20d6c79)), ClinicPilot gives concrete answers to the questions they actually ask:

- *"Walk me through the architecture."* → multi-tenant diagram, queues, agent orchestration.
- *"How do you control LLM cost and quality?"* → token dashboard + eval harness + fallback model.
- *"How would this scale to 500 clinics?"* → tenancy model + caching + horizontal workers (see `06`).
- *"How did you handle security/compliance?"* → RBAC, audit, data isolation, BAA-aligned vendors.
- *"What was hard / what would you change?"* → documented in `10-LESSONS.md`.

This is the difference between "yet another GPT chatbot" (explicitly called out as *unimpressive* by hiring managers, [Medium](https://medium.com/@santosh.rout.cr7/ml-engineer-portfolio-projects-that-will-get-you-hired-in-2025-d1f2e20d6c79)) and a project that reads as **employable senior-level work.**
