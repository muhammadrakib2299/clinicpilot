/**
 * Typed FHIR R4 client + pluggable EHR adapter interface.
 * Phase 0: interface + HAPI base wiring. Read/write resources land in Phase 1.
 */

export interface EhrAdapter {
  readResource(type: string, id: string): Promise<unknown>;
  searchResources(type: string, query: Record<string, string>): Promise<unknown>;
  writeResource(type: string, resource: unknown): Promise<unknown>;
}

export interface FhirClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

/** Minimal FHIR R4 client against a HAPI sandbox (synthetic data only). */
export class FhirClient implements EhrAdapter {
  private readonly baseUrl: string;
  private readonly f: typeof fetch;

  constructor(opts: FhirClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.f = opts.fetchImpl ?? fetch;
  }

  async readResource(type: string, id: string): Promise<unknown> {
    const res = await this.f(`${this.baseUrl}/${type}/${id}`, {
      headers: { Accept: "application/fhir+json" },
    });
    if (!res.ok) throw new Error(`FHIR read ${type}/${id} failed: ${res.status}`);
    return res.json();
  }

  async searchResources(type: string, query: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams(query).toString();
    const res = await this.f(`${this.baseUrl}/${type}?${qs}`, {
      headers: { Accept: "application/fhir+json" },
    });
    if (!res.ok) throw new Error(`FHIR search ${type} failed: ${res.status}`);
    return res.json();
  }

  async writeResource(type: string, resource: unknown): Promise<unknown> {
    const res = await this.f(`${this.baseUrl}/${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/fhir+json", Accept: "application/fhir+json" },
      body: JSON.stringify(resource),
    });
    if (!res.ok) throw new Error(`FHIR write ${type} failed: ${res.status}`);
    return res.json();
  }
}
