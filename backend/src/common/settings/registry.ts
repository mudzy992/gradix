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
    description: 'Default geofence radius in meters',
  },
];
