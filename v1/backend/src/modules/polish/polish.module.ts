import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { FilesModule } from '../files/files.module';
import { OpsModule } from '../ops/ops.module';
import { TendersController } from './tenders.controller';
import { TendersService } from './tenders.service';
import { ServiceTemplatesController } from './service-templates.controller';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';
import { ServiceCronService } from './service-cron.service';
import { DocsController } from './docs.controller';
import { DocsService } from './docs.service';
import { DocsCronService } from './docs-cron.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { GpsCleanupCronService } from './gps-cleanup.cron';

@Module({
  imports: [NotificationsModule, FilesModule, OpsModule],
  controllers: [
    TendersController,
    ServiceTemplatesController,
    ServicesController,
    DocsController,
    ReportsController,
  ],
  providers: [
    TendersService,
    ServicesService,
    ServiceCronService,
    DocsService,
    DocsCronService,
    ReportsService,
    GpsCleanupCronService,
  ],
})
export class PolishModule {}
