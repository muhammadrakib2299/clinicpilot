import { Global, Module } from "@nestjs/common";

import { RealtimeService } from "./realtime.service";
import { TracesGateway } from "./traces.gateway";

/**
 * Global so the write path can publish without importing this module
 * everywhere. The gateway is the only subscriber.
 */
@Global()
@Module({
  providers: [RealtimeService, TracesGateway],
  exports: [RealtimeService],
})
export class RealtimeModule {}
