import { Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller';
import { TenantCompanyController } from './tenant-company.controller';
import { CompaniesService } from './companies.service';
import { AuthModule } from '../auth/auth.module';
import { OpsModule } from '../ops/ops.module';

@Module({
  imports: [AuthModule, OpsModule],
  controllers: [CompaniesController, TenantCompanyController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
