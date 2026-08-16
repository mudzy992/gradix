import path from 'node:path';
import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';

export function assertStoragePath(filePath: string, companyId: string): string {
  if (!filePath || filePath.includes('..') || path.posix.isAbsolute(filePath) || path.win32.isAbsolute(filePath)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid path', 400);
  }
  const normalized = path.posix.normalize(filePath.replaceAll('\\', '/')).replace(/^\/+/, '');
  if (!normalized.startsWith(`${companyId}/`)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, 'Path outside company prefix', 403);
  }
  return normalized;
}

export function buildObjectPath(companyId: string, ext: string): string {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${companyId}/${yyyy}/${mm}/${crypto.randomUUID()}.${ext}`;
}
