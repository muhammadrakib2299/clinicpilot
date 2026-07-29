import { Logger, type OnModuleDestroy } from "@nestjs/common";
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import type { Subscription } from "rxjs";
import type { WebSocket } from "ws";

import { RealtimeService, type RealtimeEvent } from "./realtime.service";

interface SubscribePayload {
  taskId?: unknown;
}

/**
 * Streams agent trace steps to the Trace Viewer as they are written.
 *
 * Native `ws` rather than socket.io: the client is the browser's built-in
 * WebSocket, so the SPA pays nothing in bundle size for this. The cost is that
 * rooms are not provided — the subscription map below is that, explicitly, in
 * about twenty lines.
 */
@WebSocketGateway({ path: "/ws/traces" })
export class TracesGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  private readonly logger = new Logger(TracesGateway.name);

  /** taskId -> sockets watching it. */
  private readonly rooms = new Map<string, Set<WebSocket>>();
  /** Reverse index so disconnect is O(rooms joined), not O(all rooms). */
  private readonly joined = new WeakMap<WebSocket, Set<string>>();

  private readonly subscription: Subscription;

  constructor(private readonly realtime: RealtimeService) {
    this.subscription = this.realtime.events$.subscribe((event) => this.broadcast(event));
  }

  handleConnection(client: WebSocket): void {
    this.joined.set(client, new Set());
  }

  handleDisconnect(client: WebSocket): void {
    for (const taskId of this.joined.get(client) ?? []) {
      const room = this.rooms.get(taskId);
      room?.delete(client);
      // Drop empty rooms or the map grows without bound over a long uptime.
      if (room && room.size === 0) this.rooms.delete(taskId);
    }
    this.joined.delete(client);
  }

  @SubscribeMessage("subscribe")
  handleSubscribe(client: WebSocket, payload: SubscribePayload) {
    const taskId = typeof payload?.taskId === "string" ? payload.taskId : null;
    if (!taskId) {
      return { event: "error", data: { message: "subscribe requires a taskId" } };
    }

    let room = this.rooms.get(taskId);
    if (!room) {
      room = new Set();
      this.rooms.set(taskId, room);
    }
    room.add(client);
    this.joined.get(client)?.add(taskId);

    return { event: "subscribed", data: { taskId } };
  }

  @SubscribeMessage("unsubscribe")
  handleUnsubscribe(client: WebSocket, payload: SubscribePayload) {
    const taskId = typeof payload?.taskId === "string" ? payload.taskId : null;
    if (taskId) {
      this.rooms.get(taskId)?.delete(client);
      this.joined.get(client)?.delete(taskId);
    }
    return { event: "unsubscribed", data: { taskId } };
  }

  private broadcast(event: RealtimeEvent): void {
    const room = this.rooms.get(event.taskId);
    if (!room?.size) return;

    const frame = JSON.stringify({ event: event.type, data: event });

    for (const client of room) {
      // OPEN === 1. A socket closing mid-broadcast would otherwise throw and
      // abort delivery to every client after it in the set.
      if (client.readyState !== 1) continue;
      try {
        client.send(frame);
      } catch (error) {
        this.logger.warn(`dropping trace frame: ${(error as Error).message}`);
      }
    }
  }

  onModuleDestroy(): void {
    this.subscription.unsubscribe();
  }
}
