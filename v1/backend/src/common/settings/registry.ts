import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';

export type SettingValue = string | number | boolean;

export type SettingDefinition = {
  key: string;
  scope: 'PUBLIC' | 'PRIVATE' | 'SECRET';
  type: 'string' | 'number' | 'boolean';
  defaultValue: SettingValue;
  description: string;
  min?: number;
  max?: number;
};

export const SETTINGS_REGISTRY: SettingDefinition[] = [
  {
    key: 'app.currency',
    scope: 'PUBLIC',
    type: 'string',
    defaultValue: 'BAM',
    description: 'Default currency code',
  },
  {
    key: 'app.timezone',
    scope: 'PUBLIC',
    type: 'string',
    defaultValue: 'Europe/Sarajevo',
    description: 'IANA timezone for display and payroll day',
  },
  {
    key: 'app.dateFormat',
    scope: 'PUBLIC',
    type: 'string',
    defaultValue: 'dd.MM.yyyy',
    description: 'Date display format',
  },
  {
    key: 'features.email',
    scope: 'PRIVATE',
    type: 'boolean',
    defaultValue: false,
    description: 'Enable email delivery stubs',
  },
  {
    key: 'features.push',
    scope: 'PRIVATE',
    type: 'boolean',
    defaultValue: false,
    description: 'Enable push delivery stubs',
  },
  {
    key: 'privacy.gpsNotice',
    scope: 'PRIVATE',
    type: 'string',
    defaultValue:
      'Location may be recorded on site. It is informational and is not payroll evidence.',
    description: 'GPS privacy notice shown to field users',
  },
  {
    key: 'public.companyName',
    scope: 'PUBLIC',
    type: 'string',
    defaultValue: '',
    description: 'Public site company name',
  },
  {
    key: 'public.tagline',
    scope: 'PUBLIC',
    type: 'string',
    defaultValue: '',
    description: 'Public site tagline',
  },
  {
    key: 'public.contact',
    scope: 'PUBLIC',
    type: 'string',
    defaultValue: '',
    description: 'Public site contact line',
  },
  {
    key: 'timer.maxOpenHours',
    scope: 'PRIVATE',
    type: 'number',
    defaultValue: 12,
    min: 1,
    max: 24,
    description: 'Auto-close open timers after this many hours',
  },
  {
    key: 'geofence.defaultRadiusM',
    scope: 'PRIVATE',
    type: 'number',
    defaultValue: 200,
    min: 10,
    max: 5000,
    description: 'Default geofence radius in meters',
  },
  {
    key: 'erp.allowNegativeStock',
    scope: 'PRIVATE',
    type: 'boolean',
    defaultValue: false,
    description: 'Allow stock movements that take a warehouse below zero',
  },
];

/** Definicija po ključu (jedan izvor istine za servis i testove). */
export function findSetting(key: string): SettingDefinition | undefined {
  return SETTINGS_REGISTRY.find((item) => item.key === key);
}

/**
 * Validira i pretvara vrijednost iz zahtjeva u tip iz registra.
 * Baca `400 VALIDATION_FAILED` sa imenom ključa — poruka je korisniku razumljiva.
 */
export function coerceSettingValue(
  def: SettingDefinition,
  raw: unknown,
): SettingValue {
  if (def.type === 'boolean') {
    if (typeof raw !== 'boolean') {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `${def.key} must be boolean`,
        400,
      );
    }
    return raw;
  }
  if (def.type === 'number') {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `${def.key} must be number`,
        400,
      );
    }
    if (def.min !== undefined && raw < def.min) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `${def.key} below min (${def.min})`,
        400,
      );
    }
    if (def.max !== undefined && raw > def.max) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `${def.key} above max (${def.max})`,
        400,
      );
    }
    return raw;
  }
  if (typeof raw !== 'string') {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `${def.key} must be string`,
      400,
    );
  }
  return raw;
}
