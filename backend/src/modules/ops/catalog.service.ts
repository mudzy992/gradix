import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { canReadCatalog, canWriteCatalog } from '../../common/scope/ops-roles';
import { requireCompany } from '../users/users-helpers';
import {
  CreateDepotDto,
  CreateMaterialDto,
  PatchDepotDto,
  PatchMaterialDto,
} from './fuel.dto';

const MATERIAL_UNITS = ['M3', 'T', 'M', 'M2', 'PCS', 'H', 'L'] as const;
type MaterialUnit = (typeof MATERIAL_UNITS)[number];

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listMaterials(actor: AuthUser) {
    this.assertRead(actor);
    return this.prisma.material.findMany({
      where: { companyId: requireCompany(actor) },
      orderBy: { name: 'asc' },
    });
  }

  async createMaterial(actor: AuthUser, dto: CreateMaterialDto) {
    this.assertWrite(actor);
    return this.prisma.material.create({
      data: {
        companyId: requireCompany(actor),
        name: dto.name,
        unit: this.parseUnit(dto.unit),
      },
    });
  }

  async patchMaterial(actor: AuthUser, id: string, dto: PatchMaterialDto) {
    this.assertWrite(actor);
    await this.loadMaterial(actor, id);
    return this.prisma.material.update({
      where: { id },
      data: {
        name: dto.name,
        unit: dto.unit ? this.parseUnit(dto.unit) : undefined,
      },
    });
  }

  async removeMaterial(actor: AuthUser, id: string) {
    this.assertWrite(actor);
    const row = await this.loadMaterial(actor, id);
    const used = await this.prisma.trip.count({ where: { materialId: id } });
    if (used > 0) {
      return this.prisma.material.update({
        where: { id },
        data: { isActive: false },
      });
    }
    await this.prisma.material.delete({ where: { id: row.id } });
    return { id };
  }

  async listDepots(actor: AuthUser) {
    this.assertRead(actor);
    const rows = await this.prisma.depot.findMany({
      where: { companyId: requireCompany(actor) },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => this.serializeDepot(row));
  }

  async createDepot(actor: AuthUser, dto: CreateDepotDto) {
    this.assertWrite(actor);
    const row = await this.prisma.depot.create({
      data: {
        companyId: requireCompany(actor),
        name: dto.name,
        qrToken: dto.qrToken?.trim() || randomUUID(),
        lat: dto.lat,
        lng: dto.lng,
      },
    });
    return this.serializeDepot(row);
  }

  async patchDepot(actor: AuthUser, id: string, dto: PatchDepotDto) {
    this.assertWrite(actor);
    await this.loadDepot(actor, id);
    const row = await this.prisma.depot.update({
      where: { id },
      data: {
        name: dto.name,
        qrToken: dto.qrToken,
        lat: dto.lat,
        lng: dto.lng,
      },
    });
    return this.serializeDepot(row);
  }

  async removeDepot(actor: AuthUser, id: string) {
    this.assertWrite(actor);
    const row = await this.loadDepot(actor, id);
    const used = await this.prisma.trip.count({ where: { destDepotId: id } });
    if (used > 0) {
      return this.serializeDepot(
        await this.prisma.depot.update({
          where: { id },
          data: { isActive: false },
        }),
      );
    }
    await this.prisma.depot.delete({ where: { id: row.id } });
    return { id };
  }

  private serializeDepot(row: {
    lat: { toString(): string } | null;
    lng: { toString(): string } | null;
    [key: string]: unknown;
  }) {
    return {
      ...row,
      lat: row.lat?.toString() ?? null,
      lng: row.lng?.toString() ?? null,
    };
  }

  private parseUnit(unit: string): MaterialUnit {
    if (!MATERIAL_UNITS.includes(unit as MaterialUnit)) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Invalid material unit',
        400,
      );
    }
    return unit as MaterialUnit;
  }

  private async loadMaterial(actor: AuthUser, id: string) {
    const row = await this.prisma.material.findFirst({
      where: { id, companyId: requireCompany(actor) },
    });
    if (!row) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Material not found', 404);
    }
    return row;
  }

  private async loadDepot(actor: AuthUser, id: string) {
    const row = await this.prisma.depot.findFirst({
      where: { id, companyId: requireCompany(actor) },
    });
    if (!row) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Depot not found', 404);
    }
    return row;
  }

  private assertRead(actor: AuthUser): void {
    if (!canReadCatalog(actor)) {
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        'Catalog read not allowed',
        403,
      );
    }
  }

  private assertWrite(actor: AuthUser): void {
    if (!canWriteCatalog(actor)) {
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        'Catalog write not allowed',
        403,
      );
    }
  }
}
