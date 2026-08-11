/**
 * Where FHIR lives.
 *
 * Read lazily rather than at module load: the seed script calls
 * `process.loadEnvFile` before it needs this, and a module-scope constant would
 * capture the value from before that ran.
 */
export const DEFAULT_FHIR_BASE_URL = "https://hapi.fhir.org/baseR4";

export function fhirBaseUrl(): string {
  return process.env.FHIR_BASE_URL ?? DEFAULT_FHIR_BASE_URL;
}

/**
 * Business identifiers the seed writes under our own system.
 *
 * Server-assigned ids do not survive the public sandbox being wiped, but
 * `system|value` is ours and does — so this is how anything finds the seeded
 * scenario again. Lives here rather than in the seed script so the runtime can
 * resolve them without importing a module that loads `.env` on import.
 */
export const SEED_SYSTEM = "https://clinicpilot.dev/fhir/seed";

export const SEED_IDENTIFIERS = {
  patient: "patient-nair",
  schedule: "schedule-chen",
  appointment: "appt-current",
} as const;
