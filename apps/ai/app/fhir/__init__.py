"""How this service gets FHIR data: by asking the gateway (ADR-008)."""

from app.fhir.gateway import GatewayError, GatewayFhir

__all__ = ["GatewayError", "GatewayFhir"]
