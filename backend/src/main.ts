import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

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
  // Namjerno `console.error`, ne Logger: ovo se dešava PRIJE nego što je
  // aplikacija spremna (npr. validacija env-a ili baza nedostupna).
  console.error('[gradix] Start nije uspio:');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
