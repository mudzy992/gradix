import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { ReportQueryDto } from './reports.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get(':slug/export')
  @SkipEnvelope()
  @RequirePermissions(PERMISSIONS.REPORTS_EXPORT)
  async exportXlsx(
    @CurrentUser() actor: AuthUser,
    @Param('slug') slug: string,
    @Query() query: ReportQueryDto,
    @Res() response: Response,
  ) {
    const buffer = await this.reports.exportXlsx(actor, slug, query);
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${slug}.xlsx"`,
    );
    response.send(buffer);
  }

  @Get(':slug')
  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  get(
    @CurrentUser() actor: AuthUser,
    @Param('slug') slug: string,
    @Query() query: ReportQueryDto,
  ) {
    return this.reports.get(actor, slug, query);
  }
}
