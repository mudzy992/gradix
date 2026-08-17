import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { canWritePlannedQty, hasRole } from '../../common/scope/ops-roles';
import { ProjectAccessService } from './project-access.service';
import { CreateQuantityDto, PatchQuantityDto } from './quantities.dto';

@Injectable()
export class QuantitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async list(actor: AuthUser, projectId: string) {
    this.access.assertCanList(actor);
    await this.access.getVisibleProject(actor, projectId);
    const rows = await this.prisma.quantityItem.findMany({ where: { projectId } });
    return rows.map((row) => this.serialize(row));
  }

  async create(actor: AuthUser, projectId: string, dto: CreateQuantityDto) {
    const project = await this.access.getVisibleProject(actor, projectId);
    await this.access.assertScopedWrite(actor, project);
    if (!canWritePlannedQty(actor)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'plannedQty write not allowed', 403);
    }
    this.access.assertQtyWrite(project, false);
    await this.assertPhase(projectId, dto.phaseId);
    const row = await this.prisma.quantityItem.create({
      data: {
        companyId: project.companyId,
        projectId,
        phaseId: dto.phaseId ?? null,
        name: dto.name,
        unit: dto.unit,
        plannedQty: dto.plannedQty,
        executedQty: dto.executedQty ?? 0,
        note: dto.note,
      },
    });
    return this.serialize(row);
  }

  async patch(actor: AuthUser, projectId: string, id: string, dto: PatchQuantityDto) {
    const project = await this.access.getVisibleProject(actor, projectId);
    const existing = await this.prisma.quantityItem.findFirst({ where: { id, projectId } });
    if (!existing) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Quantity not found', 404);
    }
    const plannedTouched = dto.plannedQty !== undefined || dto.name !== undefined
      || dto.unit !== undefined || dto.phaseId !== undefined;
    if (plannedTouched && !canWritePlannedQty(actor)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'SS cannot patch planned fields', 403);
    }
    const isAdmin = hasRole(actor, 'ADMIN', 'SUPER_ADMIN', 'PLATFORM_ADMIN');
    this.access.assertQtyWrite(project, isAdmin && dto.executedQty !== undefined);
    await this.assertPhase(projectId, dto.phaseId);
    const row = await this.prisma.quantityItem.update({
      where: { id },
      data: {
        phaseId: dto.phaseId,
        name: dto.name,
        unit: dto.unit,
        plannedQty: dto.plannedQty,
        executedQty: dto.executedQty,
        note: dto.note,
      },
    });
    return this.serialize(row);
  }

  private serialize(row: {
    plannedQty: Prisma.Decimal;
    executedQty: Prisma.Decimal;
    [key: string]: unknown;
  }) {
    return {
      ...row,
      plannedQty: row.plannedQty.toString(),
      executedQty: row.executedQty.toString(),
    };
  }

  private async assertPhase(projectId: string, phaseId?: string): Promise<void> {
    if (!phaseId) {
      return;
    }
    const phase = await this.prisma.projectPhase.findFirst({ where: { id: phaseId, projectId } });
    if (!phase) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'phaseId not in project', 400);
    }
  }
}
