"""Talking to the API gateway.

Everything this service reaches goes through one place (ADR-004, ADR-008): it
holds no database connection, no FHIR credentials, and no patient data of its
own. What it does hold is a service token and a tenant claim, and those have to
be attached to every single call — which is the reason this base class exists
rather than each surface owning its own HTTP client.

`GatewayFhir` and `GatewayDocuments` are the two surfaces. They are separate
classes because they are separate concerns with separate error semantics, and
one class with both would have made `record_message` look like a FHIR
operation, which it never was.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

DEFAULT_API_URL = "http://localhost:8080"


class GatewayError(Exception):
    """The gateway refused or could not serve a request.

    Raised into the agent loop, which turns it into an error `tool_result` the
    model reads and recovers from — so the message is load-bearing, not just
    something for a log. It carries the gateway's own explanation, which in
    turn carries whatever the upstream said.
    """


class GatewayClient:
    """Base for the gateway surfaces: one client, one token, one tenant."""

    def __init__(
        self,
        *,
        tenant_id: str | None = None,
        base_url: str | None = None,
        client: httpx.Client | None = None,
        timeout: float = 30.0,
    ) -> None:
        self.tenant_id = tenant_id
        self.base_url = (base_url or os.environ.get("API_URL") or DEFAULT_API_URL).rstrip("/")
        self._client = client or httpx.Client(timeout=timeout)
        self._owns_client = client is None

    def _headers(self) -> dict[str, str]:
        """Who we are, and whose work this is.

        The token authenticates the *service*; the tenant is a claim the
        gateway scopes RLS to, so a wrong one finds nothing rather than
        finding someone else's.
        """
        headers = {"x-service-token": os.environ.get("SERVICE_TOKEN", "")}
        if self.tenant_id:
            headers["x-tenant-id"] = self.tenant_id
        return headers

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            response = self._client.request(
                method, f"{self.base_url}{path}", headers=self._headers(), **kwargs
            )
        except httpx.HTTPError as exc:
            raise GatewayError(f"could not reach the API gateway: {exc}") from exc

        if response.status_code >= 400:
            raise GatewayError(explain(response))

        return response.json()

    def close(self) -> None:
        # Only if we made it. A caller that passed its own client owns its
        # lifetime, and closing it here would break the next user of it.
        if self._owns_client:
            self._client.close()


def explain(response: httpx.Response) -> str:
    """Turn a gateway error response into a sentence a model can act on.

    Field-level validation issues are flattened into the message rather than
    left in a nested array: the model sees this as one string, and "which
    field" is the part that tells it what to change.
    """
    try:
        body = response.json()
    except ValueError:
        return f"{response.status_code} {response.text[:200]}".strip()

    if not isinstance(body, dict):
        return f"{response.status_code} {body}"

    message = body.get("message") or body.get("error") or f"HTTP {response.status_code}"

    issues = body.get("issues")
    if isinstance(issues, list) and issues:
        detail = "; ".join(
            f"{issue.get('path', '?')}: {issue.get('message', '')}".strip()
            for issue in issues
            if isinstance(issue, dict)
        )
        return f"{message} — {detail}"

    return str(message)
