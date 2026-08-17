import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IncidentsService } from './incidents.service';
import { CreateIncidentDto, IncidentListQueryDto, PatchIncidentDto } from './incidents.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get()
  list(@CurrentUser() actor: AuthUser, @Query() query: IncidentListQueryDto) {
    return this.incidents.list(actor, query);
  }

  @Post()
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateIncidentDto) {
    return this.incidents.create(actor, dto);
  }

  @Patch(':id')
  patch(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: PatchIncidentDto,
  ) {
    return this.incidents.patch(actor, id, dto);
  }
}
