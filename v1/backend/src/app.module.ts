import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerStorageService } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { OptionalThrottlerGuard } from './common/guards/optional-throttler.guard';
import { RedisModule } from './common/redis/redis.module';
import { RedisService } from './common/redis/redis.service';
import { FailoverThrottlerStorage } from './common/redis/failover-throttler.storage';
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
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    RedisModule,
    // INF-07 (D-039): brojač throttlea u Redisu (važi između replika), uz memorijski
    // fallback ako Redis nije konfigurisan ili padne — throttle nikad ne ruši zahtjev.
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        // FE-11 (D-050): limiti ostaju 120/min, ali se mogu podići u E2E poslu gdje tri
        // Playwright worker-a lako pređu kvotu i testovi onda padaju na 429 umjesto na pravoj grešci.
        throttlers: [
          {
            name: 'default',
            ttl: Number(process.env.THROTTLE_TTL_MS ?? 60_000),
            limit: Number(process.env.THROTTLE_LIMIT ?? 120),
          },
        ],
        storage: new FailoverThrottlerStorage(
          redis.client,
          redis.prefix,
          new ThrottlerStorageService(),
        ),
      }),
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
