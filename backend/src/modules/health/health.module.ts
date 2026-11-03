import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ReadyController } from './ready.controller';
import { HealthService } from './health.service';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [FilesModule],
  controllers: [HealthController, ReadyController],
  providers: [HealthService],
})
export class HealthModule {}
