# n8n workflows

Committed as JSON and loaded with `pnpm n8n:import`. The directory is mounted
read-only into the n8n container at `/workflows`, so the files here are the
source of truth and n8n's own database is a cache of them.

```bash
pnpm n8n:import   # import, activate, restart n8n
pnpm n8n:list     # what n8n currently holds
```

Editing a workflow in the n8n UI at http://localhost:5678 does **not** update
these files — export it back over the top if you change one there.

---

## `follow-up-delivery.json`

Moves drafted follow-up messages to a channel, every five minutes.

```
Every 5 minutes ─┐
                 ├─→ Clinics to sweep ─→ Messages waiting ─→ Simulated carrier ─→ Record delivery
Run now ─────────┘
```

The Follow-up Agent composes an approved template, records it, and stops. Before
this workflow existed the row sat at `drafted` forever — the schema said as much
in a comment, which is the honest version of an unfinished feature but still an
unfinished feature. This is the part that moves it.

### Why it enumerates clinics first

**A scheduled job has no session, and therefore no tenant.** Every tenant-scoped
query in this system runs under row-level security keyed to `app.tenant_id`, and
something has to decide what that value is for a job nobody started.

The two alternatives are both worse. A cross-tenant query would have to bypass
RLS — the one thing ADR-005 exists to prevent. Pasting tenant ids into the
workflow means it silently stops covering a clinic the day someone adds one.

So it asks `internal/tenants` which clinics exist and makes one scoped pass per
clinic. That endpoint is the only deliberately un-scoped query in the system; it
is service-token-only and returns ids and names, nothing else.

### The carrier is a stand-in, and says so

`Simulated carrier` is a Set node. There is no Twilio account attached to this
project, and an untested carrier integration is worth less than an honest seam —
the same call ADR-003 made about an OpenAI fallback and ADR-009 made about a
second embedding vendor, for the third time.

What makes it honest rather than a fake: **the channel is recorded on the row.**
`messages.delivery_channel` says `simulated`, so `sent` is a statement about what
happened rather than an implication that somebody received a text. Replacing this
node with a real SMS node is the entire change — the callback already accepts any
channel name, and already accepts `failed` with a reason.

### What it does about running twice

`Record delivery` continues on error instead of stopping the run. The gateway
refuses the update unless the message is still `drafted`, so an overlapping sweep
gets a 409 rather than sending a patient the same message twice. n8n will start a
second pass while the first is still going if a pass runs long, which makes this
the expected case rather than the paranoid one.

A `failed` message is not retried on the timer. The failures a channel produces
are mostly ones that will happen again — a number that does not exist, a patient
who has opted out — and a five-minute retry turns one bad row into a permanent
alarm. It stays visible with its error for a person to act on.

### Verified

Run against a live stack on 2026-08-12: two clinics enumerated, three drafted
messages delivered (one of them Riverside's, which is what proves the per-tenant
loop), `message.sent` audit entries written with the channel, and a second sweep
that correctly did nothing.

---

## Notes for anyone extending these

- **Give every workflow a fixed `id`.** Without one, each import creates another
  copy under the same name instead of updating the existing one. The import
  script refuses a workflow that has no id, because the failure is otherwise
  invisible until you have four.
- **Activation needs a restart.** n8n registers schedule triggers at startup and
  will tell you so. `pnpm n8n:import` does the restart for you.
- **`$env` is enabled deliberately.** n8n 2.x blocks it inside nodes by default;
  the compose file turns it back on so workflows can read `CLINICPILOT_API_URL`
  and `SERVICE_TOKEN`. The reasoning, and when to switch to n8n credentials
  instead, is in a comment in `infra/docker-compose.yml`.
- **The API URL differs between the two ways of running this.** Containerised, it
  is `http://api:8080`. With the API on the host (`pnpm up:infra` + `pnpm api`),
  set `N8N_CLINICPILOT_API_URL=http://host.docker.internal:8080` in `.env`.
