import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import {
  FindAppointmentsQuery,
  FindFreeSlotsQuery,
  RescheduleAppointmentInput,
} from "@clinicpilot/shared-types";

import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { FhirService } from "./fhir.service";

/**
 * The narrow FHIR API the AI service calls instead of speaking FHIR (ADR-008).
 *
 * Mounted under `internal/` alongside the task callbacks, for the same reason:
 * it must not be reachable from the public internet. It reads and writes
 * patient data with no user in the request at all, so the service token that
 * Phase 2 puts in front of `internal/` matters more here than anywhere else in
 * the gateway.
 */
@Controller("internal/fhir")
export class InternalFhirController {
  constructor(private readonly fhir: FhirService) {}

  @Get("appointments")
  findAppointments(
    @Query(new ZodValidationPipe(FindAppointmentsQuery)) query: FindAppointmentsQuery,
  ) {
    return this.fhir.findAppointments(query);
  }

  @Get("slots")
  findFreeSlots(@Query(new ZodValidationPipe(FindFreeSlotsQuery)) query: FindFreeSlotsQuery) {
    return this.fhir.findFreeSlots(query);
  }

  /**
   * Current ids for the seeded demo scenario.
   *
   * Not agent-facing. It exists so the demo CLI can compose "my patient id is
   * X" without holding FHIR identifier knowledge of its own — the sandbox is
   * wiped periodically and those ids change every time it is re-seeded.
   */
  @Get("seeded-scenario")
  seededScenario() {
    return this.fhir.seededScenario();
  }

  /** The one call here that changes the world — traced as `action` upstream. */
  @Post("appointments/reschedule")
  reschedule(
    @Body(new ZodValidationPipe(RescheduleAppointmentInput)) body: RescheduleAppointmentInput,
  ) {
    return this.fhir.reschedule(body);
  }
}
