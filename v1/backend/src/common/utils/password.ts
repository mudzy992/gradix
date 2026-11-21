import { createHash, randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import {
  ARGON2_MEMORY_KIB,
  ARGON2_PARALLELISM,
  ARGON2_TIME_COST,
  MIN_PASSWORD_LENGTH,
} from '../constants';
import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AppError(
      ERROR_CODES.AUTH_PASSWORD_TOO_SHORT,
      'Password must be at least 10 characters',
      400,
    );
  }
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: ARGON2_MEMORY_KIB,
    timeCost: ARGON2_TIME_COST,
    parallelism: ARGON2_PARALLELISM,
  });
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  return argon2.verify(hash, password);
}

export function createTemporaryPassword(): string {
  return randomBytes(12).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}
