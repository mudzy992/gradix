import { randomBytes } from 'crypto';
import { hashPassword, hashRefreshToken } from '../../common/utils/password';

export function createDeviceApiKey(): string {
  return randomBytes(24).toString('base64url');
}

export function deviceKeyLookup(key: string): string {
  return hashRefreshToken(key);
}

export async function hashDeviceKey(key: string): Promise<string> {
  return hashPassword(key);
}
