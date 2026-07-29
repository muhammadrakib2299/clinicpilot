import { describe, expect, it, vi } from "vitest";

import { FhirClient } from "./index";

const BASE = "https://hapi.example.org/fhir";

/** Minimal stand-in for a `fetch` Response — only what FhirClient touches. */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

function makeClient(response: Response, baseUrl = `${BASE}/`) {
  const fetchImpl = vi.fn(async () => response);
  const client = new FhirClient({
    baseUrl,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { client, fetchImpl };
}

describe("FhirClient.readResource", () => {
  it("strips a trailing slash from baseUrl and requests fhir+json", async () => {
    const patient = { resourceType: "Patient", id: "40021" };
    const { client, fetchImpl } = makeClient(jsonResponse(patient));

    await expect(client.readResource("Patient", "40021")).resolves.toEqual(patient);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/Patient/40021`);
    expect(init.headers).toEqual({ Accept: "application/fhir+json" });
  });

  it("throws with the resource and status when the server rejects", async () => {
    const { client } = makeClient(jsonResponse({}, false, 404));

    await expect(client.readResource("Patient", "missing")).rejects.toThrow(
      "FHIR read Patient/missing failed: 404",
    );
  });
});

describe("FhirClient.searchResources", () => {
  it("url-encodes search params into the query string", async () => {
    const bundle = { resourceType: "Bundle", total: 1 };
    const { client, fetchImpl } = makeClient(jsonResponse(bundle));

    await expect(
      client.searchResources("Appointment", { patient: "40021", status: "booked" }),
    ).resolves.toEqual(bundle);

    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe(`${BASE}/Appointment?patient=40021&status=booked`);
  });

  it("escapes reserved characters in param values", async () => {
    const { client, fetchImpl } = makeClient(jsonResponse({}));

    await client.searchResources("Slot", { start: "ge2026-07-06T09:00:00+01:00" });

    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain("start=ge2026-07-06T09%3A00%3A00%2B01%3A00");
  });

  it("throws when the search fails", async () => {
    const { client } = makeClient(jsonResponse({}, false, 500));

    await expect(client.searchResources("Slot", {})).rejects.toThrow(
      "FHIR search Slot failed: 500",
    );
  });
});

describe("FhirClient.writeResource", () => {
  it("POSTs the resource as fhir+json", async () => {
    const appointment = { resourceType: "Appointment", status: "booked" };
    const created = { ...appointment, id: "9f2" };
    const { client, fetchImpl } = makeClient(jsonResponse(created));

    await expect(client.writeResource("Appointment", appointment)).resolves.toEqual(created);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/Appointment`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/fhir+json" });
    expect(JSON.parse(String(init.body))).toEqual(appointment);
  });

  it("throws when the write is rejected", async () => {
    const { client } = makeClient(jsonResponse({}, false, 422));

    await expect(client.writeResource("Appointment", {})).rejects.toThrow(
      "FHIR write Appointment failed: 422",
    );
  });
});
