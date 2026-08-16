import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthUser } from '../types/auth-user';
import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';

const ALLOWED = new Set([
  'GET /api/me',
  'POST /api/auth/change-password',
  'POST /api/auth/logout',
  'POST /api/auth/logout-all',
]);

@Injectable()
export class PasswordChangeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: AuthUser;
      method: string;
      originalUrl: string;
    }>();
    const user = request.user;
    if (!user?.mustChangePassword) {
      return true;
    }
    const path = request.originalUrl.split('?')[0];
    const key = `${request.method} ${path}`;
    if (ALLOWED.has(key)) {
      return true;
    }
    throw new AppError(
      ERROR_CODES.AUTH_PASSWORD_CHANGE_REQUIRED,
      'Password change required',
      403,
    );
  }
}
