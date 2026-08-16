import { Role } from '../../../generated/client';
import { resolvePermissions } from '../../common/rbac/role-permissions';
import { AppRole } from '../../common/rbac/roles';
import { AuthUser } from '../../common/types/auth-user';

type UserRecord = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  employeeCode: string | null;
  companyId: string | null;
  hourlyRate: { toString(): string } | null;
  isActive: boolean;
  mustChangePassword: boolean;
  locale: 'bs' | 'en';
  roles: { role: Role }[];
  company: { id: string; name: string; slug: string } | null;
};

export function mapAuthUser(
  user: UserRecord,
  tenantCompanyId: string | null,
): AuthUser {
  const roles = user.roles.map((item) => item.role as AppRole);
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    employeeCode: user.employeeCode,
    companyId: user.companyId,
    company: user.company
      ? {
          id: user.company.id,
          name: user.company.name,
          slug: user.company.slug,
        }
      : null,
    hourlyRate: user.hourlyRate?.toString() ?? null,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    locale: user.locale,
    roles,
    permissions: resolvePermissions(roles),
    tenantCompanyId,
  };
}

export function toMeDto(user: AuthUser) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    employeeCode: user.employeeCode,
    email: user.email,
    roles: user.roles,
    permissions: user.permissions,
    companyId: user.companyId,
    company: user.company,
    hourlyRate: user.hourlyRate,
    mustChangePassword: user.mustChangePassword,
    locale: user.locale,
  };
}
