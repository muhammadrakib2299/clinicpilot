"""Safety boundaries that sit between the product and the model (ADR-006)."""

from app.safety.redaction import Redactor

__all__ = ["Redactor"]
