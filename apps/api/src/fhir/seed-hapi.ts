import { existsSync } from "node:fs";

import { FhirClient, FhirConflictError } from "@clinicpilot/fhir-client";
import type {
  Appointment,
  FhirResource,
  Practitioner,
  Patient,
  Schedule,
  Slot,
} from "@clinicpilot/fhir-client";

const ROOT_ENV = "../../.env";
if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);

/**
 * Seeds the synthetic scheduling scenario the demo narrates:
 * "move my Thursday appointment to next week."
 *
 * The public HAPI sandbox is shared and periodically wiped, so this must be
 * safe to re-run at any time. Every resource carries a business identifier
 * under our own system; the seed searches for that first and reuses the hit,
 * because server-assigned ids do not survive a wipe but `system|value` does.
 *
 * Synthetic data only. Nothing here is or resembles real PHI.
 */
export const SEED_SYSTEM = "https://clinicpilot.dev/fhir/seed";

const FHIR_BASE_URL = process.env.FHIR_BASE_URL ?? "https://hapi.fhir.org/baseR4";

const THURSDAY = 4;
const TUESDAY = 2;
const WEDNESDAY = 3;

/** Next occurrence of `weekday` strictly after `from`, at the given UTC time. */
export function nextWeekdayUtc(from: Date, weekday: number, hour: number, minute = 0): Date {
  const result = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hour, minute, 0, 0),
  );
  const delta = (weekday - result.getUTCDay() + 7) % 7 || 7;
  result.setUTCDate(result.getUTCDate() + delta);
  return result;
}

export function plusMinutes(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * 60_000);
}

function identifier(value: string) {
  return [{ system: SEED_SYSTEM, value }];
}

/**
 * Upsert by business identifier — create if absent, otherwise overwrite.
 *
 * It genuinely has to overwrite rather than find-and-reuse. Slot and
 * appointment times are computed relative to *now*, so a find-or-create seed
 * would leave last week's dates in place and the demo's "move my Thursday
 * appointment" would quietly refer to a Thursday in the past.
 *
 * Not a conditional create (`If-None-Exist`): HAPI supports it, but doing the
 * search explicitly lets the script report create-vs-refresh, which is the
 * difference between "the sandbox was wiped" and "it wasn't".
 */
async function upsert<T extends FhirResource>(
  client: FhirClient,
  type: string,
  value: string,
  build: () => Omit<T, "id" | "meta">,
): Promise<T> {
  const existing = await client.findByIdentifier<T>(type, SEED_SYSTEM, value);
  if (existing?.id) {
    return refresh(client, type, value, build, existing.id, existing.meta?.versionId);
  }

  try {
    const created = await client.writeResource<T>(type, build());
    console.log(`  create  ${type}/${created.id} (${value})`);
    return created;
  } catch (error) {
    // The shared sandbox intermittently answers a search with an empty
    // searchset even when the resource exists — observed once mid-development,
    // and flagged as a known hazard in the project risk register. HAPI's own
    // duplicate detection then rejects our create with 412. Re-search and
    // refresh rather than failing the whole seed on a transient read.
    if (!(error instanceof FhirConflictError)) throw error;

    const found = await client.findByIdentifier<T>(type, SEED_SYSTEM, value);
    if (!found?.id) throw error;

    console.log(`  (recovered from a transient empty search for ${value})`);
    return refresh(client, type, value, build, found.id, found.meta?.versionId);
  }
}

async function refresh<T extends FhirResource>(
  client: FhirClient,
  type: string,
  value: string,
  build: () => Omit<T, "id" | "meta">,
  id: string,
  versionId?: string,
): Promise<T> {
  const updated = await client.updateResource<T>(
    type,
    id,
    { ...build(), id },
    versionId ? { ifMatchVersion: versionId } : {},
  );
  console.log(`  refresh ${type}/${updated.id} (${value})`);
  return updated;
}

export async function seedHapi(client = new FhirClient({ baseUrl: FHIR_BASE_URL })) {
  const now = new Date();

  const practitioner = await upsert<Practitioner>(client, "Practitioner", "dr-chen", () => ({
    resourceType: "Practitioner",
    identifier: identifier("dr-chen"),
    active: true,
    name: [{ family: "Chen", given: ["Wei"], use: "official" }],
  }));

  const patient = await upsert<Patient>(client, "Patient", "patient-nair", () => ({
    resourceType: "Patient",
    identifier: identifier("patient-nair"),
    active: true,
    name: [{ family: "Nair", given: ["Priya"], use: "official" }],
    gender: "female",
    birthDate: "1987-04-12",
    telecom: [{ system: "sms", value: "+15550100", use: "mobile" }],
  }));

  const schedule = await upsert<Schedule>(client, "Schedule", "schedule-chen", () => ({
    resourceType: "Schedule",
    identifier: identifier("schedule-chen"),
    active: true,
    actor: [{ reference: `Practitioner/${practitioner.id}`, display: "Dr. Wei Chen" }],
    comment: "ClinicPilot synthetic demo schedule",
  }));

  const scheduleRef = { reference: `Schedule/${schedule.id}` };

  // The appointment the patient wants to move: this coming Thursday, 14:00.
  const currentStart = nextWeekdayUtc(now, THURSDAY, 14, 0);
  const busySlot = await upsert<Slot>(client, "Slot", "slot-current", () => ({
    resourceType: "Slot",
    identifier: identifier("slot-current"),
    schedule: scheduleRef,
    status: "busy",
    start: currentStart.toISOString(),
    end: plusMinutes(currentStart, 30).toISOString(),
  }));

  // Where it can move to: the next Tue/Wed/Thu *after* the current appointment,
  // i.e. genuinely "next week" from the patient's point of view. Anchored on
  // the appointment rather than on today, so the three offers stay in the same
  // relative position no matter which day the seed is run.
  const freeSlotSpecs = [
    { value: "slot-free-tue", at: nextWeekdayUtc(currentStart, TUESDAY, 10, 30) },
    { value: "slot-free-wed", at: nextWeekdayUtc(currentStart, WEDNESDAY, 9, 0) },
    { value: "slot-free-thu", at: nextWeekdayUtc(currentStart, THURSDAY, 15, 0) },
  ];

  const freeSlots: Slot[] = [];
  for (const spec of freeSlotSpecs) {
    freeSlots.push(
      await upsert<Slot>(client, "Slot", spec.value, () => ({
        resourceType: "Slot",
        identifier: identifier(spec.value),
        schedule: scheduleRef,
        status: "free",
        start: spec.at.toISOString(),
        end: plusMinutes(spec.at, 30).toISOString(),
      })),
    );
  }

  const appointment = await upsert<Appointment>(client, "Appointment", "appt-current", () => ({
    resourceType: "Appointment",
    identifier: identifier("appt-current"),
    status: "booked",
    description: "Routine follow-up",
    start: currentStart.toISOString(),
    end: plusMinutes(currentStart, 30).toISOString(),
    minutesDuration: 30,
    slot: [{ reference: `Slot/${busySlot.id}` }],
    participant: [
      { actor: { reference: `Patient/${patient.id}`, display: "Priya Nair" }, status: "accepted" },
      {
        actor: { reference: `Practitioner/${practitioner.id}`, display: "Dr. Wei Chen" },
        status: "accepted",
      },
    ],
  }));

  return { practitioner, patient, schedule, busySlot, freeSlots, appointment };
}

if (require.main === module) {
  console.log(`seeding ${FHIR_BASE_URL}\n`);
  seedHapi()
    .then((seeded) => {
      console.log("\nscenario ready:");
      console.log(`  patient      Patient/${seeded.patient.id} — Priya Nair`);
      console.log(`  appointment  Appointment/${seeded.appointment.id} — ${seeded.appointment.start}`);
      console.log(`  schedule     Schedule/${seeded.schedule.id}`);
      console.log(`  free slots   ${seeded.freeSlots.map((s) => s.start).join("\n               ")}`);
      console.log("\ndone — re-running is safe");
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
