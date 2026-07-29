import { FhirConflictError, FhirError } from "./errors";
import type {
  Appointment,
  AppointmentStatus,
  Bundle,
  FhirResource,
  OperationOutcome,
  Slot,
} from "./types";

const FHIR_JSON = "application/fhir+json";

/** Pluggable EHR seam — a Cerner or Epic adapter implements the same shape. */
export interface EhrAdapter {
  readResource<T extends FhirResource>(type: string, id: string): Promise<T>;
  searchResources<T extends FhirResource>(
    type: string,
    query: Record<string, string>,
  ): Promise<Bundle<T>>;
  writeResource<T extends FhirResource>(type: string, resource: unknown): Promise<T>;
}

export interface FhirClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** Bearer token for SMART-on-FHIR servers. The HAPI sandbox needs none. */
  accessToken?: string;
}

export interface UpdateOptions {
  /**
   * The `meta.versionId` the caller read. Sent as a weak ETag `If-Match`, so
   * the server rejects the write if anyone else changed the resource first.
   */
  ifMatchVersion?: string;
}

/** Flattens a search Bundle, dropping entries the server returned without one. */
export function bundleResources<T extends FhirResource>(bundle: Bundle<T>): T[] {
  return (bundle.entry ?? [])
    .map((entry) => entry.resource)
    .filter((resource): resource is T => resource !== undefined);
}

/** FHIR R4 client against a HAPI sandbox. Synthetic data only — no real PHI. */
export class FhirClient implements EhrAdapter {
  private readonly baseUrl: string;
  private readonly f: typeof fetch;
  private readonly accessToken?: string;

  constructor(opts: FhirClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.f = opts.fetchImpl ?? fetch;
    this.accessToken = opts.accessToken;
  }

  async readResource<T extends FhirResource>(type: string, id: string): Promise<T> {
    return this.request<T>(`read ${type}/${id}`, `/${type}/${id}`, {
      headers: { Accept: FHIR_JSON },
    });
  }

  async searchResources<T extends FhirResource>(
    type: string,
    query: Record<string, string>,
  ): Promise<Bundle<T>> {
    const qs = new URLSearchParams(query).toString();
    return this.request<Bundle<T>>(`search ${type}`, `/${type}?${qs}`, {
      headers: { Accept: FHIR_JSON },
    });
  }

  async writeResource<T extends FhirResource>(type: string, resource: unknown): Promise<T> {
    return this.request<T>(`write ${type}`, `/${type}`, {
      method: "POST",
      headers: { "Content-Type": FHIR_JSON, Accept: FHIR_JSON },
      body: JSON.stringify(resource),
    });
  }

  /**
   * Replace a resource by id.
   *
   * Pass `ifMatchVersion` for anything that another actor could be changing
   * concurrently. Without it this is last-write-wins, which for appointments
   * means silently overwriting a booking someone else just made.
   */
  async updateResource<T extends FhirResource>(
    type: string,
    id: string,
    resource: unknown,
    options: UpdateOptions = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": FHIR_JSON,
      Accept: FHIR_JSON,
    };

    if (options.ifMatchVersion !== undefined) {
      // FHIR mandates the weak-ETag form; a bare version number is rejected.
      headers["If-Match"] = `W/"${options.ifMatchVersion}"`;
    }

    return this.request<T>(`update ${type}/${id}`, `/${type}/${id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(resource),
    });
  }

  // ── Scheduling-agent helpers ──────────────────────────────────────────────

  /**
   * Look a resource up by business identifier rather than server id.
   *
   * The basis of idempotent seeding: server ids are assigned fresh every time
   * the sandbox is wiped, but `system|value` is ours and stable, so a re-run
   * finds what it created last time instead of duplicating it.
   *
   * Returns the first match. A well-formed identifier should be unique, but
   * the spec does not enforce it and the sandbox is shared, so callers get
   * "one of them" rather than a guarantee.
   */
  async findByIdentifier<T extends FhirResource>(
    type: string,
    system: string,
    value: string,
  ): Promise<T | undefined> {
    const bundle = await this.searchResources<T>(type, {
      identifier: `${system}|${value}`,
      _count: "1",
    });

    return bundleResources(bundle)[0];
  }

  /** Appointments for a patient, newest first, optionally filtered by status. */
  async findAppointments(params: {
    patientId: string;
    status?: AppointmentStatus;
    count?: number;
  }): Promise<Appointment[]> {
    const query: Record<string, string> = {
      patient: `Patient/${params.patientId}`,
      _sort: "-date",
      _count: String(params.count ?? 20),
    };
    if (params.status) query["status"] = params.status;

    return bundleResources(await this.searchResources<Appointment>("Appointment", query));
  }

  /**
   * Free slots on a schedule from `from` onwards.
   *
   * `from` is sent as a `ge` prefixed search parameter — FHIR's way of saying
   * "greater than or equal" — and must be URL-encoded, which URLSearchParams
   * handles. A raw `+` in the timezone offset would otherwise decode as a space
   * and the server would return everything.
   */
  async findFreeSlots(params: {
    scheduleId: string;
    from: string;
    count?: number;
  }): Promise<Slot[]> {
    const query: Record<string, string> = {
      schedule: `Schedule/${params.scheduleId}`,
      status: "free",
      start: `ge${params.from}`,
      _sort: "start",
      _count: String(params.count ?? 10),
    };

    return bundleResources(await this.searchResources<Slot>("Slot", query));
  }

  /**
   * Move an appointment to a new time, refusing to clobber a concurrent edit.
   *
   * Reads the current version first rather than trusting a caller-held copy:
   * the agent may have been reasoning for several seconds since it looked.
   */
  async rescheduleAppointment(params: {
    appointmentId: string;
    start: string;
    end: string;
    slotId?: string;
    comment?: string;
  }): Promise<Appointment> {
    const current = await this.readResource<Appointment>("Appointment", params.appointmentId);

    const updated: Appointment = {
      ...current,
      status: "booked",
      start: params.start,
      end: params.end,
      ...(params.slotId ? { slot: [{ reference: `Slot/${params.slotId}` }] } : {}),
      ...(params.comment ? { comment: params.comment } : {}),
    };

    return this.updateResource<Appointment>("Appointment", params.appointmentId, updated, {
      ...(current.meta?.versionId ? { ifMatchVersion: current.meta.versionId } : {}),
    });
  }

  // ── Transport ─────────────────────────────────────────────────────────────

  private async request<T>(
    operation: string,
    path: string,
    init: RequestInit & { headers: Record<string, string> },
  ): Promise<T> {
    const headers = { ...init.headers };
    if (this.accessToken) headers["Authorization"] = `Bearer ${this.accessToken}`;

    const res = await this.f(`${this.baseUrl}${path}`, { ...init, headers });

    if (!res.ok) {
      const outcome = await readOperationOutcome(res);
      // 409 Conflict and 412 Precondition Failed both mean "someone else got
      // there first" — the caller must re-read, not retry the same write.
      const Ctor = res.status === 409 || res.status === 412 ? FhirConflictError : FhirError;
      throw new Ctor(operation, res.status, outcome);
    }

    return (await res.json()) as T;
  }
}

/** Servers sometimes send HTML or an empty body on error; never let that throw. */
async function readOperationOutcome(res: Response): Promise<OperationOutcome | undefined> {
  try {
    const body = (await res.json()) as OperationOutcome;
    return body?.resourceType === "OperationOutcome" ? body : undefined;
  } catch {
    return undefined;
  }
}
