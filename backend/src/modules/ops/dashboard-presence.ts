import { Project } from '../../../generated/client';
import { PRESENCE_MAX_MS } from '../../common/constants';
import { isInsideGeofence } from '../../common/geo/haversine';
import { PrismaService } from '../prisma/prisma.service';
import type { PresencePerson } from './dashboard-types';
import { latestLocations, type LatestLocationRow } from './latest-locations';

type GeoProject = Pick<Project, 'id' | 'lat' | 'lng' | 'geofenceRadius'>;

function hasGeo(project: GeoProject): boolean {
  return project.lat != null && project.lng != null;
}

/**
 * BE-12 (F-04): čisto mapiranje „ko je na gradilištu“ — bez baze, pa se može testirati.
 * Korisnik se prijavljuje **jednom** (prvi projekat u koji upada) da se ne duplira u listi.
 */
export function presenceForProjects(
  rows: Pick<
    LatestLocationRow,
    'userId' | 'lat' | 'lng' | 'recordedAt' | 'firstName' | 'lastName'
  >[],
  projects: GeoProject[],
): PresencePerson[] {
  const geo = projects.filter(hasGeo);
  if (geo.length === 0) {
    return [];
  }
  const people: PresencePerson[] = [];
  for (const row of rows) {
    const project = geo.find((candidate) =>
      isInsideGeofence({
        lat: Number(row.lat),
        lng: Number(row.lng),
        centerLat: Number(candidate.lat),
        centerLng: Number(candidate.lng),
        radiusM: candidate.geofenceRadius,
      }),
    );
    if (!project) {
      continue;
    }
    people.push({
      userId: row.userId,
      firstName: row.firstName,
      lastName: row.lastName,
      lastSeenAt: row.recordedAt,
      projectId: project.id,
    });
  }
  return people;
}

/** BE-12 (F-05): prisustvo na **jednom** projektu (bez koordinata u odgovoru). */
export function presenceForProject(
  rows: Pick<
    LatestLocationRow,
    'userId' | 'lat' | 'lng' | 'recordedAt' | 'firstName' | 'lastName'
  >[],
  project: GeoProject,
): { userId: string; firstName: string; lastName: string; lastSeenAt: Date }[] {
  if (!hasGeo(project)) {
    return [];
  }
  return rows
    .filter((row) =>
      isInsideGeofence({
        lat: Number(row.lat),
        lng: Number(row.lng),
        centerLat: Number(project.lat),
        centerLng: Number(project.lng),
        radiusM: project.geofenceRadius,
      }),
    )
    .map((row) => ({
      userId: row.userId,
      firstName: row.firstName,
      lastName: row.lastName,
      lastSeenAt: row.recordedAt,
    }));
}

export async function loadPresence(
  prisma: PrismaService,
  companyId: string,
  projects: GeoProject[],
): Promise<PresencePerson[]> {
  if (projects.filter(hasGeo).length === 0) {
    return [];
  }
  const rows = await latestLocations(prisma, {
    companyId,
    since: new Date(Date.now() - PRESENCE_MAX_MS),
  });
  return presenceForProjects(rows, projects);
}

export function spendCard(
  projects: Pick<Project, 'plannedBudget' | 'currentSpend'>[],
) {
  const spend = projects.reduce(
    (sum, project) => sum + Number(project.currentSpend),
    0,
  );
  const budgets = projects
    .map((project) =>
      project.plannedBudget == null ? null : Number(project.plannedBudget),
    )
    .filter((value): value is number => value != null);
  if (budgets.length === 0) {
    return { spend: spend.toFixed(2), budget: null as string | null };
  }
  const budget = budgets.reduce((sum, value) => sum + value, 0);
  return { spend: spend.toFixed(2), budget: budget.toFixed(2) };
}

export function avgProgress(
  projects: Pick<Project, 'progressPercent'>[],
): number | null {
  if (projects.length === 0) {
    return null;
  }
  const sum = projects.reduce(
    (total, project) => total + project.progressPercent,
    0,
  );
  return Math.round(sum / projects.length);
}
