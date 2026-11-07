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
    const { stream, path, size, contentType } = await this.files.getObject(
      actor,
      rawPath,
    );
    // BE-11 (F-12): eksplicitni tip/veličina + zaštita od MIME sniffing-a. Fajl je
    // korisnički sadržaj, pa se nikad ne izvršava u kontekstu aplikacije.
    response.setHeader('Content-Type', contentType);
    response.setHeader('Content-Length', String(size));
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${path.split('/').pop() ?? 'file'}"`,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // D-041: frontend je na drugom domenu; Helmet po defaultu šalje
    // `Cross-Origin-Resource-Policy: same-origin`, što bi blokiralo prikaz fajla preko
    // `<img>`/`<video>` sa API domena. Fajl je korisnički sadržaj i sam po sebi nije izvršiv
    // (uz `nosniff` i sandbox CSP ispod), pa je `cross-origin` bezbjedan i potreban.
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    response.setHeader(
      'Content-Security-Policy',
      "sandbox; default-src 'none'",
    );
    // Stream greška (npr. MinIO prekine vezu) ne smije ostaviti odgovor da visi.
    stream.on('error', () => {
      response.destroy();
    });
    stream.pipe(response);
  }
}
