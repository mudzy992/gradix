/**
 * BE-06 — zatvorena lista statusa zadatka za validaciju ulaza.
 *
 * Odvojeno od `task-status.ts` (koji radi sa Prisma tipovima i servisom) da bi DTO mogao
 * validirati `?status=` bez uvlačenja Prisma klijenta. Vrijednosti su identične
 * `enum TaskStatus` u `prisma/schema/ops.prisma`.
 */
export const TASK_STATUSES = [
  'PENDING',
  'ASSIGNED',
  'IN_PROGRESS',
  'PAUSED',
  'COMPLETED',
  'CANCELLED',
] as const;

export type TaskStatusValue = (typeof TASK_STATUSES)[number];
