"""Run the Scheduling Agent against the seeded scenario, streaming to the UI.

    python -m app.agents.demo

Creates a real task through the gateway, runs the tool-use loop, and posts every
step back so the Trace Viewer renders it live. Open http://localhost:8081 and
watch while this runs.

The FHIR executor here calls HAPI directly. ADR-008 says that belongs behind the
gateway; those endpoints are not built yet, so this is the interim path and is
deliberately confined to the demo entrypoint rather than the agent package.
"""

from __future__ import annotations

import os
import sys
from datetime import UTC, date, datetime

import httpx

from app.agents.gateway_sink import GatewayTraceSink
from app.agents.loop import run_agent
from app.agents.scheduling import SCHEDULING_TOOLS, SYSTEM_PROMPT
from app.fhir.ids import bare_id, reference
from app.llm.anthropic_provider import AnthropicProvider
from app.llm.provider import ToolCall

API_URL = os.environ.get("API_URL", "http://localhost:8080").rstrip("/")
FHIR = os.environ.get("FHIR_BASE_URL", "https://hapi.fhir.org/baseR4").rstrip("/")
SEED = "https://clinicpilot.dev/fhir/seed"
JSON = "application/fhir+json"

http = httpx.Client(timeout=30.0, headers={"Accept": JSON})


def seeded(resource_type: str, value: str) -> dict:
    res = http.get(
        f"{FHIR}/{resource_type}",
        params={"identifier": f"{SEED}|{value}", "_count": "1"},
    )
    res.raise_for_status()
    entries = res.json().get("entry") or []
    if not entries:
        raise SystemExit(f"{resource_type} '{value}' is not seeded — run `pnpm fhir:seed`")
    return entries[0]["resource"]


def execute(call: ToolCall) -> str:
    args = call.arguments

    if call.name == "find_appointments":
        params = {
            "patient": reference("Patient", str(args["patient_id"])),
            "_sort": "-date",
            "_count": "20",
        }
        if args.get("status"):
            params["status"] = str(args["status"])
        res = http.get(f"{FHIR}/Appointment", params=params)
        res.raise_for_status()
        found = [e["resource"] for e in (res.json().get("entry") or [])]
        if not found:
            return "No appointments found for that patient."
        return "\n".join(
            f"Appointment/{a['id']}: {a.get('start')} to {a.get('end')} "
            f"status={a.get('status')} desc={a.get('description', '')}"
            for a in found
        )

    if call.name == "find_availability":
        res = http.get(
            f"{FHIR}/Slot",
            params={
                "schedule": reference("Schedule", str(args["schedule_id"])),
                "status": "free",
                "start": f"ge{args['from_instant']}",
                "_sort": "start",
                "_count": str(args.get("limit", 10)),
            },
        )
        res.raise_for_status()
        slots = [e["resource"] for e in (res.json().get("entry") or [])]
        if not slots:
            return "No free slots on that schedule."
        return "\n".join(f"Slot/{s['id']}: {s['start']} to {s['end']}" for s in slots)

    if call.name == "reschedule_appointment":
        appointment_id = bare_id(str(args["appointment_id"]))
        current = http.get(f"{FHIR}/Appointment/{appointment_id}")
        current.raise_for_status()
        appointment = current.json()
        version = (appointment.get("meta") or {}).get("versionId")

        appointment.update(
            status="booked",
            start=args["start"],
            end=args["end"],
            slot=[{"reference": reference("Slot", str(args["slot_id"]))}],
        )
        headers = {"Content-Type": JSON, "Accept": JSON}
        if version:
            headers["If-Match"] = f'W/"{version}"'

        put = http.put(f"{FHIR}/Appointment/{appointment_id}", json=appointment, headers=headers)
        if put.status_code in (409, 412):
            return "Conflict: the appointment changed while you were deciding. Re-read it."
        put.raise_for_status()
        saved = put.json()
        return f"Rescheduled Appointment/{saved['id']} to {saved['start']}."

    return f"Unknown tool {call.name}"


def main() -> int:
    patient = seeded("Patient", "patient-nair")
    schedule = seeded("Schedule", "schedule-chen")

    message = (
        "Hi, I need to move my Thursday appointment to next week. "
        f"My patient id is {patient['id']} and my provider's schedule id is {schedule['id']}. "
        f"Today is {datetime.now(UTC).date().isoformat()}. "
        "Book me into whichever slot is earliest — go ahead and make the change, "
        "then tell me the new time."
    )

    created = httpx.post(
        f"{API_URL}/api/tasks",
        json={"agentKind": "scheduling", "input": message},
        timeout=15.0,
    )
    created.raise_for_status()
    task_id = created.json()["id"]

    print(f"task    {task_id}")
    print("watch   http://localhost:8081  (open the trace drawer)\n")

    sink = GatewayTraceSink(task_id, base_url=API_URL)
    sink.mark_running()

    try:
        result = run_agent(
            provider=AnthropicProvider(),
            system=SYSTEM_PROMPT,
            task=message,
            tools=SCHEDULING_TOOLS,
            execute=execute,
            on_step=sink,
            priced_on=date.today(),
        )
        sink.complete(result.outcome, result.summary)
    finally:
        sink.close()

    print(f"outcome {result.outcome} in {result.iterations} iterations, {result.steps} steps")
    print(f"cost    ${result.cost_usd:.6f}")
    print(f"summary {result.summary}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
