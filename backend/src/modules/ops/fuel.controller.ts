import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { FuelService } from './fuel.service';
import { CreateFuelDto, FuelListQueryDto, PatchFuelDto } from './fuel.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('fuel')
export class FuelController {
  constructor(private readonly fuel: FuelService) {}

  @Get()
  list(@CurrentUser() actor: AuthUser, @Query() query: FuelListQueryDto) {
    return this.fuel.list(actor, query);
  }

  @Post()
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateFuelDto) {
    return this.fuel.create(actor, dto);
  }

  @Get(':id')
  getById(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.fuel.getById(actor, id);
  }

  @Patch(':id')
  patch(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: PatchFuelDto,
  ) {
    return this.fuel.patch(actor, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @SkipEnvelope()
  remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.fuel.remove(actor, id);
  }
}
