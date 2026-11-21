import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { ActivityService } from './activity.service';
import { ActivityController } from './activity.controller';

@Global()
@Module({
  controllers: [ActivityController],
  providers: [AuditService, ActivityService],
  exports: [AuditService],
})
export class AuditModule {}
