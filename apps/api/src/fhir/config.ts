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
