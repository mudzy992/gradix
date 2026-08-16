import {
  Controller,
  Get,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { FilesService } from './files.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { MAX_UPLOAD_BYTES } from '../../common/constants';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';

@TenantRoute()
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  upload(
    @CurrentUser() actor: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.files.upload(actor, file);
  }

  @SkipEnvelope()
  @Get()
  async getFile(
    @CurrentUser() actor: AuthUser,
    @Query('path') rawPath: string,
    @Res() response: Response,
  ) {
    if (!rawPath) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'path required', 400);
    }
    const { stream } = await this.files.getObject(actor, rawPath);
    stream.pipe(response);
  }
}
