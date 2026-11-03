import { Injectable } from '@nestjs/common';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { MAX_UPLOAD_BYTES } from '../../common/constants';
import {
  assertStoragePath,
  buildObjectPath,
} from '../../common/utils/storage-path';
import { MinioService } from './minio.service';
import { detectMime } from './detect-mime';

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

@Injectable()
export class FilesService {
  constructor(private readonly minio: MinioService) {}

  async upload(actor: AuthUser, file: Express.Multer.File) {
    const companyId = this.requireCompany(actor);
    if (!file) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'File required', 400);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'File too large', 400);
    }
    const mime = detectMime(file.buffer) ?? '';
    const ext = MIME_EXT[mime];
    if (!ext) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Unsupported file type',
        400,
      );
    }
    const objectPath = buildObjectPath(companyId, ext);
    await this.minio.client.putObject(
      this.minio.bucket,
      objectPath,
      file.buffer,
      file.size,
      {
        'Content-Type': mime,
      },
    );
    return { path: objectPath, mime };
  }

  async putGenerated(
    companyId: string,
    buffer: Buffer,
    ext: string,
    mime: string,
  ): Promise<string> {
    const objectPath = buildObjectPath(companyId, ext);
    await this.minio.client.putObject(
      this.minio.bucket,
      objectPath,
      buffer,
      buffer.length,
      {
        'Content-Type': mime,
      },
    );
    return objectPath;
  }

  async getObject(actor: AuthUser, rawPath: string) {
    const companyId = this.requireCompany(actor);
    return this.streamPublic(companyId, rawPath);
  }

  /**
   * BE-11 (F-12): uz stream se vraćaju i veličina i tip objekta. Prije ih ruta nije
   * postavljala, pa su browseri dobijali `application/octet-stream` (PDF u iframe-u se
   * nije prikazivao, slike su se oslanjale na sniffing).
   */
  async streamPublic(companyId: string, rawPath: string) {
    const objectPath = assertStoragePath(rawPath, companyId);
    try {
      const stat = await this.minio.client.statObject(
        this.minio.bucket,
        objectPath,
      );
      const stream = await this.minio.client.getObject(
        this.minio.bucket,
        objectPath,
      );
      const contentType =
        stat.metaData?.['content-type'] ?? stat.metaData?.['Content-Type'];
      return {
        stream,
        path: objectPath,
        size: stat.size,
        contentType:
          typeof contentType === 'string' && contentType.length > 0
            ? contentType
            : 'application/octet-stream',
      };
    } catch {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'File not found', 404);
    }
  }

  private requireCompany(actor: AuthUser): string {
    if (!actor.tenantCompanyId) {
      throw new AppError(
        ERROR_CODES.TENANT_HEADER_REQUIRED,
        'X-Company-Id is required',
        403,
      );
    }
    return actor.tenantCompanyId;
  }
}
