import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TENANT_ROUTE_KEY } from '../decorators/tenant-route.decorator';
import { AuthUser } from '../types/auth-user';
import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';
import { PrismaService } from '../../modules/prisma/prisma.service';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: AuthUser;
      headers: Record<string, string | string[] | undefined>;
    }>();
    const user = request.user;
    if (!user) {
      return true;
    }
    const header = this.readHeader(request.headers['x-company-id']);
    const isPlatform = user.roles.includes('PLATFORM_ADMIN');
    if (header && !isPlatform) {
      throw new AppError(
        ERROR_CODES.TENANT_HEADER_FORBIDDEN,
        'X-Company-Id is only allowed for PLATFORM_ADMIN',
        400,
      );
    }
    const isTenant = this.reflector.getAllAndOverride<boolean>(
      TENANT_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!isTenant) {
      if (isPlatform && header) {
        const company = await this.assertCompany(header);
        user.tenantCompanyId = header;
        user.company = {
          id: company.id,
          name: company.name,
          slug: company.slug,
        };
        return true;
      }
      user.tenantCompanyId = user.companyId;
      return true;
    }
    if (isPlatform) {
      if (!header) {
        throw new AppError(
          ERROR_CODES.TENANT_HEADER_REQUIRED,
          'X-Company-Id is required',
          403,
        );
      }
      const company = await this.assertCompany(header);
      user.tenantCompanyId = header;
      user.company = { id: company.id, name: company.name, slug: company.slug };
      return true;
    }
    if (!user.companyId) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'No company context', 403);
    }
    user.tenantCompanyId = user.companyId;
    return true;
  }

  private readHeader(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) {
      return value[0] ?? null;
    }
    return value ?? null;
  }

  private async assertCompany(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true },
    });
    if (!company) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Company not found', 404);
    }
    return company;
  }
}
