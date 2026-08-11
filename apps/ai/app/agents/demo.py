"""Drive a Scheduling Agent run and watch it in the Trace Viewer.

    python -m app.agents.demo                 # create the seeded scenario task, then run it
    python -m app.agents.demo <task-id>       # run a task already sitting in the inbox

Thin on purpose. It signs in, creates a task through the gateway, and asks the
AI service to run it — nothing else. The loop, the tools and all FHIR access
live in the service, which is exactly what the queue worker calls; this is a
hand crank for the same machine, not a second implementation of it.

Useful when the worker is not running, or to re-run one task without touching
the queue.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import UTC, datetime

import httpx

from app.env import load_root_env

load_root_env()

API_URL = os.environ.get("API_URL", "http://localhost:8080").rstrip("/")
AI_URL = os.environ.get("AI_URL", "http://localhost:8000").rstrip("/")

# The seeded admin. Every route except /health now needs a session, so even a
# developer script has to hold one — which is the point of Phase 2.
DEMO_EMAIL = os.environ.get("DEMO_EMAIL", "admin@demo.clinicpilot.io")
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "clinicpilot")

# The agent run itself is several model calls long.
RUN_TIMEOUT = 300.0


def sign_in(http: httpx.Client) -> tuple[dict[str, str], str]:
    """Returns the auth header and the active tenant id."""
    response = http.post(
        f"{API_URL}/api/auth/login",
        json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD},
        timeout=30.0,
    )
    if response.status_code == 401:
        raise SystemExit(
            f"Could not sign in as {DEMO_EMAIL}. Run `pnpm db:seed`, or set "
            "DEMO_EMAIL and DEMO_PASSWORD."
        )
    response.raise_for_status()

    body = response.json()
    return {"Authorization": f"Bearer {body['token']}"}, body["user"]["tenantId"]


def seeded_scenario(http: httpx.Client) -> dict:
    """Ask the gateway which ids the seeded scenario has today.

    They change every time the public sandbox is wiped and re-seeded, so they
    are looked up rather than remembered. This is an `internal/` route, so it
    takes the service token rather than the session.
    """
    response = http.get(
        f"{API_URL}/api/internal/fhir/seeded-scenario",
        headers={"x-service-token": os.environ.get("SERVICE_TOKEN", "")},
        timeout=30.0,
    )
    if response.status_code == 401:
        raise SystemExit("SERVICE_TOKEN is missing or wrong — check .env.")
    if response.status_code == 404:
        raise SystemExit("The demo scenario is not seeded — run `pnpm fhir:seed`.")
    response.raise_for_status()
    return response.json()


def create_demo_task(http: httpx.Client, auth: dict[str, str]) -> tuple[str, str]:
    scenario = seeded_scenario(http)

    message = (
        "Hi, I need to move my Thursday appointment to next week. "
        f"My patient id is {scenario['patientId']} and my provider's schedule id is "
        f"{scenario['scheduleId']}. "
        f"Today is {datetime.now(UTC).date().isoformat()}. "
        "Book me into whichever slot is earliest — go ahead and make the change, "
        "then tell me the new time."
    )

    created = http.post(
        f"{API_URL}/api/tasks",
        json={"agentKind": "scheduling", "input": message},
        headers=auth,
        timeout=15.0,
    )
    created.raise_for_status()
    return created.json()["id"], message


def load_task(http: httpx.Client, auth: dict[str, str], task_id: str) -> str:
    response = http.get(f"{API_URL}/api/tasks/{task_id}", headers=auth, timeout=15.0)
    if response.status_code == 404:
        raise SystemExit(f"No task {task_id} in this tenant's inbox.")
    response.raise_for_status()
    return response.json()["task"]["input"]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "task_id",
        nargs="?",
        help="run an existing task instead of creating the seeded demo one",
    )
    args = parser.parse_args(argv)

    with httpx.Client() as http:
        auth, tenant_id = sign_in(http)

        if args.task_id:
            task_id = args.task_id
            message = load_task(http, auth, task_id)
        else:
            task_id, message = create_demo_task(http, auth)

        print(f"tenant  {tenant_id}")
        print(f"task    {task_id}")
        print(f"message {message[:96]}{'…' if len(message) > 96 else ''}")
        print("watch   http://localhost:8081  (open the trace drawer)\n")

        response = http.post(
            f"{AI_URL}/run",
            json={
                "taskId": task_id,
                "tenantId": tenant_id,
                "input": message,
                "agentKind": "scheduling",
            },
            timeout=RUN_TIMEOUT,
        )

        if response.status_code >= 400:
            detail = response.json().get("detail", response.text)
            print(f"failed  {response.status_code} {detail}", file=sys.stderr)
            return 1

        result = response.json()

    print(
        f"outcome {result['outcome']} in {result['iterations']} iterations, {result['steps']} steps"
    )
    print(f"tokens  ↑{result['tokensIn']} ↓{result['tokensOut']}")
    print(f"cost    ${result['costUsd']:.6f}")
    print(f"summary {result['summary']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
