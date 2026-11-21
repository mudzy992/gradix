import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { JsonLogger } from './common/logging/json-logger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  // Graceful shutdown: Coolify šalje SIGTERM pri blue/green deployu. Bez ovoga
  // Prisma veze i Socket.IO konekcije ostaju visjeti do kill-a.
  app.enableShutdownHooks();
  const port = Number(app.get(ConfigService).get('PORT') ?? 3000);
  await app.listen(port);
}

bootstrap().catch((error: unknown) => {
  // INF-04: i ovaj zapis je JSON red (Coolify ga parsira kao i ostale). Logger se pravi ručno
  // jer aplikacija još nije podignuta (npr. pad validacije env-a ili nedostupna baza).
  const logger = new JsonLogger();
  logger.error(
    'Start nije uspio',
    error instanceof Error ? error.stack : undefined,
    'Bootstrap',
  );
  logger.write('error', 'Start nije uspio', 'Bootstrap', {
    reason: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
