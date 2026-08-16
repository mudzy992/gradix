import { SetMetadata } from '@nestjs/common';
import { Permission } from '../rbac/permission.constants';

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (
  ...permissions: Permission[]
): ReturnType<typeof SetMetadata> => SetMetadata(PERMISSIONS_KEY, permissions);
