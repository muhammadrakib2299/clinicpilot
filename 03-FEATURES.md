# 03 · Features

Features are grouped by **module** and tagged:
- 🟢 **MVP** — required for the demo to be credible (Weeks 1–10)
- 🔵 **Stretch** — build if time allows; great "future work" talking points
- 🟣 **Researched suggestion** — added based on market/competitor research beyond the original idea list

Every feature has a one-line **why** so scope stays honest and job-relevant.

---

## Module A — Agent Fleet Management

| Feature | Tag | Why |
|---------|-----|-----|
| Agent catalog with 3 prebuilt agents (Scheduling, Follow-up, Document Q&A) | 🟢 | The core value prop; concrete, demoable agents beat abstract ones |
| Deploy / start / stop / pause an agent per tenant | 🟢 | "Deploy and manage multiple agents" is the headline promise |
| Per-agent config: system prompt, allowed tools, guardrails, linked workflow | 🟢 | Shows real agent engineering, not a hardcoded bot |
| Live status + health per agent (active, tasks in-flight, error rate) | 🟢 | Observability signal hiring managers look for |
| Agent versioning + rollback (config snapshots) | 🔵 | Demonstrates production maturity (change management) |
| Agent "sandbox / simulator" to test before going live | 🟣 | Competitors emphasize safety; lets the demo show a controlled run |
| Agent templates / clone-to-create | 🔵 | Extensibility story ("clinics build their own") |

---

## Module B — Multi-Agent Orchestration

| Feature | Tag | Why |
|---------|-----|-----|
| Orchestrator that routes an incoming task to the right agent | 🟢 | Core multi-agent pattern (routing) — the technical differentiator |
| Claude **tool-use** loop (reason → call tool → observe → respond) | 🟢 | The single most important AI-engineering signal |
| Human hand-off / escalation queue on low confidence or out-of-scope | 🟢 | Mirrors safe real-world design; a strong demo moment |
| Live agent **trace / reasoning timeline** in the UI | 🟢 | Transparency + "wow"; proves you can surface agent internals |
| Reflection/critique step for high-stakes actions (self-check before write) | 🟣 | Research shows reflection/critique are core orchestration motifs ([Accelirate](https://www.accelirate.com/llm-agent-orchestration/)) |
| Configurable orchestration mode (sequential / parallel) | 🔵 | Directly names the industry-standard patterns ([Accelirate](https://www.accelirate.com/llm-agent-orchestration/)) |
| Model fallback (Claude primary → OpenAI on failure/timeout) | 🟣 | Reliability engineering; shows provider-agnostic design |

---

## Module C — Workflow Automation (n8n)

| Feature | Tag | Why |
|---------|-----|-----|
| Self-hosted n8n embedded; each agent linked to an n8n workflow | 🟢 | Fulfills the "n8n workflow" requirement; workflows stay auditable |
| Prebuilt workflows: appointment booking, follow-up sequence, doc ingest | 🟢 | Concrete automations the agents actually trigger |
| Trigger workflows from the API via n8n webhooks | 🟢 | Clean integration boundary between app and automation |
| In-app "workflow builder" launch (deep-link into n8n editor) | 🟢 | Satisfies "workflow builder for custom automation" pragmatically |
| Workflow run history + status surfaced in ClinicPilot UI | 🔵 | Unifies observability across app + automation |
| Retry / dead-letter handling for failed workflow runs | 🟣 | Production reliability; pairs with BullMQ story |

---

## Module D — EHR / FHIR Integration

| Feature | Tag | Why |
|---------|-----|-----|
| FHIR R4 client against HAPI FHIR public test server | 🟢 | Real healthcare standard; the credibility anchor |
| Read/write `Patient`, `Appointment`, `Slot`, `Observation` resources | 🟢 | Enough surface for scheduling + follow-up to be real |
| FHIR resource browser in the UI (search patients, view appointments) | 🟢 | Makes the integration visible in the demo |
| Pluggable EHR adapter interface (FHIR now; Epic/Cerner-shaped later) | 🟣 | Shows extensible design; interview-friendly abstraction |
| SMART-on-FHIR-style auth scaffolding (documented, stubbed) | 🔵 | Demonstrates awareness of real EHR auth |
| Sync/caching layer for FHIR reads (Redis) | 🔵 | Performance + rate-limit resilience |

---

## Module E — Analytics & Observability

| Feature | Tag | Why |
|---------|-----|-----|
| Real-time dashboard: tasks/day, success vs escalation, per agent | 🟢 | "Real-time analytics view" requirement |
| **Cost analytics**: Claude token usage → $ per resolved task | 🟢 | Rare, senior-level signal; shows you think about unit economics |
| Latency metrics (p50/p95) per agent + queue depth | 🔵 | Backend/platform credibility |
| KPI tiles: no-show delta, calls deflected, follow-ups completed | 🟢 | Ties tech to business ROI (what buyers care about) |
| Exportable reports (CSV/PDF) | 🔵 | Enterprise table-stakes |
| Anomaly alerts (error-rate spike, cost spike) | 🟣 | Proactive ops; strong "future work" or stretch |

---

## Module F — Access Control, Security & Compliance

| Feature | Tag | Why |
|---------|-----|-----|
| Multi-tenant auth (org → users), tenant data isolation | 🟢 | Multi-tenancy is a core enterprise/system-design signal |
| **RBAC**: Admin / Clinician / Coordinator / Viewer roles | 🟢 | "Role-based access control for clinic staff" requirement |
| **Audit log**: every agent action, tool call, data access, config change | 🟢 | "Audit log for compliance (HIPAA)" requirement |
| Encryption in transit (TLS) + at rest; secrets management | 🟢 | HIPAA technical safeguard baseline ([HIPAA Journal](https://www.hipaajournal.com/hipaa-compliance-for-saas/)) |
| PHI redaction / de-identification before it hits the LLM | 🟣 | Safety differentiator; concrete AI-safety engineering |
| MFA + SSO (OIDC) scaffolding | 🔵 | Enterprise auth expectation |
| "Break-glass" access + immutable audit export | 🔵 | Advanced compliance talking point |
| BAA-aligned vendor posture (Claude via Bedrock/Vertex/Azure) documented | 🟣 | Anthropic is the only foundation model on all 3 HIPAA clouds ([Paubox](https://www.paubox.com/blog/anthropic-brings-claude-ai-to-healthcare-with-hipaa-tools)) |

---

## Top researched feature suggestions (beyond the original idea)

These 5 are the highest-leverage additions from the research — each strengthens both the product and the job narrative.

1. **PHI redaction / de-identification pipeline before LLM calls** 🟣
   *Why:* Directly addresses the #1 healthcare-AI objection (PHI leaving the boundary) and the $7.42M avg breach cost ([securelayer7](https://blog.securelayer7.net/hipaa-compliance/)). Shows AI-safety engineering, not just prompt-writing.

2. **Human-in-the-loop escalation + "safe/non-diagnostic" guardrails** 🟢/🟣
   *Why:* The market's most-funded player, Hippocratic AI, built its whole positioning on **non-diagnostic** patient tasks ([hippocraticai.com](https://hippocraticai.com/)). Copying that scoping discipline signals domain maturity.

3. **Cost-per-resolved-task analytics** 🟢
   *Why:* Peers sell on hard ROI ("~$1M saved in 3 months" — Hyro). Surfacing unit economics turns a tech demo into a business case and shows senior thinking about LLM cost.

4. **Model fallback + evaluation harness** 🟣
   *Why:* Multi-agent orchestration research reports up to **140× correctness improvements** from good orchestration vs single-agent ([arXiv 2511.15755](https://arxiv.org/abs/2511.15755)). An eval harness lets you *prove* quality — a top hiring signal.

5. **Voice channel for the Scheduling/Follow-up agent (stretch)** 🔵/🟣
   *Why:* Every leading competitor (Hippocratic, Hyro, Prosper, Cognigy) is **voice-first** for patient access. Even a single Twilio-based voice demo dramatically raises perceived scope.

**Honorable mentions:** RAG over a document corpus with citations (Document Q&A trust), tenant-level usage billing/metering, and an in-app agent "playground" for prompt iteration.

---

## Explicitly out of scope (stated on purpose)

- **No diagnosis or clinical decision-making** — agents are administrative/engagement only.
- **No real PHI** — synthetic data + HAPI sandbox only.
- **Not a certified/HIPAA-audited product** — design intent only.
- **No real EHR vendor contracts** (Epic/Cerner) — adapter interface stubbed, not certified.

Stating scope boundaries is itself a maturity signal in interviews.
