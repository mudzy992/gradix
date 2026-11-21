-- BE-08: indeksi na stranim ključevima (51), nove audit akcije (19) i parcijalni
-- unique indeksi za otvorene timere.
--
-- Zašto ručno napisana migracija: u pješčaniku nema mreže za `prisma migrate dev`, a
-- i ovako je svaka promjena eksplicitna. `prisma migrate deploy` je izvršava kao i svaku drugu.
--
-- 1) FK indeksi — Postgres ne indeksira strane ključeve automatski (vidi check:schema).

CREATE INDEX "Amendment_actorId_idx" ON "Amendment"("actorId");
CREATE INDEX "Amendment_entityId_idx" ON "Amendment"("entityId");
CREATE INDEX "AuditEvent_entityId_idx" ON "AuditEvent"("entityId");
CREATE INDEX "Company_logoAssetId_idx" ON "Company"("logoAssetId");
CREATE INDEX "Company_taxId_idx" ON "Company"("taxId");
CREATE INDEX "CostEntry_projectId_idx" ON "CostEntry"("projectId");
CREATE INDEX "CostEntry_sourceId_idx" ON "CostEntry"("sourceId");
CREATE INDEX "Device_deviceId_idx" ON "Device"("deviceId");
CREATE INDEX "DiaryEntry_deviceId_idx" ON "DiaryEntry"("deviceId");
CREATE INDEX "DiaryEntry_localId_idx" ON "DiaryEntry"("localId");
CREATE INDEX "DiaryPhoto_companyId_idx" ON "DiaryPhoto"("companyId");
CREATE INDEX "FuelEntry_deviceId_idx" ON "FuelEntry"("deviceId");
CREATE INDEX "FuelEntry_localId_idx" ON "FuelEntry"("localId");
CREATE INDEX "FuelEntry_projectId_idx" ON "FuelEntry"("projectId");
CREATE INDEX "FuelEntry_userId_idx" ON "FuelEntry"("userId");
CREATE INDEX "GpsDevice_machineId_idx" ON "GpsDevice"("machineId");
CREATE INDEX "Incident_taskId_idx" ON "Incident"("taskId");
CREATE INDEX "Incident_userId_idx" ON "Incident"("userId");
CREATE INDEX "IncidentPhoto_companyId_idx" ON "IncidentPhoto"("companyId");
CREATE INDEX "MachineAssignment_companyId_idx" ON "MachineAssignment"("companyId");
CREATE INDEX "Partner_taxId_idx" ON "Partner"("taxId");
CREATE INDEX "Project_coverAssetId_idx" ON "Project"("coverAssetId");
CREATE INDEX "Project_partnerId_idx" ON "Project"("partnerId");
CREATE INDEX "ProjectAssignment_companyId_idx" ON "ProjectAssignment"("companyId");
CREATE INDEX "ProjectDocument_companyId_idx" ON "ProjectDocument"("companyId");
CREATE INDEX "ProjectPhase_companyId_idx" ON "ProjectPhase"("companyId");
CREATE INDEX "QuantityItem_companyId_idx" ON "QuantityItem"("companyId");
CREATE INDEX "QuantityItem_phaseId_idx" ON "QuantityItem"("phaseId");
CREATE INDEX "ServiceRecord_projectId_idx" ON "ServiceRecord"("projectId");
CREATE INDEX "ServiceRecord_templateId_idx" ON "ServiceRecord"("templateId");
CREATE INDEX "StockMovement_fuelEntryId_idx" ON "StockMovement"("fuelEntryId");
CREATE INDEX "StockMovement_materialId_idx" ON "StockMovement"("materialId");
CREATE INDEX "StockMovement_projectId_idx" ON "StockMovement"("projectId");
CREATE INDEX "StockMovement_warehouseId_idx" ON "StockMovement"("warehouseId");
CREATE INDEX "Task_phaseId_idx" ON "Task"("phaseId");
CREATE INDEX "TaskAssignment_companyId_idx" ON "TaskAssignment"("companyId");
CREATE INDEX "TaskAttachment_companyId_idx" ON "TaskAttachment"("companyId");
CREATE INDEX "TaskDependency_companyId_idx" ON "TaskDependency"("companyId");
CREATE INDEX "TaskDependency_toId_idx" ON "TaskDependency"("toId");
CREATE INDEX "Tender_convertedProjectId_idx" ON "Tender"("convertedProjectId");
CREATE INDEX "TenderAttachment_companyId_idx" ON "TenderAttachment"("companyId");
CREATE INDEX "TimerSession_deviceId_idx" ON "TimerSession"("deviceId");
CREATE INDEX "TimerSession_localId_idx" ON "TimerSession"("localId");
CREATE INDEX "TimerSession_userId_idx" ON "TimerSession"("userId");
CREATE INDEX "Trip_destDepotId_idx" ON "Trip"("destDepotId");
CREATE INDEX "Trip_deviceId_idx" ON "Trip"("deviceId");
CREATE INDEX "Trip_localId_idx" ON "Trip"("localId");
CREATE INDEX "Trip_materialId_idx" ON "Trip"("materialId");
CREATE INDEX "Trip_projectId_idx" ON "Trip"("projectId");
CREATE INDEX "UserLocation_userId_idx" ON "UserLocation"("userId");
CREATE INDEX "Warehouse_projectId_idx" ON "Warehouse"("projectId");

-- 2) Audit akcije (B8) — zatvoren enum je skrivao promjene bez traga.

ALTER TYPE "AuditAction" ADD VALUE 'PROJECT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'PROJECT_ARCHIVED';
ALTER TYPE "AuditAction" ADD VALUE 'PROJECT_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'PROJECT_UNASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'PROJECT_PHASE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PROJECT_PHASE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'PROJECT_DOCUMENT_ADDED';
ALTER TYPE "AuditAction" ADD VALUE 'PROJECT_DOCUMENT_REMOVED';
ALTER TYPE "AuditAction" ADD VALUE 'PROJECT_QUANTITY_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PROJECT_QUANTITY_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'PROJECT_QUANTITY_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_UNASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_ATTACHMENT_ADDED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_ATTACHMENT_REMOVED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_DEPENDENCY_ADDED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_DEPENDENCY_REMOVED';

-- 3) Otvoreni timer: jedan po korisniku i jedan po mašini (F-BE-07-09).
-- Parcijalni unique indeks se ne može izraziti u Prisma šemi; zato živi samo ovdje.
-- Aplikacija i dalje vraća 409 (TIMER_ALREADY_OPEN / MACHINE_IN_USE) preko mapTimerUnique.

CREATE UNIQUE INDEX "TimerSession_open_user_key"
  ON "TimerSession" ("userId")
  WHERE "closedAt" IS NULL;

CREATE UNIQUE INDEX "TimerSession_open_machine_key"
  ON "TimerSession" ("machineId")
  WHERE "closedAt" IS NULL AND "machineId" IS NOT NULL;
