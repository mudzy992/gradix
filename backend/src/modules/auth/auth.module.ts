import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ACCESS_TTL } from '../../common/constants';
import { AuthController } from './auth.controller';
import { MeController } from './me.controller';
import { AuthService } from './auth.service';
import { AuthTokensService } from './auth-tokens.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: ACCESS_TTL },
      }),
    }),
  ],
  controllers: [AuthController, MeController],
  providers: [AuthService, AuthTokensService, JwtStrategy],
  exports: [AuthTokensService],
})
export class AuthModule {}
