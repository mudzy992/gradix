import { TenderStatus } from '../../../generated/client';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';

const NEXT: Record<TenderStatus, TenderStatus[]> = {
  DRAFT: ['SUBMITTED', 'WITHDRAWN'],
  SUBMITTED: ['WON', 'LOST', 'WITHDRAWN'],
  WON: [],
  LOST: [],
  WITHDRAWN: [],
};

export function assertTenderTransition(
  from: TenderStatus,
  to: TenderStatus,
): void {
  if (from === to) {
    return;
  }
  if (!NEXT[from].includes(to)) {
    throw new AppError(
      ERROR_CODES.TENDER_INVALID_STATUS,
      'Invalid tender status',
      409,
    );
  }
}
