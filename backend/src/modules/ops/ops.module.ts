import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectAccessService } from './project-access.service';
import { ProjectsService } from './projects.service';
import { PhasesService } from './phases.service';
import { AssignmentsService } from './assignments.service';
import { DocumentsService } from './documents.service';
import { QuantitiesService } from './quantities.service';
import { TasksService } from './tasks.service';
import { TaskAssigneesService } from './task-assignees.service';
import { TaskDependenciesService } from './task-dependencies.service';
import { TaskLifecycleService } from './task-lifecycle.service';
import { TimerService } from './timer.service';
import { TimerForceCloseService } from './timer-force-close.service';
import { TimerCronService } from './timer-cron.service';
import { AmendmentsService } from './amendments.service';
import { ProjectsController } from './projects.controller';
import { ProjectNestedController } from './project-nested.controller';
import { QuantitiesController } from './quantities.controller';
import { TasksController } from './tasks.controller';
import { TimerController } from './timer.controller';
import { AmendmentsController } from './amendments.controller';
import { MachinesController } from './machines.controller';
import { TripsController } from './trips.controller';
import { FuelController } from './fuel.controller';
import { MaterialsController } from './catalog.controller';
import { DepotsController } from './depots.controller';
import { LocationsController } from './locations.controller';
import { IotController } from './iot.controller';
import { MachineDevicesController } from './machine-devices.controller';
import { DashboardController } from './dashboard.controller';
import { DocumentAlertsController } from './document-alerts.controller';
import { DocumentAlertsService } from './dashboard-document-alerts.service';
import { TaskMetricsController } from './task-metrics.controller';
import { TimerMetricsController } from './timer-metrics.controller';
import { TimerMetricsService } from './dashboard-timer-metrics.service';
import { TaskCreationMetricsService } from './dashboard-task-metrics.service';
import { DiaryController } from './diary.controller';
import { SyncController } from './sync.controller';
import { IncidentsController } from './incidents.controller';
import { MachinesService } from './machines.service';
import { GpsDevicesService } from './gps-devices.service';
import { IotService } from './iot.service';
import { TripsService } from './trips.service';
import { FuelService } from './fuel.service';
import { CatalogService } from './catalog.service';
import { LocationsService } from './locations.service';
import { DashboardService } from './dashboard.service';
import { DashboardProjectsService } from './dashboard-projects.service';
import { DiaryService } from './diary.service';
import { DiaryConflictService } from './diary-conflict.service';
import { IncidentsService } from './incidents.service';
import { SyncService } from './sync.service';
import { SyncCatalogService } from './sync-catalog.service';
import { SyncPushTimerService } from './sync-push-timer';
import { SyncPushFleetService } from './sync-push-fleet';
import { SyncPushDiaryService } from './sync-push-diary';
import { DiaryPdfService } from './diary-pdf.service';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [NotificationsModule, FilesModule],
  controllers: [
    ProjectsController,
    ProjectNestedController,
    QuantitiesController,
    TasksController,
    TimerController,
    AmendmentsController,
    MachinesController,
    MachineDevicesController,
    TripsController,
    FuelController,
    MaterialsController,
    DepotsController,
    LocationsController,
    IotController,
    DashboardController,
    DocumentAlertsController,
    TaskMetricsController,
    TimerMetricsController,
    DiaryController,
    SyncController,
    IncidentsController,
  ],
  providers: [
    ProjectAccessService,
    ProjectsService,
    PhasesService,
    AssignmentsService,
    DocumentsService,
    QuantitiesService,
    TasksService,
    TaskAssigneesService,
    TaskDependenciesService,
    TaskLifecycleService,
    TimerService,
    TimerForceCloseService,
    TimerCronService,
    AmendmentsService,
    MachinesService,
    GpsDevicesService,
    IotService,
    TripsService,
    FuelService,
    CatalogService,
    LocationsService,
    DashboardService,
    DocumentAlertsService,
    DashboardProjectsService,
    TaskCreationMetricsService,
    TimerMetricsService,
    DiaryService,
    DiaryConflictService,
    IncidentsService,
    SyncService,
    SyncCatalogService,
    SyncPushTimerService,
    SyncPushFleetService,
    SyncPushDiaryService,
    DiaryPdfService,
  ],
  exports: [TimerForceCloseService],
})
export class OpsModule {}
