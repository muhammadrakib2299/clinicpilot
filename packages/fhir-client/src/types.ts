/**
 * The slice of FHIR R4 the scheduling agent actually touches.
 *
 * Deliberately not a generated full-spec type set: R4 has ~150 resources and
 * hundreds of optional fields, and a hand-written subset of the ones we read
 * and write is far easier to review than a megabyte of codegen. Widen it as
 * agents need more, not in anticipation.
 *
 * Spec: https://hl7.org/fhir/R4/
 */

/** Every resource carries a server-assigned id and version metadata. */
export interface FhirResource {
  resourceType: string;
  id?: string;
  meta?: FhirMeta;
}

export interface FhirMeta {
  /** Bumped by the server on every write — the basis of optimistic locking. */
  versionId?: string;
  lastUpdated?: string;
}

/** A relative reference such as `Patient/40021`. */
export interface Reference {
  reference?: string;
  display?: string;
}

export interface Coding {
  system?: string;
  code?: string;
  display?: string;
}

export interface CodeableConcept {
  coding?: Coding[];
  text?: string;
}

/**
 * A business identifier that survives server-assigned ids changing.
 *
 * This is how seeded fixtures stay idempotent: search by
 * `identifier=<system>|<value>` and reuse the hit instead of creating a
 * duplicate, which matters because the public sandbox is periodically wiped
 * and re-seeded from scratch.
 */
export interface Identifier {
  system?: string;
  value?: string;
  use?: string;
}

export interface HumanName {
  use?: string;
  family?: string;
  given?: string[];
  text?: string;
}

export interface ContactPoint {
  system?: "phone" | "fax" | "email" | "pager" | "url" | "sms" | "other";
  value?: string;
  use?: string;
}

export interface Bundle<T extends FhirResource = FhirResource> {
  resourceType: "Bundle";
  type: string;
  /** Absent unless the search was made with `_total`; do not rely on it. */
  total?: number;
  link?: Array<{ relation: string; url: string }>;
  entry?: Array<{ fullUrl?: string; resource?: T }>;
}

export interface Patient extends FhirResource {
  resourceType: "Patient";
  identifier?: Identifier[];
  active?: boolean;
  name?: HumanName[];
  telecom?: ContactPoint[];
  birthDate?: string;
  gender?: "male" | "female" | "other" | "unknown";
}

export interface Practitioner extends FhirResource {
  resourceType: "Practitioner";
  identifier?: Identifier[];
  active?: boolean;
  name?: HumanName[];
}

export interface Schedule extends FhirResource {
  resourceType: "Schedule";
  identifier?: Identifier[];
  active?: boolean;
  actor: Reference[];
  serviceType?: CodeableConcept[];
  comment?: string;
}

export type SlotStatus = "busy" | "free" | "busy-unavailable" | "busy-tentative" | "entered-in-error";

export interface Slot extends FhirResource {
  resourceType: "Slot";
  identifier?: Identifier[];
  schedule: Reference;
  status: SlotStatus;
  /** ISO 8601 instant. */
  start: string;
  end: string;
  serviceType?: CodeableConcept[];
}

export type AppointmentStatus =
  | "proposed"
  | "pending"
  | "booked"
  | "arrived"
  | "fulfilled"
  | "cancelled"
  | "noshow"
  | "entered-in-error"
  | "checked-in"
  | "waitlist";

export interface AppointmentParticipant {
  actor?: Reference;
  type?: CodeableConcept[];
  required?: "required" | "optional" | "information-only";
  status: "accepted" | "declined" | "tentative" | "needs-action";
}

export interface Appointment extends FhirResource {
  resourceType: "Appointment";
  identifier?: Identifier[];
  status: AppointmentStatus;
  start?: string;
  end?: string;
  minutesDuration?: number;
  description?: string;
  comment?: string;
  slot?: Reference[];
  participant: AppointmentParticipant[];
  serviceType?: CodeableConcept[];
}

/** Servers return this instead of the resource when something goes wrong. */
export interface OperationOutcome extends FhirResource {
  resourceType: "OperationOutcome";
  issue: Array<{
    severity: "fatal" | "error" | "warning" | "information";
    code: string;
    diagnostics?: string;
    details?: CodeableConcept;
  }>;
}
