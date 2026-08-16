import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { Permission } from '../rbac/permission.constants';
import { AuthUser } from '../types/auth-user';
import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) {
      return true;
    }
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    if (!user) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Forbidden', 403);
    }
    const allowed = required.every((permission) =>
      user.permissions.includes(permission),
    );
    if (!allowed) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Forbidden', 403);
    }
    return true;
  }
}
