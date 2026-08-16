import { Prisma } from '../../../generated/client';
import { SETTINGS_REGISTRY } from '../../common/settings/registry';

export function defaultSettingRows(companyId: string): Prisma.SettingCreateManyInput[] {
  return SETTINGS_REGISTRY.map((item) => ({
    companyId,
    key: item.key,
    value: item.defaultValue as Prisma.InputJsonValue,
    scope: item.scope,
  }));
}
