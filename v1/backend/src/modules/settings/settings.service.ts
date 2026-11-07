import { Injectable } from '@nestjs/common';
import { SettingScope } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuthUser } from '../../common/types/auth-user';
import {
  SETTINGS_REGISTRY,
  SettingDefinition,
  coerceSettingValue,
  findSetting,
} from '../../common/settings/registry';
import { requireTenantCompany } from '../../common/scope/tenant';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(actor: AuthUser) {
    const companyId = requireTenantCompany(actor);
    const rows = await this.prisma.setting.findMany({ where: { companyId } });
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return SETTINGS_REGISTRY.map((def) => {
      const row = byKey.get(def.key);
      const value = row ? row.value : def.defaultValue;
      return {
        key: def.key,
        scope: def.scope,
        description: def.description,
        value: maskSecret(def, value),
      };
    });
  }

  async put(actor: AuthUser, body: Record<string, unknown>) {
    const companyId = requireTenantCompany(actor);
    // 1) prvo validiraj i koerciraj sve — nijedan ključ se ne piše ako ijedan nije ispravan
    const entries = Object.entries(body).map(([key, raw]) => {
      const def = this.requireDef(key);
      return { key, def, value: coerceSettingValue(def, raw) };
    });
    // 2) sve izmjene idu u jednoj transakciji (ranije: dijelom upisano, pa 400 na sljedećem ključu)
    if (entries.length > 0) {
      await this.prisma.$transaction(
        entries.map(({ def, key, value }) =>
          this.prisma.setting.upsert({
            where: { companyId_key: { companyId, key } },
            create: { companyId, key, value, scope: def.scope },
            update: { value },
          }),
        ),
      );
    }
    // 3) tek poslije uspješnog upisa: realtime + audit
    for (const { key } of entries) {
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
    return this.list(actor);
  }

  async publicBySlug(slug: string) {
    const company = await this.prisma.company.findUnique({ where: { slug } });
    if (!company || !company.isActive) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Company not found', 404);
    }
    const rows = await this.prisma.setting.findMany({
      where: { companyId: company.id, scope: SettingScope.PUBLIC },
    });
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    const result: Record<string, unknown> = {};
    for (const def of SETTINGS_REGISTRY.filter(
      (item) => item.scope === 'PUBLIC',
    )) {
      result[def.key] = byKey.get(def.key) ?? def.defaultValue;
    }
    return result;
  }

  private requireDef(key: string): SettingDefinition {
    const def = findSetting(key);
    if (!def) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `Unknown setting ${key}`,
        400,
      );
    }
    return def;
  }
}

/**
 * BE-04: `SECRET` vrijednosti se nikad ne vraćaju u čistom obliku — ranije je `mask` imao
 * dvije grane koje su radile istu stvar, uz parametar `canWrite` koji nije mijenjao ishod.
 */
function maskSecret(def: SettingDefinition, value: unknown): unknown {
  if (def.scope !== 'SECRET') {
    return value;
  }
  return typeof value === 'string' && value.length > 0 ? '********' : value;
}
