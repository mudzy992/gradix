import { Prisma } from '../../../generated/client';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';

export function parseMachineStatus(status: string): Prisma.MachineWhereInput['status'] {
  const allowed = ['IDLE', 'ACTIVE', 'IN_SERVICE', 'DECOMMISSIONED'] as const;
  if (!allowed.includes(status as (typeof allowed)[number])) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid machine status', 400);
  }
  return status as (typeof allowed)[number];
}
