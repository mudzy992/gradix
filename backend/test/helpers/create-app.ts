import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { MinioService } from '../../src/modules/files/minio.service';
import { MemoryMinioService } from './minio-memory';

export async function createTestApp(): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(MinioService)
    .useClass(MemoryMinioService)
    .compile();
  const app = moduleRef.createNestApplication<App>();
  configureApp(app);
  await app.init();
  return app;
}
