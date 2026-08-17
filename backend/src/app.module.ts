import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { OptionalThrottlerGuard } from './common/guards/optional-throttler.guard';
import { PasswordChangeGuard } from './common/guards/password-change.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { PrismaModule } from './modules/prisma/prisma.module';
import { AuditModule } from './modules/audit/audit.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { SettingsModule } from './modules/settings/settings.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { FilesModule } from './modules/files/files.module';
import { OpsModule } from './modules/ops/ops.module';
import { MailModule } from './modules/mail/mail.module';
import { PolishModule } from './modules/polish/polish.module';
import { PublicModule } from './modules/public/public.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { ErpModule } from './modules/erp/erp.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60000, limit: 120 }],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    RealtimeModule,
    HealthModule,
    AuthModule,
    UsersModule,
    CompaniesModule,
    SettingsModule,
    NotificationsModule,
    FilesModule,
    OpsModule,
    MailModule,
    PolishModule,
    PublicModule,
    PayrollModule,
    ErpModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: OptionalThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PasswordChangeGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
