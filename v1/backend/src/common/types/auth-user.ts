import { AppRole } from '../rbac/roles';
import { Permission } from '../rbac/permission.constants';

export type AuthCompany = {
  id: string;
  name: string;
  slug: string;
};

export type AuthUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  employeeCode: string | null;
  companyId: string | null;
  company: AuthCompany | null;
  hourlyRate: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  locale: 'bs' | 'en';
  roles: AppRole[];
  permissions: Permission[];
  tenantCompanyId: string | null;
};
