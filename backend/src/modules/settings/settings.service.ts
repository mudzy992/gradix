import { Injectable } from '@nestjs/common';
import { Prisma, SettingScope } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuthUser } from '../../common/types/auth-user';
import { SETTINGS_REGISTRY, SettingDefinition } from '../../common/settings/registry';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(actor: AuthUser, canWrite: boolean) {
    const companyId = this.requireCompany(actor);
    const rows = await this.prisma.setting.findMany({ where: { companyId } });
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return SETTINGS_REGISTRY.map((def) => {
      const row = byKey.get(def.key);
      const value = row ? row.value : def.defaultValue;
      return {
        key: def.key,
        scope: def.scope,
        description: def.description,
        value: this.mask(def, value, canWrite),
      };
    });
  }

  async put(actor: AuthUser, body: Record<string, unknown>) {
    const companyId = this.requireCompany(actor);
    const entries = Object.entries(body);
    for (const [key, raw] of entries) {
      const def = this.requireDef(key);
      const value = this.coerce(def, raw);
      await this.prisma.setting.upsert({
        where: { companyId_key: { companyId, key } },
        create: { companyId, key, value: value as Prisma.InputJsonValue, scope: def.scope },
        update: { value: value as Prisma.InputJsonValue },
      });
      this.realtime.emitSettingsUpdated(companyId, key);
      await this.audit.write({
        companyId,
        actorId: actor.id,
        action: 'SETTINGS_UPDATED',
        entityType: 'Setting',
        entityId: key,
        payload: { key },
      });
    }
    return this.list(actor, true);
  }

  async publicBySlug(slug: string) {
    const company = await this.prisma.company.findUnique({ where: { slug } });
    if (!company || !company.isActive) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Company not found', 404);
    }
    const rows = await this.prisma.setting.findMany({
      where: { companyId: company.id, scope: SettingScope.PUBLIC },
    });
    const result: Record<string, unknown> = {};
    for (const def of SETTINGS_REGISTRY.filter((item) => item.scope === 'PUBLIC')) {
      const row = rows.find((item) => item.key === def.key);
      result[def.key] = row ? row.value : def.defaultValue;
    }
    return result;
  }

  private requireCompany(actor: AuthUser): string {
    if (!actor.tenantCompanyId) {
      throw new AppError(ERROR_CODES.TENANT_HEADER_REQUIRED, 'X-Company-Id is required', 403);
    }
    return actor.tenantCompanyId;
  }

  private requireDef(key: string): SettingDefinition {
    const def = SETTINGS_REGISTRY.find((item) => item.key === key);
    if (!def) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, `Unknown setting ${key}`, 400);
    }
    return def;
  }

  private coerce(def: SettingDefinition, raw: unknown): string | number | boolean {
    if (def.type === 'boolean') {
      if (typeof raw !== 'boolean') {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, `${def.key} must be boolean`, 400);
      }
      return raw;
    }
    if (def.type === 'number') {
      if (typeof raw !== 'number') {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, `${def.key} must be number`, 400);
      }
      if (def.min !== undefined && raw < def.min) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, `${def.key} below min`, 400);
      }
      if (def.max !== undefined && raw > def.max) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, `${def.key} above max`, 400);
      }
      return raw;
    }
    if (typeof raw !== 'string') {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, `${def.key} must be string`, 400);
    }
    return raw;
  }

  private mask(def: SettingDefinition, value: unknown, canWrite: boolean): unknown {
    if (def.scope !== 'SECRET' || canWrite === false) {
      if (def.scope === 'SECRET') {
        return typeof value === 'string' && value.length > 0 ? '********' : value;
      }
      return value;
    }
    return typeof value === 'string' && value.length > 0 ? '********' : value;
  }
}
