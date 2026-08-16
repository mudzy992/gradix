import { DEFAULT_LIMIT, DEFAULT_PAGE, MAX_LIMIT } from '../constants';
import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
};

export type ListResult<T> = {
  data: T[];
  meta: PaginationMeta;
};

export function parsePagination(page?: number, limit?: number): {
  page: number;
  limit: number;
  skip: number;
} {
  const resolvedPage = page ?? DEFAULT_PAGE;
  const resolvedLimit = limit ?? DEFAULT_LIMIT;
  if (resolvedPage < 1 || resolvedLimit < 1 || resolvedLimit > MAX_LIMIT) {
    throw new AppError(
      ERROR_CODES.PAGINATION_LIMIT,
      'page must be >= 1 and limit must be 1–100',
      400,
    );
  }
  return {
    page: resolvedPage,
    limit: resolvedLimit,
    skip: (resolvedPage - 1) * resolvedLimit,
  };
}

export function listResult<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): ListResult<T> {
  return { data, meta: { page, limit, total } };
}
