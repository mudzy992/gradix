export const ROLES = [
  'PLATFORM_ADMIN',
  'SUPER_ADMIN',
  'ADMIN',
  'PROJECT_MANAGER',
  'SITE_SUPERVISOR',
  'MACHINE_OPERATOR',
  'DRIVER',
  'WORKER',
  'MECHANIC',
  'ACCOUNTANT',
] as const;

export type AppRole = (typeof ROLES)[number];
