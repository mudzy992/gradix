import { ServiceRecord, ServiceTemplate } from '../../../generated/client';

export function serializeTemplate(row: ServiceTemplate) {
  return {
    id: row.id,
    companyId: row.companyId,
    machineType: row.machineType,
    intervalHours: row.intervalHours,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function serializeService(row: ServiceRecord) {
  return {
    id: row.id,
    companyId: row.companyId,
    machineId: row.machineId,
    projectId: row.projectId,
    templateId: row.templateId,
    status: row.status,
    scheduledAt: row.scheduledAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    totalCost: row.totalCost?.toString() ?? null,
    note: row.note,
    previousMachineStatus: row.previousMachineStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
