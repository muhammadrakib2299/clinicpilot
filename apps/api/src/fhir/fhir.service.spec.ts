import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { FhirClient, FhirConflictError, FhirError } from "@clinicpilot/fhir-client";
import type { Appointment, Slot } from "@clinicpilot/fhir-client";

import { FhirService, toHttpException } from "./fhir.service";

// The service logs every PHI touch; the assertions here are about behaviour.
Logger.overrideLogger(false);

type ClientStub = Partial<Record<keyof FhirClient, jest.Mock>>;

/**
 * Audit writes are fire-and-forget and never throw, so a no-op stub is enough
 * here — `audit.spec.ts` covers that they happen and what they contain.
 */
const auditStub = () => ({ record: jest.fn(), recordSystem: jest.fn() });

const service = (stub: ClientStub) =>
  new FhirService(
    stub as unknown as FhirClient,
    auditStub() as unknown as ConstructorParameters<typeof FhirService>[1],
  );

const appointment = (over: Partial<Appointment> = {}): Appointment => ({
  resourceType: "Appointment",
  id: "137240399",
  status: "booked",
  start: "2026-08-13T14:00:00Z",
  end: "2026-08-13T14:30:00Z",
  description: "Routine follow-up",
  participant: [],
  ...over,
});

const slot = (over: Partial<Slot> = {}): Slot => ({
  resourceType: "Slot",
  id: "137240396",
  schedule: { reference: "Schedule/137240394" },
  status: "free",
  start: "2026-08-18T10:30:00Z",
  end: "2026-08-18T11:00:00Z",
  ...over,
});

describe("FhirService.findAppointments", () => {
  it("projects to the summary the AI service consumes, not the R4 resource", async () => {
    const findAppointments = jest.fn().mockResolvedValue([appointment()]);

    const [found] = await service({ findAppointments }).findAppointments({
      patientId: "137240393",
      count: 20,
    });

    // ADR-008: the AI service speaks no FHIR, so nothing R4-shaped leaks out.
    expect(found).toEqual({
      id: "137240399",
      status: "booked",
      start: "2026-08-13T14:00:00Z",
      end: "2026-08-13T14:30:00Z",
      description: "Routine follow-up",
    });
    expect(found).not.toHaveProperty("participant");
    expect(found).not.toHaveProperty("resourceType");
  });

  it("nulls absent optional fields rather than dropping the keys", async () => {
    const findAppointments = jest
      .fn()
      .mockResolvedValue([appointment({ start: undefined, description: undefined })]);

    const [found] = await service({ findAppointments }).findAppointments({
      patientId: "1",
      count: 20,
    });

    expect(found?.start).toBeNull();
    expect(found?.description).toBeNull();
  });

  it("omits the status filter entirely when the caller did not set one", async () => {
    const findAppointments = jest.fn().mockResolvedValue([]);

    await service({ findAppointments }).findAppointments({ patientId: "1", count: 20 });

    // Passing `status: undefined` would send `status=undefined` to HAPI.
    expect(findAppointments).toHaveBeenCalledWith({ patientId: "1", count: 20 });
  });

  it("forwards a status filter when there is one", async () => {
    const findAppointments = jest.fn().mockResolvedValue([]);

    await service({ findAppointments }).findAppointments({
      patientId: "1",
      status: "booked",
      count: 20,
    });

    expect(findAppointments).toHaveBeenCalledWith({
      patientId: "1",
      status: "booked",
      count: 20,
    });
  });

  it("drops a resource with no id, which no follow-up tool call could address", async () => {
    const findAppointments = jest
      .fn()
      .mockResolvedValue([appointment(), appointment({ id: undefined })]);

    const found = await service({ findAppointments }).findAppointments({
      patientId: "1",
      count: 20,
    });

    expect(found).toHaveLength(1);
  });
});

describe("FhirService.findFreeSlots", () => {
  it("projects slots to id/start/end", async () => {
    const findFreeSlots = jest.fn().mockResolvedValue([slot()]);

    const found = await service({ findFreeSlots }).findFreeSlots({
      scheduleId: "137240394",
      from: "2026-08-14T00:00:00Z",
      count: 10,
    });

    expect(found).toEqual([
      { id: "137240396", start: "2026-08-18T10:30:00Z", end: "2026-08-18T11:00:00Z" },
    ]);
  });

  it("passes the bound through untouched — the client owns the `ge` prefix", async () => {
    const findFreeSlots = jest.fn().mockResolvedValue([]);

    await service({ findFreeSlots }).findFreeSlots({
      scheduleId: "137240394",
      from: "2026-08-14T00:00:00Z",
      count: 10,
    });

    expect(findFreeSlots).toHaveBeenCalledWith({
      scheduleId: "137240394",
      from: "2026-08-14T00:00:00Z",
      count: 10,
    });
  });
});

describe("FhirService.reschedule", () => {
  const input = {
    appointmentId: "137240399",
    slotId: "137240396",
    start: "2026-08-18T10:30:00Z",
    end: "2026-08-18T11:00:00Z",
  };

  it("returns the updated appointment as a summary", async () => {
    const rescheduleAppointment = jest
      .fn()
      .mockResolvedValue(appointment({ start: input.start, end: input.end }));

    const updated = await service({ rescheduleAppointment }).reschedule(input);

    expect(updated.start).toBe(input.start);
    expect(updated.id).toBe("137240399");
  });

  it("omits comment when absent, so it never overwrites one with undefined", async () => {
    const rescheduleAppointment = jest.fn().mockResolvedValue(appointment());

    await service({ rescheduleAppointment }).reschedule(input);

    expect(rescheduleAppointment).toHaveBeenCalledWith(input);
  });

  it("surfaces a concurrent edit as 409 with instructions the model can follow", async () => {
    // The whole point of the optimistic-concurrency path: someone took the slot
    // while the agent was reasoning. Blind retry is the wrong recovery.
    const rescheduleAppointment = jest
      .fn()
      .mockRejectedValue(new FhirConflictError("update Appointment/137240399", 409));

    const failure = service({ rescheduleAppointment }).reschedule(input);

    await expect(failure).rejects.toBeInstanceOf(ConflictException);
    await expect(failure).rejects.toThrow(/re-read it/i);
  });

  it("refuses an appointment the server returned with no id", async () => {
    const rescheduleAppointment = jest.fn().mockResolvedValue(appointment({ id: undefined }));

    await expect(service({ rescheduleAppointment }).reschedule(input)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
});

describe("FhirService.seededScenario", () => {
  const found = (id: string) => ({ resourceType: "Patient", id });

  it("resolves the seeded business identifiers to today's server ids", async () => {
    // Server ids change every time the public sandbox is wiped and re-seeded;
    // `system|value` is ours and does not.
    const findByIdentifier = jest
      .fn()
      .mockResolvedValueOnce(found("137240393"))
      .mockResolvedValueOnce(found("137240394"))
      .mockResolvedValueOnce(found("137240399"));

    const scenario = await service({ findByIdentifier }).seededScenario();

    expect(scenario).toEqual({
      patientId: "137240393",
      scheduleId: "137240394",
      appointmentId: "137240399",
    });
  });

  it("looks each resource up under the ClinicPilot seed system", async () => {
    const findByIdentifier = jest.fn().mockResolvedValue(found("1"));

    await service({ findByIdentifier }).seededScenario();

    expect(findByIdentifier).toHaveBeenCalledWith(
      "Patient",
      "https://clinicpilot.dev/fhir/seed",
      "patient-nair",
    );
  });

  it("says to run the seed rather than returning a half-resolved scenario", async () => {
    const findByIdentifier = jest
      .fn()
      .mockResolvedValueOnce(found("137240393"))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(found("137240399"));

    await expect(service({ findByIdentifier }).seededScenario()).rejects.toThrow(
      /pnpm fhir:seed/,
    );
  });
});

describe("toHttpException", () => {
  it("maps 409 and 412 alike — both mean someone got there first", () => {
    expect(toHttpException(new FhirConflictError("update", 409))).toBeInstanceOf(ConflictException);
    expect(toHttpException(new FhirConflictError("update", 412))).toBeInstanceOf(ConflictException);
  });

  it("maps a missing resource to 404", () => {
    expect(toHttpException(new FhirError("read Appointment/9", 404))).toBeInstanceOf(
      NotFoundException,
    );
  });

  it("maps a rejected request to 400, because the model can fix that itself", () => {
    expect(toHttpException(new FhirError("update Appointment/9", 400))).toBeInstanceOf(
      BadRequestException,
    );
  });

  it("maps an upstream fault to 502, because the caller did nothing wrong", () => {
    expect(toHttpException(new FhirError("search Slot", 503))).toBeInstanceOf(BadGatewayException);
  });

  it("maps a transport failure to 502 — the public sandbox drops connections", () => {
    const failure = toHttpException(new Error("fetch failed"));

    expect(failure).toBeInstanceOf(BadGatewayException);
    expect(failure.message).toContain("fetch failed");
  });

  it("survives something that is not an Error at all", () => {
    expect(toHttpException("kaboom")).toBeInstanceOf(BadGatewayException);
  });

  it("keeps the server's diagnostics in the message the model will read", () => {
    // The one live recovery so far worked because the model could read *why*
    // the write was refused, not just that it was.
    const outcome = {
      resourceType: "OperationOutcome" as const,
      issue: [{ severity: "error" as const, code: "processing", diagnostics: "Invalid slot id" }],
    };

    expect(toHttpException(new FhirError("update Appointment/9", 400, outcome)).message).toContain(
      "Invalid slot id",
    );
  });
});
