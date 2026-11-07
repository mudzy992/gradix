import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { MinioService } from '../../src/modules/files/minio.service';
import { MemoryMinioService } from './minio-memory';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { applyTenantStrict, tenantModelsFromSchema } from './tenant-strict';

export async function createTestApp(): Promise<INestApplication<App>> {
  const builder = Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(MinioService)
    .useClass(MemoryMinioService);
  if (process.env.TENANT_STRICT === '1') {
    builder.overrideProvider(PrismaService).useFactory({
      factory: () =>
        applyTenantStrict(new PrismaService(), tenantModelsFromSchema()),
    });
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<App>();
  configureApp(app);
  await app.init();
  return app;
}
