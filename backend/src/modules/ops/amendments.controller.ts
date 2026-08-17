import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AmendmentsService } from './amendments.service';
import { AmendmentListQueryDto, CreateAmendmentDto } from './amendments.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('amendments')
export class AmendmentsController {
  constructor(private readonly amendments: AmendmentsService) {}

  @Get()
  list(@CurrentUser() actor: AuthUser, @Query() query: AmendmentListQueryDto) {
    return this.amendments.list(actor, query);
  }

  @Post()
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateAmendmentDto) {
    return this.amendments.create(actor, dto);
  }
}
