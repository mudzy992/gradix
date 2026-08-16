import { IsEmail, IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  password!: string;
}

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}

export class LogoutDto {
  @IsString()
  refreshToken!: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  newPassword!: string;
}

export class ForgotDto {
  @IsEmail()
  email!: string;
}

export class ResetDto {
  @IsString()
  token!: string;

  @IsString()
  newPassword!: string;
}

export class PatchMeDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  locale?: 'bs' | 'en';
}

export class FcmTokenDto {
  @IsString()
  deviceId!: string;

  @IsOptional()
  @IsString()
  fcmToken?: string;
}
