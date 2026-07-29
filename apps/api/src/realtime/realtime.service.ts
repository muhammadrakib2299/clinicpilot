import { Injectable } from "@nestjs/common";
import { Subject } from "rxjs";

export interface TraceStepEvent {
  type: "trace:step";
  taskId: string;
  step: Record<string, unknown>;
}

export interface TaskStatusEvent {
  type: "task:status";
  taskId: string;
  status: string;
  outcome: string | null;
}

export type RealtimeEvent = TraceStepEvent | TaskStatusEvent;

/**
 * In-process event bus between the write path and the WebSocket gateway.
 *
 * A plain rxjs Subject rather than injecting the gateway into TasksService:
 * that direction would be circular, and the service has no business knowing a
 * WebSocket exists. It publishes a domain event; whoever cares, subscribes.
 *
 * Single-process only. Phase 4 runs multiple gateway replicas behind a load
 * balancer, at which point this becomes a Redis pub/sub channel — the seam is
 * here so that swap touches one file.
 */
@Injectable()
export class RealtimeService {
  private readonly subject = new Subject<RealtimeEvent>();

  readonly events$ = this.subject.asObservable();

  publish(event: RealtimeEvent): void {
    this.subject.next(event);
  }
}
