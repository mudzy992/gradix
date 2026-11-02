import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../../common/types/auth-user';
import { SYNC_CATALOG_TTL_HOURS } from '../../common/constants';
import { isCompanyWide } from '../../common/scope/ops-roles';
import { requireCompany } from '../users/users-helpers';
import { ProjectAccessService } from './project-access.service';
import { serializeMachine } from './serialize-machine';

@Injectable()
export class SyncCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async catalog(actor: AuthUser) {
    const companyId = requireCompany(actor);
    const [projects, machines, materials, depots] = await Promise.all([
      this.prisma.project.findMany({
        where: this.projectWhere(actor, companyId),
        orderBy: { name: 'asc' },
      }),
      this.prisma.machine.findMany({
        where: { companyId },
        orderBy: { name: 'asc' },
      }),
      this.prisma.material.findMany({
        where: { companyId },
        orderBy: { name: 'asc' },
      }),
      this.prisma.depot.findMany({
        where: { companyId },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      pulledAt: new Date().toISOString(),
      ttlHours: SYNC_CATALOG_TTL_HOURS,
      projects: projects.map((row) => this.access.serialize(row, actor)),
      machines: machines.map(serializeMachine),
      materials,
      depots: depots.map((row) => ({
        id: row.id,
        name: row.name,
        lat: row.lat?.toString() ?? null,
        lng: row.lng?.toString() ?? null,
        isActive: row.isActive,
      })),
    };
  }

  private projectWhere(
    actor: AuthUser,
    companyId: string,
  ): Prisma.ProjectWhereInput {
    if (isCompanyWide(actor)) {
      return { companyId, archivedAt: null };
    }
    return {
      companyId,
      archivedAt: null,
      OR: [
        { assignments: { some: { userId: actor.id } } },
        { tasks: { some: { assignees: { some: { userId: actor.id } } } } },
      ],
    };
  }
}
