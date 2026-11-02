import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { PRESENCE_MAX_MS } from '../../common/constants';
import { parseDecimal } from '../../common/utils/decimal-input';
import { distanceMeters, isInsideGeofence } from '../../common/geo/haversine';
import { canListProjects } from '../../common/scope/ops-roles';
import { requireCompany } from '../users/users-helpers';
import { ProjectAccessService } from './project-access.service';
import { notifyGeofenceTransitions } from './geofence-notify';
import { GeofenceCheckQueryDto, PingLocationDto } from './locations.dto';
import { MachineLocationDto } from './machines.dto';
import { writeMachineGps } from './write-machine-gps';

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  async pingMe(actor: AuthUser, dto: PingLocationDto) {
    const companyId = requireCompany(actor);
    const lat = parseDecimal(dto.lat, 'lat');
    const lng = parseDecimal(dto.lng, 'lng');
    const previous = await this.prisma.userLocation.findFirst({
      where: { userId: actor.id },
      orderBy: { recordedAt: 'desc' },
    });
    const row = await this.prisma.userLocation.create({
      data: {
        companyId,
        userId: actor.id,
        lat,
        lng,
        accuracyM: dto.accuracyM
          ? parseDecimal(dto.accuracyM, 'accuracyM')
          : undefined,
      },
    });
    await notifyGeofenceTransitions({
      notifications: this.notifications,
      actorId: actor.id,
      companyId,
      lat: Number(lat),
      lng: Number(lng),
      prevLat: previous ? Number(previous.lat) : null,
      prevLng: previous ? Number(previous.lng) : null,
      projects: await this.prisma.project.findMany({
        where: {
          companyId,
          lat: { not: null },
          lng: { not: null },
          archivedAt: null,
        },
      }),
    });
    return {
      id: row.id,
      recordedAt: row.recordedAt,
      lat: lat.toString(),
      lng: lng.toString(),
    };
  }

  async presence(actor: AuthUser, projectId: string) {
    this.assertPresence(actor);
    const project = await this.access.getVisibleProject(actor, projectId);
    if (project.lat == null || project.lng == null) {
      return [];
    }
    const since = new Date(Date.now() - PRESENCE_MAX_MS);
    const rows = await this.prisma.userLocation.findMany({
      where: { companyId: project.companyId, recordedAt: { gte: since } },
      orderBy: { recordedAt: 'desc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!latest.has(row.userId)) {
        latest.set(row.userId, row);
      }
    }
    const centerLat = Number(project.lat);
    const centerLng = Number(project.lng);
    return [...latest.values()]
      .filter((row) =>
        isInsideGeofence({
          lat: Number(row.lat),
          lng: Number(row.lng),
          centerLat,
          centerLng,
          radiusM: project.geofenceRadius,
        }),
      )
      .map((row) => ({
        userId: row.user.id,
        firstName: row.user.firstName,
        lastName: row.user.lastName,
        lastSeenAt: row.recordedAt,
      }));
  }

  async geofenceCheck(actor: AuthUser, query: GeofenceCheckQueryDto) {
    const lat = Number(parseDecimal(query.lat, 'lat'));
    const lng = Number(parseDecimal(query.lng, 'lng'));
    const companyId = requireCompany(actor);
    const projects = query.projectId
      ? [await this.access.getVisibleProject(actor, query.projectId)]
      : await this.prisma.project.findMany({
          where: {
            companyId,
            lat: { not: null },
            lng: { not: null },
            archivedAt: null,
          },
        });
    return projects
      .filter((project) => project.lat != null && project.lng != null)
      .map((project) => {
        const centerLat = Number(project.lat);
        const centerLng = Number(project.lng);
        const distanceM = Math.round(
          distanceMeters(lat, lng, centerLat, centerLng),
        );
        return {
          projectId: project.id,
          name: project.name,
          inside: distanceM <= project.geofenceRadius,
          distanceM,
        };
      });
  }

  async pingMachine(
    actor: AuthUser,
    machineId: string,
    dto: MachineLocationDto,
  ) {
    const companyId = requireCompany(actor);
    const machine = await this.prisma.machine.findFirst({
      where: { id: machineId, companyId },
    });
    if (!machine) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Machine not found', 404);
    }
    if (machine.status === 'DECOMMISSIONED') {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'Machine is decommissioned',
        409,
      );
    }
    await this.assertCanPingMachine(actor, machine.id);
    const lat = parseDecimal(dto.lat, 'lat');
    const lng = parseDecimal(dto.lng, 'lng');
    const now = await writeMachineGps({
      prisma: this.prisma,
      realtime: this.realtime,
      companyId,
      machineId: machine.id,
      lat,
      lng,
      source: 'PHONE',
      throttle: false,
      lastGpsAt: machine.lastGpsAt,
    });
    return {
      id: machine.id,
      lastLat: lat.toString(),
      lastLng: lng.toString(),
      lastGpsAt: now,
      lastGpsSource: 'PHONE' as const,
    };
  }

  private async assertCanPingMachine(
    actor: AuthUser,
    machineId: string,
  ): Promise<void> {
    if (actor.permissions.includes('fleet.write')) {
      return;
    }
    const assigned = await this.prisma.machineAssignment.findFirst({
      where: { machineId, userId: actor.id, endedAt: null },
    });
    if (assigned) {
      return;
    }
    const timer = await this.prisma.timerSession.findFirst({
      where: { userId: actor.id, machineId, closedAt: null },
    });
    if (!timer) {
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        'Cannot ping this machine',
        403,
      );
    }
  }

  private assertPresence(actor: AuthUser): void {
    if (!canListProjects(actor) && !actor.permissions.includes('fleet.map')) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Presence not allowed', 403);
    }
  }
}
