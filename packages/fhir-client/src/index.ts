/**
 * Typed FHIR R4 client and pluggable EHR adapter interface.
 *
 * Scoped to what the scheduling agent needs: read patients and appointments,
 * find free slots, and reschedule with optimistic concurrency. Synthetic data
 * only — this points at the public HAPI sandbox, never at real PHI.
 */

export { FhirClient, bundleResources } from "./client";
export type { EhrAdapter, FhirClientOptions, UpdateOptions } from "./client";
export { FhirConflictError, FhirError } from "./errors";
export type * from "./types";
