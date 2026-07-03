import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:5173", credentials: true });
  app.setGlobalPrefix("api");
  const port = Number(process.env.API_PORT ?? 8080);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`[clinicpilot-api] listening on http://localhost:${port}/api`);
}
void bootstrap();
