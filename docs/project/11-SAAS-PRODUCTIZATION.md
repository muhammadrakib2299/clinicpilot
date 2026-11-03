# 11 · SaaS Productization & Scale

ClinicPilot is designed **as a commercial multi-tenant SaaS product**, not just a demo app. The core (multi-tenancy, RLS, RBAC, per-tenant usage metering) is already SaaS-shaped; this doc defines the **commercial layer** that makes it a real, sellable, horizontally-scalable product — and a stronger hiring signal.

> **Scope discipline (portfolio reality):** everything here runs in **Stripe test mode** with synthetic data. We build the full *engineering* of a SaaS (signup, plans, billing, metering, quotas, gating, onboarding) — not real payments or marketing. That is exactly the surface enterprise employers hire for.

---

## Why SaaS framing makes it *more* scalable

| Concern | "App" framing | **SaaS product framing (this project)** |
|---------|---------------|------------------------------------------|
| Tenancy | One org, hardcoded | Self-serve orgs, isolated by RLS, upgrade path to schema/DB isolation |
| Growth | Manual onboarding | Self-serve signup → workspace → guided onboarding |
| Monetization | None | Plans, subscriptions, usage-based billing (Stripe) |
| Resource control | Unbounded | Per-plan **quotas + metering + rate limits** (protects cost & infra) |
| Product surface | Fixed | **Feature-gating** by plan; entitlements checked centrally |
| Ops | Per-app | **Super-admin console**: manage tenants, plans, usage, impersonate for support |

The quota/metering layer is the piece that makes scale *safe*: it caps per-tenant LLM spend and task volume, so one heavy tenant can't blow the budget or starve others — the "noisy neighbor" defense, at the product layer.

---

## The commercial model

### Account & org model
- **Account (org / workspace) = tenant.** A user signs up → creates an org → becomes its Owner.
- Users can belong to multiple orgs; role is **per-org** (ties into existing RBAC: Owner/Admin/Clinician/Coordinator/Viewer).
- Invitations: Owner/Admin invites teammates by email → role assigned on accept.

### Plans & entitlements

| Plan | Price (test) | Agents | Tasks / mo | Seats | LLM budget / mo | Isolation | Support |
|------|--------------|--------|-----------|-------|-----------------|-----------|---------|
| **Free / Trial** | $0 | 1 | 200 | 2 | $5 | Pool + RLS | Community |
| **Pro** | $99/mo | 3 (all) | 5,000 | 10 | $100 | Pool + RLS | Email |
| **Clinic** | $399/mo | Unlimited | 25,000 | 50 | $500 | Pool + RLS | Priority |
| **Enterprise** | Custom | Unlimited | Custom | Custom | Custom | **Schema/DB isolation** | SLA + SSO/SAML |

Entitlements are data-driven (a `plan_features` map), **not** hardcoded `if plan === 'pro'` scattered in code — one `entitlements.can(org, 'agents.create')` check everywhere. This is the detail that reads as senior-level.

### Billing (Stripe, test mode)
- **Stripe Billing** with Products/Prices per plan; **Checkout** for upgrade, **Customer Portal** for self-serve plan/card management.
- **Webhooks** (`checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.paid/payment_failed`) → keep local `subscriptions` in sync (source of truth = Stripe, mirror locally for fast entitlement checks).
- **Usage-based add-on:** LLM usage over the plan budget is **metered** (Stripe metered price) — showcases usage-based billing, the modern SaaS pattern.
- Dunning/past-due → org enters `past_due` → soft-lock (read-only) after grace period.

### Metering & quotas (the scale-safety layer)
- Every task/agent-run increments per-org counters in Redis (fast) and is reconciled to Postgres (`usage_counters`).
- **Pre-flight quota check** before enqueuing a task: over quota → `402`/upsell prompt, not a crash.
- **Per-tenant LLM budget cap** + rate limits enforced at the API gateway.
- Monthly reset job; usage rolls to the billing meter.

---

## New / extended data model (adds to doc 06)

```
plans(id, code, name, price_cents, interval, is_public)
plan_features(plan_id, feature_key, limit_int, limit_bool)   -- e.g. agents.max=3, sso=false
subscriptions(id, org_id, stripe_customer_id, stripe_subscription_id,
              plan_id, status, current_period_end, cancel_at)  -- status: trialing|active|past_due|canceled
invitations(id, org_id, email, role, token, status, invited_by, expires_at)
usage_counters(org_id, period, metric, value)                 -- metric: tasks|llm_cost_cents|seats; period: YYYY-MM
entitlements_cache(org_id, feature_key, value, updated_at)    -- denormalized for fast checks
billing_events(id, org_id, stripe_event_id, type, payload_jsonb, created_at)  -- idempotent webhook log
```

`tenants` is renamed conceptually to **`orgs`** (the account); everything tenant-scoped stays RLS-protected by `org_id`.

---

## New product surfaces (UI)

| Surface | What it is | Signal |
|---------|-----------|--------|
| **Marketing / landing page** (light, optional) | Hero + pricing table + "Start free" CTA | Shows product thinking; gradient-free per design system |
| **Signup → Create org → Onboarding** | 3-step guided setup; deploy first agent in the flow | Activation UX — a real SaaS concern |
| **Billing & Plan page** | Current plan, usage bars vs quota, upgrade (Checkout), manage (Portal) | Stripe integration, usage viz |
| **Team & Invitations** | Invite by email, role per member, pending invites | Multi-seat SaaS table-stakes |
| **Super-admin console** (internal) | List orgs, MRR, usage, impersonate, change plan | Ops maturity; a standout interview piece |

All follow the **no-gradient "Clinical Futurism"** system in doc 04.

---

## Horizontal scale as a SaaS (extends doc 06 §Scalability)

- **Stateless services + queue-backed workers** already scale out per replica; quotas keep per-tenant load bounded.
- **Plan-based isolation tiers:** Pool+RLS for Free/Pro/Clinic; **schema- or DB-per-tenant for Enterprise** (the upsell that removes noisy-neighbor risk).
- **Per-tenant rate limiting & budgets** at the gateway → predictable infra cost as tenant count grows.
- **Metering pipeline** (Redis counters → Postgres reconcile → Stripe meter) is the same pattern real usage-based SaaS (e.g. OpenAI, Vercel) run.
- **Regionalization path** (documented, not built): route orgs to regional DBs for data-residency (a healthcare/GDPR concern) — noted as Enterprise future work.

---

## Build sequencing (folds into doc 08)

SaaS layer is **Phase 2.5** — after the vertical slice proves the product works, before the full fleet, because tenancy/billing shape everything downstream:

1. **Phase 2 (existing):** multi-tenancy + RLS + RBAC + audit — the SaaS *foundation*.
2. **Phase 2.5 (new):** plans + entitlements + Stripe Checkout/Portal + webhooks + usage metering + quotas + billing UI + invitations.
3. **Phase 4+ (existing):** super-admin console + onboarding polish + landing/pricing page.

MVP for "it's a real SaaS": **self-serve signup → create org → land on Free plan → hit a quota → upgrade via Stripe Checkout (test) → quota lifts.** That single flow, demoed live, proves the whole commercial engine.

---

## Interview talking points this unlocks

- "I built usage-based billing with Stripe metered pricing and idempotent webhook reconciliation."
- "Entitlements are data-driven, so adding a plan is a config change, not a deploy of new `if` branches."
- "Per-tenant quotas + budgets are how I keep multi-tenant LLM cost bounded — one tenant can't blow the infra."
- "Enterprise tenants get schema/DB isolation; everyone else shares Pool+RLS — cost-appropriate isolation tiers."
