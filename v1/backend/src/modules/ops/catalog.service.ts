import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { canReadCatalog, canWriteCatalog } from '../../common/scope/ops-roles';
import { parseOptionalLatLng } from '../../common/utils/geo';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listMaterials(actor: AuthUser) {
    this.assertRead(actor);
    return this.prisma.material.findMany({
      where: { companyId: requireCompany(actor) },
      orderBy: { name: 'asc' },
    });
  }

  async createMaterial(actor: AuthUser, dto: CreateMaterialDto) {
    this.assertWrite(actor);
    const companyId = requireCompany(actor);
    const row = await this.prisma.material.create({
      data: {
        companyId,
        name: dto.name,
        unit: this.parseUnit(dto.unit),
      },
    });
    await this.audit.write({
      companyId,
      actorId: actor.id,
      action: 'MATERIAL_CREATED',
      entityType: 'Material',
      entityId: row.id,
      payload: { name: row.name, unit: row.unit },
    });
    return row;
  }

  async patchMaterial(actor: AuthUser, id: string, dto: PatchMaterialDto) {
    this.assertWrite(actor);
    await this.loadMaterial(actor, id);
    const row = await this.prisma.material.update({
      where: { id },
      data: {
        name: dto.name,
        unit: dto.unit ? this.parseUnit(dto.unit) : undefined,
      },
    });
    await this.audit.write({
      companyId: row.companyId,
      actorId: actor.id,
      action: 'MATERIAL_UPDATED',
      entityType: 'Material',
      entityId: row.id,
      payload: { fields: Object.keys(dto) },
    });
    return row;
  }

  async removeMaterial(actor: AuthUser, id: string) {
    this.assertWrite(actor);
    const row = await this.loadMaterial(actor, id);
    const used = await this.prisma.trip.count({ where: { materialId: id } });
    // BE-10 (B10): audit se piše **poslije** upisa — ako brisanje padne (FK), ne smije
    // ostati zapis da je materijal uklonjen.
    let result: { id: string } | { isActive: boolean; id: string };
    if (used > 0) {
      result = await this.prisma.material.update({
        where: { id },
        data: { isActive: false },
      });
    } else {
      await this.prisma.material.delete({ where: { id: row.id } });
      result = { id };
    }
    await this.audit.write({
      companyId: row.companyId,
      actorId: actor.id,
      action: 'MATERIAL_REMOVED',
      entityType: 'Material',
      entityId: id,
      payload: { soft: used > 0 },
    });
    return result;
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
    // BE-10 (F-03): koordinate depoa se validiraju kao i svaka druga vanjska koordinata.
    const companyId = requireCompany(actor);
    const coords = parseOptionalLatLng(dto.lat, dto.lng);
    const row = await this.prisma.depot.create({
      data: {
        companyId,
        name: dto.name,
        qrToken: dto.qrToken?.trim() || randomUUID(),
        lat: coords.lat,
        lng: coords.lng,
      },
    });
    await this.audit.write({
      companyId,
      actorId: actor.id,
      action: 'DEPOT_CREATED',
      entityType: 'Depot',
      entityId: row.id,
      payload: { name: row.name },
    });
    return this.serializeDepot(row);
  }

  async patchDepot(actor: AuthUser, id: string, dto: PatchDepotDto) {
    this.assertWrite(actor);
    await this.loadDepot(actor, id);
    const qrToken = dto.qrToken === undefined ? undefined : dto.qrToken.trim();
    if (qrToken === '') {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'qrToken must not be empty',
        400,
      );
    }
    const coords =
      dto.lat !== undefined || dto.lng !== undefined
        ? parseOptionalLatLng(dto.lat, dto.lng)
        : { lat: undefined, lng: undefined };
    try {
      const row = await this.prisma.depot.update({
        where: { id },
        data: {
          name: dto.name,
          qrToken,
          lat: coords.lat,
          lng: coords.lng,
        },
      });
      await this.audit.write({
        companyId: row.companyId,
        actorId: actor.id,
        action: 'DEPOT_UPDATED',
        entityType: 'Depot',
        entityId: row.id,
        payload: { fields: Object.keys(dto) },
      });
      return this.serializeDepot(row);
    } catch (error) {
      // BE-10 (F-05): `qrToken` je @unique — duplikat je ranije bio 500 (P2002).
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          'QR token already in use',
          409,
        );
      }
      throw error;
    }
  }

  async removeDepot(actor: AuthUser, id: string) {
    this.assertWrite(actor);
    const row = await this.loadDepot(actor, id);
    const used = await this.prisma.trip.count({ where: { destDepotId: id } });
    // BE-10 (B10): audit poslije upisa (vidi `removeMaterial`).
    let result: unknown;
    if (used > 0) {
      result = this.serializeDepot(
        await this.prisma.depot.update({
          where: { id },
          data: { isActive: false },
        }),
      );
    } else {
      await this.prisma.depot.delete({ where: { id: row.id } });
      result = { id };
    }
    await this.audit.write({
      companyId: row.companyId,
      actorId: actor.id,
      action: 'DEPOT_REMOVED',
      entityType: 'Depot',
      entityId: id,
      payload: { soft: used > 0 },
    });
    return result;
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
