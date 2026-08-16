import { Prisma } from '../../../generated/client';
import { AuthUser } from '../../common/types/auth-user';
import { AppRole } from '../../common/rbac/roles';

type UserRow = {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string | null;
  email: string;
  phone: string | null;
  companyId: string | null;
  hourlyRate: Prisma.Decimal | null;
  isActive: boolean;
  mustChangePassword: boolean;
  locale: 'bs' | 'en';
  roles: { role: string }[];
};

export function serializeUser(
  user: UserRow,
  viewer: AuthUser,
): Record<string, unknown> {
  const canReadRate =
    viewer.id === user.id || viewer.permissions.includes('payroll.read');
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    employeeCode: user.employeeCode,
    email: user.email,
    phone: user.phone,
    companyId: user.companyId,
    hourlyRate: canReadRate ? (user.hourlyRate?.toString() ?? null) : undefined,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    locale: user.locale,
    roles: user.roles.map((item) => item.role as AppRole),
  };
}
