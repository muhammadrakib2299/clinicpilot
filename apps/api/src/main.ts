import { NestFactory } from "@nestjs/core";
import { WsAdapter } from "@nestjs/platform-ws";
import { AppModule } from "./app.module";
import { parseAllowedOrigins } from "./common/cors";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: parseAllowedOrigins(process.env.WEB_ORIGIN), credentials: true });
  // Native ws rather than socket.io, so the SPA uses the browser's built-in
  // WebSocket and pays nothing in bundle size for live traces.
  app.useWebSocketAdapter(new WsAdapter(app));
  app.setGlobalPrefix("api");
  const port = Number(process.env.API_PORT ?? 8080);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`[clinicpilot-api] listening on http://localhost:${port}/api`);
}
void bootstrap();
