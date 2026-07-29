import type { OperationOutcome } from "./types";

/**
 * A FHIR server rejected the request.
 *
 * Carries the parsed `OperationOutcome` when the server sent one, because its
 * `diagnostics` text is usually the only thing that explains *why* a write was
 * refused — the status code alone rarely is.
 */
export class FhirError extends Error {
  readonly status: number;
  readonly operation: string;
  readonly outcome?: OperationOutcome;

  constructor(operation: string, status: number, outcome?: OperationOutcome) {
    super(`FHIR ${operation} failed: ${status}${FhirError.summarise(outcome)}`);
    this.name = "FhirError";
    this.status = status;
    this.operation = operation;
    this.outcome = outcome;
  }

  private static summarise(outcome?: OperationOutcome): string {
    const diagnostics = outcome?.issue
      ?.map((issue) => issue.diagnostics ?? issue.details?.text ?? issue.code)
      .filter(Boolean)
      .join("; ");

    return diagnostics ? ` — ${diagnostics}` : "";
  }
}

/**
 * The resource changed underneath us between read and write.
 *
 * Raised on 409/412 from a version-aware update. Callers should re-read and
 * decide, never blindly retry: for an appointment, someone else may have taken
 * the slot we were about to book into.
 */
export class FhirConflictError extends FhirError {
  constructor(operation: string, status: number, outcome?: OperationOutcome) {
    super(operation, status, outcome);
    this.name = "FhirConflictError";
  }
}
