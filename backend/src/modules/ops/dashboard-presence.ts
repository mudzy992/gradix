import { Project } from '../../../generated/client';
import { PRESENCE_MAX_MS } from '../../common/constants';
import { isInsideGeofence } from '../../common/geo/haversine';
import { PrismaService } from '../prisma/prisma.service';
import type { PresencePerson } from './dashboard-types';

type LocationRow = {
  userId: string;
  lat: { toString(): string };
  lng: { toString(): string };
  recordedAt: Date;
  user: { id: string; firstName: string; lastName: string };
};

export async function loadPresence(
  prisma: PrismaService,
  companyId: string,
  projects: Pick<Project, 'id' | 'lat' | 'lng' | 'geofenceRadius'>[],
): Promise<PresencePerson[]> {
  const geo = projects.filter((project) => project.lat != null && project.lng != null);
  if (geo.length === 0) {
    return [];
  }
  const since = new Date(Date.now() - PRESENCE_MAX_MS);
  const rows = await prisma.userLocation.findMany({
    where: { companyId, recordedAt: { gte: since } },
    orderBy: { recordedAt: 'desc' },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });
  const latest = new Map<string, LocationRow>();
  for (const row of rows) {
    if (!latest.has(row.userId)) {
      latest.set(row.userId, row);
    }
  }
  const seen = new Set<string>();
  const people: PresencePerson[] = [];
  for (const row of latest.values()) {
    for (const project of geo) {
      const inside = isInsideGeofence({
        lat: Number(row.lat),
        lng: Number(row.lng),
        centerLat: Number(project.lat),
        centerLng: Number(project.lng),
        radiusM: project.geofenceRadius,
      });
      if (!inside || seen.has(row.userId)) {
        continue;
      }
      seen.add(row.userId);
      people.push({
        userId: row.user.id,
        firstName: row.user.firstName,
        lastName: row.user.lastName,
        lastSeenAt: row.recordedAt,
        projectId: project.id,
      });
    }
  }
  return people;
}

export function spendCard(projects: Pick<Project, 'plannedBudget' | 'currentSpend'>[]) {
  const spend = projects.reduce((sum, project) => sum + Number(project.currentSpend), 0);
  const budgets = projects
    .map((project) => (project.plannedBudget == null ? null : Number(project.plannedBudget)))
    .filter((value): value is number => value != null);
  if (budgets.length === 0) {
    return { spend: spend.toFixed(2), budget: null as string | null };
  }
  const budget = budgets.reduce((sum, value) => sum + value, 0);
  return { spend: spend.toFixed(2), budget: budget.toFixed(2) };
}

export function avgProgress(projects: Pick<Project, 'progressPercent'>[]): number | null {
  if (projects.length === 0) {
    return null;
  }
  const sum = projects.reduce((total, project) => total + project.progressPercent, 0);
  return Math.round(sum / projects.length);
}
