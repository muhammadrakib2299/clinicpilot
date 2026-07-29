import { describe, expect, it, vi } from "vitest";

import { FhirClient, bundleResources } from "./client";
import { FhirConflictError, FhirError } from "./errors";
import type { Appointment, Bundle, OperationOutcome, Slot } from "./types";

const BASE = "https://hapi.example.org/fhir";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

/** A response whose body is not JSON at all — proxies and gateways do this. */
function brokenResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON");
    },
  } as unknown as Response;
}

function makeClient(responses: Response[], baseUrl = `${BASE}/`, accessToken?: string) {
  const fetchImpl = vi.fn();
  for (const response of responses) fetchImpl.mockResolvedValueOnce(response);

  const client = new FhirClient({
    baseUrl,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...(accessToken ? { accessToken } : {}),
  });
  return { client, fetchImpl };
}

function callArgs(fetchImpl: ReturnType<typeof vi.fn>, index = 0) {
  return fetchImpl.mock.calls[index] as unknown as [string, RequestInit];
}

describe("readResource", () => {
  it("strips a trailing slash from baseUrl and requests fhir+json", async () => {
    const patient = { resourceType: "Patient", id: "40021" };
    const { client, fetchImpl } = makeClient([jsonResponse(patient)]);

    await expect(client.readResource("Patient", "40021")).resolves.toEqual(patient);

    const [url, init] = callArgs(fetchImpl);
    expect(url).toBe(`${BASE}/Patient/40021`);
    expect(init.headers).toEqual({ Accept: "application/fhir+json" });
  });

  it("throws with the resource and status when the server rejects", async () => {
    const { client } = makeClient([jsonResponse({}, false, 404)]);

    await expect(client.readResource("Patient", "missing")).rejects.toThrow(
      "FHIR read Patient/missing failed: 404",
    );
  });
});

describe("searchResources", () => {
  it("url-encodes search params into the query string", async () => {
    const bundle: Bundle = { resourceType: "Bundle", type: "searchset", total: 1 };
    const { client, fetchImpl } = makeClient([jsonResponse(bundle)]);

    await expect(
      client.searchResources("Appointment", { patient: "40021", status: "booked" }),
    ).resolves.toEqual(bundle);

    expect(callArgs(fetchImpl)[0]).toBe(`${BASE}/Appointment?patient=40021&status=booked`);
  });

  it("escapes reserved characters in param values", async () => {
    const { client, fetchImpl } = makeClient([jsonResponse({})]);

    await client.searchResources("Slot", { start: "ge2026-07-06T09:00:00+01:00" });

    // An unescaped `+` would decode as a space and the server would ignore the
    // lower bound entirely, quietly returning every slot it has.
    expect(callArgs(fetchImpl)[0]).toContain("start=ge2026-07-06T09%3A00%3A00%2B01%3A00");
  });

  it("throws when the search fails", async () => {
    const { client } = makeClient([jsonResponse({}, false, 500)]);

    await expect(client.searchResources("Slot", {})).rejects.toThrow(
      "FHIR search Slot failed: 500",
    );
  });
});

describe("writeResource", () => {
  it("POSTs the resource as fhir+json", async () => {
    const appointment = { resourceType: "Appointment", status: "booked" };
    const created = { ...appointment, id: "9f2" };
    const { client, fetchImpl } = makeClient([jsonResponse(created)]);

    await expect(client.writeResource("Appointment", appointment)).resolves.toEqual(created);

    const [url, init] = callArgs(fetchImpl);
    expect(url).toBe(`${BASE}/Appointment`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/fhir+json" });
    expect(JSON.parse(String(init.body))).toEqual(appointment);
  });

  it("throws when the write is rejected", async () => {
    const { client } = makeClient([jsonResponse({}, false, 422)]);

    await expect(client.writeResource("Appointment", {})).rejects.toThrow(
      "FHIR write Appointment failed: 422",
    );
  });
});

describe("updateResource", () => {
  it("sends the version as a weak ETag If-Match", async () => {
    const { client, fetchImpl } = makeClient([jsonResponse({ resourceType: "Appointment" })]);

    await client.updateResource("Appointment", "9f2", {}, { ifMatchVersion: "3" });

    const [url, init] = callArgs(fetchImpl);
    expect(url).toBe(`${BASE}/Appointment/9f2`);
    expect(init.method).toBe("PUT");
    // The weak form is mandated by the spec; a bare "3" is rejected.
    expect(init.headers).toMatchObject({ "If-Match": 'W/"3"' });
  });

  it("omits If-Match when no version is supplied", async () => {
    const { client, fetchImpl } = makeClient([jsonResponse({ resourceType: "Appointment" })]);

    await client.updateResource("Appointment", "9f2", {});

    expect(callArgs(fetchImpl)[1].headers).not.toHaveProperty("If-Match");
  });

  it.each([409, 412])("raises a conflict error on %i", async (status) => {
    const { client } = makeClient([jsonResponse({}, false, status)]);

    const promise = client.updateResource("Appointment", "9f2", {}, { ifMatchVersion: "1" });

    await expect(promise).rejects.toBeInstanceOf(FhirConflictError);
  });

  it("raises a plain FhirError for other failures", async () => {
    const { client } = makeClient([jsonResponse({}, false, 500)]);

    const promise = client.updateResource("Appointment", "9f2", {});

    await expect(promise).rejects.toBeInstanceOf(FhirError);
    await expect(promise).rejects.not.toBeInstanceOf(FhirConflictError);
  });
});

describe("error reporting", () => {
  it("surfaces OperationOutcome diagnostics in the message", async () => {
    const outcome: OperationOutcome = {
      resourceType: "OperationOutcome",
      issue: [{ severity: "error", code: "processing", diagnostics: "Slot is already taken" }],
    };
    const { client } = makeClient([jsonResponse(outcome, false, 409)]);

    // The status alone never explains *why* a write was refused.
    await expect(client.updateResource("Appointment", "9f2", {})).rejects.toThrow(
      "Slot is already taken",
    );
  });

  it("still throws a usable error when the body is not JSON", async () => {
    const { client } = makeClient([brokenResponse(502)]);

    await expect(client.readResource("Patient", "1")).rejects.toThrow(
      "FHIR read Patient/1 failed: 502",
    );
  });

  it("keeps the status and outcome on the error object", async () => {
    const outcome: OperationOutcome = {
      resourceType: "OperationOutcome",
      issue: [{ severity: "error", code: "not-found" }],
    };
    const { client } = makeClient([jsonResponse(outcome, false, 404)]);

    await client.readResource("Patient", "1").catch((error: FhirError) => {
      expect(error.status).toBe(404);
      expect(error.outcome?.issue[0]?.code).toBe("not-found");
    });
    expect.assertions(2);
  });
});

describe("auth", () => {
  it("sends a bearer token when configured", async () => {
    const { client, fetchImpl } = makeClient([jsonResponse({})], `${BASE}/`, "tok_123");

    await client.readResource("Patient", "1");

    expect(callArgs(fetchImpl)[1].headers).toMatchObject({ Authorization: "Bearer tok_123" });
  });

  it("sends no Authorization header when unconfigured (the HAPI sandbox is open)", async () => {
    const { client, fetchImpl } = makeClient([jsonResponse({})]);

    await client.readResource("Patient", "1");

    expect(callArgs(fetchImpl)[1].headers).not.toHaveProperty("Authorization");
  });
});

describe("bundleResources", () => {
  it("flattens entries to resources", () => {
    const bundle: Bundle<Slot> = {
      resourceType: "Bundle",
      type: "searchset",
      entry: [
        { resource: { resourceType: "Slot", id: "a" } as Slot },
        { resource: { resourceType: "Slot", id: "b" } as Slot },
      ],
    };

    expect(bundleResources(bundle).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("drops entries the server returned without a resource", () => {
    // Search bundles can carry OperationOutcome-only entries for warnings.
    const bundle: Bundle<Slot> = {
      resourceType: "Bundle",
      type: "searchset",
      entry: [{ fullUrl: "x" }, { resource: { resourceType: "Slot", id: "a" } as Slot }],
    };

    expect(bundleResources(bundle)).toHaveLength(1);
  });

  it("treats a bundle with no entries as empty", () => {
    expect(bundleResources({ resourceType: "Bundle", type: "searchset" })).toEqual([]);
  });
});

describe("findAppointments", () => {
  it("queries by patient reference, newest first", async () => {
    const bundle: Bundle<Appointment> = { resourceType: "Bundle", type: "searchset", entry: [] };
    const { client, fetchImpl } = makeClient([jsonResponse(bundle)]);

    await client.findAppointments({ patientId: "40021", status: "booked" });

    const url = callArgs(fetchImpl)[0];
    expect(url).toContain("patient=Patient%2F40021");
    expect(url).toContain("status=booked");
    expect(url).toContain("_sort=-date");
  });

  it("omits the status filter when none is given", async () => {
    const { client, fetchImpl } = makeClient([
      jsonResponse({ resourceType: "Bundle", type: "searchset" }),
    ]);

    await client.findAppointments({ patientId: "40021" });

    expect(callArgs(fetchImpl)[0]).not.toContain("status=");
  });
});

describe("findFreeSlots", () => {
  it("asks only for free slots at or after the given instant", async () => {
    const { client, fetchImpl } = makeClient([
      jsonResponse({ resourceType: "Bundle", type: "searchset" }),
    ]);

    await client.findFreeSlots({ scheduleId: "prov-7", from: "2026-07-06T09:00:00Z" });

    const url = callArgs(fetchImpl)[0];
    expect(url).toContain("schedule=Schedule%2Fprov-7");
    expect(url).toContain("status=free");
    expect(url).toContain("start=ge2026-07-06T09%3A00%3A00Z");
    expect(url).toContain("_sort=start");
  });
});

describe("rescheduleAppointment", () => {
  const existing: Appointment = {
    resourceType: "Appointment",
    id: "9f2",
    meta: { versionId: "4" },
    status: "booked",
    start: "2026-07-02T14:00:00Z",
    end: "2026-07-02T14:30:00Z",
    participant: [{ actor: { reference: "Patient/40021" }, status: "accepted" }],
  };

  it("re-reads the current version, then writes with that version as If-Match", async () => {
    const { client, fetchImpl } = makeClient([
      jsonResponse(existing),
      jsonResponse({ ...existing, meta: { versionId: "5" } }),
    ]);

    await client.rescheduleAppointment({
      appointmentId: "9f2",
      start: "2026-07-07T10:30:00Z",
      end: "2026-07-07T11:00:00Z",
      slotId: "slot-88",
    });

    // The version comes from the read we just did, not from a caller-held copy
    // that may be seconds stale after the agent finished reasoning.
    const [, put] = callArgs(fetchImpl, 1);
    expect(put.method).toBe("PUT");
    expect(put.headers).toMatchObject({ "If-Match": 'W/"4"' });

    const body = JSON.parse(String(put.body)) as Appointment;
    expect(body.start).toBe("2026-07-07T10:30:00Z");
    expect(body.end).toBe("2026-07-07T11:00:00Z");
    expect(body.slot).toEqual([{ reference: "Slot/slot-88" }]);
  });

  it("preserves fields it was not asked to change", async () => {
    const { client, fetchImpl } = makeClient([jsonResponse(existing), jsonResponse(existing)]);

    await client.rescheduleAppointment({
      appointmentId: "9f2",
      start: "2026-07-07T10:30:00Z",
      end: "2026-07-07T11:00:00Z",
    });

    const body = JSON.parse(String(callArgs(fetchImpl, 1)[1].body)) as Appointment;
    expect(body.participant).toEqual(existing.participant);
    expect(body.id).toBe("9f2");
  });

  it("skips If-Match when the server returned no version", async () => {
    const unversioned = { ...existing, meta: undefined };
    const { client, fetchImpl } = makeClient([jsonResponse(unversioned), jsonResponse(unversioned)]);

    await client.rescheduleAppointment({
      appointmentId: "9f2",
      start: "2026-07-07T10:30:00Z",
      end: "2026-07-07T11:00:00Z",
    });

    expect(callArgs(fetchImpl, 1)[1].headers).not.toHaveProperty("If-Match");
  });

  it("raises a conflict when someone else took the slot first", async () => {
    const { client } = makeClient([jsonResponse(existing), jsonResponse({}, false, 409)]);

    const promise = client.rescheduleAppointment({
      appointmentId: "9f2",
      start: "2026-07-07T10:30:00Z",
      end: "2026-07-07T11:00:00Z",
    });

    await expect(promise).rejects.toBeInstanceOf(FhirConflictError);
  });
});
