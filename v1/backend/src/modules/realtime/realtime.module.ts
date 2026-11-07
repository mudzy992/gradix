import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ACCESS_TTL } from '../../common/constants';
import { AppGateway } from './app.gateway';
import { RealtimeService } from './realtime.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: ACCESS_TTL },
      }),
    }),
  ],
  providers: [RealtimeService, AppGateway],
  exports: [RealtimeService],
})
export class RealtimeModule {}
