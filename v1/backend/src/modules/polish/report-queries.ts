import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ReportSlug } from './reports.dto';

export type ReportRow = Record<string, string | number | null>;

export async function runReport(
  prisma: PrismaService,
  slug: ReportSlug,
  companyId: string,
  range: { start: Date; end: Date },
  projectIds: string[] | null,
  projectId?: string,
): Promise<{ columns: string[]; rows: ReportRow[] }> {
  const scoped = projectId ? [projectId] : projectIds;
  if (slug === 'project-spend') {
    return projectSpend(prisma, companyId, scoped);
  }
  if (slug === 'machine-hours') {
    return machineHours(prisma, companyId, range, scoped);
  }
  if (slug === 'fuel-summary') {
    return fuelSummary(prisma, companyId, range, scoped);
  }
  if (slug === 'trips-summary') {
    return tripsSummary(prisma, companyId, range, scoped);
  }
  if (slug === 'tender-comparison') {
    return tenderComparison(prisma, companyId);
  }
  return phaseQuantities(prisma, companyId, scoped);
}

async function projectSpend(
  prisma: PrismaService,
  companyId: string,
  projectIds: string[] | null,
) {
  const rows = await prisma.project.findMany({
    where: {
      companyId,
      archivedAt: null,
      ...(projectIds ? { id: { in: projectIds } } : {}),
    },
    orderBy: { name: 'asc' },
  });
  return {
    columns: ['project', 'plannedBudget', 'currentSpend'],
    rows: rows.map((row) => ({
      project: row.name,
      plannedBudget: row.plannedBudget?.toString() ?? null,
      currentSpend: row.currentSpend.toString(),
    })),
  };
}

async function machineHours(
  prisma: PrismaService,
  companyId: string,
  range: { start: Date; end: Date },
  projectIds: string[] | null,
) {
  const sessions = await prisma.timerSession.groupBy({
    by: ['machineId'],
    where: {
      companyId,
      machineId: { not: null },
      closedAt: { gte: range.start, lt: range.end },
      // BE-15 (F-04): izvještaj je ignorisao scope korisnika — PM/SS bez
      // company-wide pristupa je vidio sate mašina sa **svih** projekata firme.
      ...(projectIds ? { task: { projectId: { in: projectIds } } } : {}),
    },
    _sum: { durationMinutes: true },
  });
  const machines = await prisma.machine.findMany({
    where: {
      companyId,
      id: {
        in: sessions.map((row) => row.machineId).filter(Boolean) as string[],
      },
    },
  });
  const names = new Map(machines.map((row) => [row.id, row.name]));
  return {
    columns: ['machine', 'minutes'],
    rows: sessions.map((row) => ({
      machine: names.get(row.machineId ?? '') ?? row.machineId,
      minutes: row._sum.durationMinutes ?? 0,
    })),
  };
}

async function fuelSummary(
  prisma: PrismaService,
  companyId: string,
  range: { start: Date; end: Date },
  projectIds: string[] | null,
) {
  const where: Prisma.FuelEntryWhereInput = {
    companyId,
    createdAt: { gte: range.start, lt: range.end },
    ...(projectIds ? { projectId: { in: projectIds } } : {}),
  };
  const rows = await prisma.fuelEntry.groupBy({
    by: ['machineId', 'projectId'],
    where,
    _sum: { liters: true, totalCost: true },
  });
  return {
    columns: ['machineId', 'projectId', 'liters', 'cost'],
    rows: rows.map((row) => ({
      machineId: row.machineId,
      projectId: row.projectId,
      liters: row._sum.liters?.toString() ?? '0',
      cost: row._sum.totalCost?.toString() ?? '0',
    })),
  };
}

async function tripsSummary(
  prisma: PrismaService,
  companyId: string,
  range: { start: Date; end: Date },
  projectIds: string[] | null,
) {
  const rows = await prisma.trip.groupBy({
    by: ['driverId', 'projectId'],
    where: {
      companyId,
      loadedAt: { gte: range.start, lt: range.end },
      ...(projectIds ? { projectId: { in: projectIds } } : {}),
    },
    _count: { _all: true },
    _sum: { quantity: true },
  });
  return {
    columns: ['driverId', 'projectId', 'trips', 'quantity'],
    rows: rows.map((row) => ({
      driverId: row.driverId,
      projectId: row.projectId,
      trips: row._count._all,
      quantity: row._sum.quantity?.toString() ?? '0',
    })),
  };
}

async function tenderComparison(prisma: PrismaService, companyId: string) {
  const avg = await prisma.project.aggregate({
    where: { companyId, status: 'COMPLETED' },
    _avg: { currentSpend: true },
    _count: { _all: true },
  });
  const tenders = await prisma.tender.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
  });
  const avgSpend = avg._count._all
    ? (avg._avg.currentSpend?.toString() ?? '0')
    : null;
  return {
    columns: ['title', 'submittedValue', 'avgCompletedSpend'],
    rows: tenders.map((row) => ({
      title: row.title,
      submittedValue: row.submittedValue?.toString() ?? null,
      avgCompletedSpend: avgSpend,
    })),
  };
}

async function phaseQuantities(
  prisma: PrismaService,
  companyId: string,
  projectIds: string[] | null,
) {
  const rows = await prisma.quantityItem.findMany({
    where: {
      companyId,
      ...(projectIds ? { projectId: { in: projectIds } } : {}),
    },
    include: { phase: true, project: true },
    orderBy: { createdAt: 'asc' },
  });
  return {
    columns: ['project', 'phase', 'name', 'plannedQty', 'executedQty'],
    rows: rows.map((row) => ({
      project: row.project.name,
      phase: row.phase?.name ?? null,
      name: row.name,
      plannedQty: row.plannedQty.toString(),
      executedQty: row.executedQty.toString(),
    })),
  };
}
