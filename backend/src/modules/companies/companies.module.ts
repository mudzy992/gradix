import { Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller';
import { TenantCompanyController } from './tenant-company.controller';
import { CompaniesService } from './companies.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [CompaniesController, TenantCompanyController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
