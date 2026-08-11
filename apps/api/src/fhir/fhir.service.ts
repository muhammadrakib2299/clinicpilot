import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { FhirClient, FhirConflictError, FhirError } from "@clinicpilot/fhir-client";
import type { Appointment, FhirResource, Slot } from "@clinicpilot/fhir-client";
import type {
  AppointmentSummary,
  FindAppointmentsQuery,
  FindFreeSlotsQuery,
  RescheduleAppointmentInput,
  SlotSummary,
} from "@clinicpilot/shared-types";

import { currentTenantId } from "../common/tenant";
import { SEED_IDENTIFIERS, SEED_SYSTEM } from "./config";

/** DI token, so tests can inject a stub client without a live sandbox. */
export const FHIR_CLIENT = Symbol("FHIR_CLIENT");

/**
 * The gateway's FHIR surface (ADR-008).
 *
 * The AI service used to call HAPI directly from a hand-rolled Python adapter.
 * That put optimistic concurrency in two places and PHI access in two places,
 * and the second implementation had already written a malformed `Slot/Slot/…`
 * reference onto a live appointment. This is the one implementation.
 *
 * Everything returned here is a projection, never a raw R4 resource — see
 * `AppointmentSummary` in shared-types for why.
 */
@Injectable()
export class FhirService {
  private readonly logger = new Logger(FhirService.name);

  constructor(@Inject(FHIR_CLIENT) private readonly fhir: FhirClient) {}

  async findAppointments(query: FindAppointmentsQuery): Promise<AppointmentSummary[]> {
    this.audit("read", `Appointment?patient=${query.patientId}`);

    const appointments = await this.call(() =>
      this.fhir.findAppointments({
        patientId: query.patientId,
        ...(query.status ? { status: query.status } : {}),
        count: query.count,
      }),
    );

    return appointments.filter(hasId).map(toAppointmentSummary);
  }

  async findFreeSlots(query: FindFreeSlotsQuery): Promise<SlotSummary[]> {
    this.audit("read", `Slot?schedule=${query.scheduleId}&status=free`);

    const slots = await this.call(() =>
      this.fhir.findFreeSlots({
        scheduleId: query.scheduleId,
        from: query.from,
        count: query.count,
      }),
    );

    return slots.filter(hasId).map(toSlotSummary);
  }

  /**
   * Move an appointment, refusing to clobber a concurrent edit.
   *
   * The client re-reads the resource and sends its version as a weak-ETag
   * `If-Match`, so a slot taken while the agent was reasoning surfaces as a
   * conflict rather than as a silent overwrite of someone else's booking.
   */
  async reschedule(input: RescheduleAppointmentInput): Promise<AppointmentSummary> {
    this.audit("write", `Appointment/${input.appointmentId} -> ${input.start}`);

    const updated = await this.call(() =>
      this.fhir.rescheduleAppointment({
        appointmentId: input.appointmentId,
        slotId: input.slotId,
        start: input.start,
        end: input.end,
        ...(input.comment ? { comment: input.comment } : {}),
      }),
    );

    if (!hasId(updated)) {
      throw new BadGatewayException("The FHIR server returned an appointment with no id.");
    }

    return toAppointmentSummary(updated);
  }

  /**
   * Resolve the seeded demo scenario to whatever ids it has right now.
   *
   * The sandbox is public and periodically wiped, so `pnpm fhir:seed` recreates
   * everything with fresh server ids. Business identifiers under our own system
   * are the stable handle, and this is the one place that knows them — which is
   * what lets the demo CLI compose its message without speaking FHIR.
   */
  async seededScenario(): Promise<{
    patientId: string;
    scheduleId: string;
    appointmentId: string;
  }> {
    const find = (type: string, value: string) =>
      this.call(() => this.fhir.findByIdentifier<FhirResource>(type, SEED_SYSTEM, value));

    const [patient, schedule, appointment] = await Promise.all([
      find("Patient", SEED_IDENTIFIERS.patient),
      find("Schedule", SEED_IDENTIFIERS.schedule),
      find("Appointment", SEED_IDENTIFIERS.appointment),
    ]);

    if (!patient?.id || !schedule?.id || !appointment?.id) {
      throw new NotFoundException(
        "The demo scenario is not on this FHIR server. Run `pnpm fhir:seed`.",
      );
    }

    return { patientId: patient.id, scheduleId: schedule.id, appointmentId: appointment.id };
  }

  /**
   * Every PHI touch, in one place — which is half the point of ADR-008.
   *
   * A log line is not an audit trail. Phase 2 turns this into an `audit_log`
   * row with the actor once auth exists to say who the actor is; until then the
   * call site is at least instrumented rather than invisible.
   */
  private audit(access: "read" | "write", target: string): void {
    this.logger.log(`fhir ${access} tenant=${currentTenantId()} ${target}`);
  }

  private async call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw toHttpException(error);
    }
  }
}

/**
 * Map a FHIR failure onto a status the caller can act on.
 *
 * The caller is a tool executor feeding an error `tool_result` straight back to
 * the model, so the message matters as much as the code: the live run that
 * recovered from a raw 400 did it by reading the server's own diagnostics,
 * which `FhirError` already carries in its message.
 */
export function toHttpException(error: unknown): HttpException {
  // Conflict first — it extends FhirError.
  if (error instanceof FhirConflictError) {
    return new ConflictException(
      `${error.message}. The appointment changed since it was read — re-read it before trying again.`,
    );
  }

  if (error instanceof FhirError) {
    if (error.status === 404) return new NotFoundException(error.message);
    // A 4xx is the caller's fault and is fixable by the model; a 5xx is the
    // sandbox being the sandbox, and retrying the same request may well work.
    if (error.status < 500) return new BadRequestException(error.message);
    return new BadGatewayException(error.message);
  }

  // No status at all: DNS, TLS, timeout, connection reset. The public HAPI
  // server is flaky often enough that this is a routine path, not an edge case.
  const message = error instanceof Error ? error.message : String(error);
  return new BadGatewayException(`FHIR server unreachable: ${message}`);
}

/**
 * A resource with no id cannot be addressed by a follow-up tool call, so it is
 * dropped from a list rather than handed to the model as something it can act
 * on. Server-read resources always carry one; this guards the type, not a
 * behaviour anyone has seen.
 */
function hasId<T extends { id?: string }>(resource: T): resource is T & { id: string } {
  return typeof resource.id === "string" && resource.id.length > 0;
}

export function toAppointmentSummary(appointment: Appointment & { id: string }): AppointmentSummary {
  return {
    id: appointment.id,
    status: appointment.status,
    start: appointment.start ?? null,
    end: appointment.end ?? null,
    description: appointment.description ?? null,
  };
}

export function toSlotSummary(slot: Slot & { id: string }): SlotSummary {
  return { id: slot.id, start: slot.start, end: slot.end };
}
