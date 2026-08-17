import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PayrollService } from './payroll.service';
import { PayrollQueryDto, RejectPayrollDto } from './payroll.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('sessions')
  list(@CurrentUser() actor: AuthUser, @Query() query: PayrollQueryDto) {
    return this.payroll.list(actor, query);
  }

  @Get('summary')
  @RequirePermissions(PERMISSIONS.PAYROLL_READ)
  summary(@CurrentUser() actor: AuthUser, @Query() query: PayrollQueryDto) {
    return this.payroll.summary(actor, query);
  }

  @Get('export')
  @SkipEnvelope()
  @RequirePermissions(PERMISSIONS.PAYROLL_READ)
  async exportXlsx(
    @CurrentUser() actor: AuthUser,
    @Query() query: PayrollQueryDto,
    @Res() response: Response,
  ) {
    const buffer = await this.payroll.exportXlsx(actor, query);
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader('Content-Disposition', 'attachment; filename="payroll.xlsx"');
    response.send(buffer);
  }

  @Post('sessions/:id/approve')
  @HttpCode(200)
  approve(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.payroll.approve(actor, id);
  }

  @Post('sessions/:id/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: RejectPayrollDto = {},
  ) {
    return this.payroll.reject(actor, id, dto);
  }
}
