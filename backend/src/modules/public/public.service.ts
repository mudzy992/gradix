import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { FilesService } from '../files/files.service';
import { detectMime } from '../files/detect-mime';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { SLUG_PATTERN } from '../../common/constants';
import { listResult, parsePagination } from '../../common/utils/pagination';
import { requireCompany } from '../users/users-helpers';
import { CreatePublicAssetDto, PatchProjectPublicDto } from './public.dto';
import {
  serializePublicCompany,
  serializePublicProject,
} from './serialize-public';

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  async getBySlug(slug: string) {
    const company = await this.requirePublicCompany(slug);
    const settings = await this.readPublicSettings(company.id);
    return serializePublicCompany(company, settings);
  }

  async listProjects(slug: string, page?: number, limit?: number) {
    const company = await this.requirePublicCompany(slug);
    const parsed = parsePagination(page, limit);
    const where = { companyId: company.id, isPublic: true, archivedAt: null };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        skip: parsed.skip,
        take: parsed.limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.project.count({ where }),
    ]);
    return listResult(
      rows.map(serializePublicProject),
      total,
      parsed.page,
      parsed.limit,
    );
  }

  async streamAsset(id: string, response: Response): Promise<void> {
    const asset = await this.prisma.publicAsset.findUnique({
      where: { id },
      include: { company: { select: { isActive: true } } },
    });
    if (!asset || !asset.company.isActive) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Not found', 404);
    }
    const { stream } = await this.files.streamPublic(
      asset.companyId,
      asset.path,
    );
    response.setHeader('Content-Type', asset.mime);
    response.setHeader('Cache-Control', 'public, max-age=3600');
    stream.pipe(response);
  }

  async createAsset(
    actor: AuthUser,
    dto: CreatePublicAssetDto,
    file: Express.Multer.File,
  ) {
    const companyId = requireCompany(actor);
    this.assertImage(file);
    if (dto.kind === 'COVER' && !dto.projectId) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'projectId required for COVER',
        400,
      );
    }
    const uploaded = await this.files.upload(actor, file);
    const asset = await this.prisma.publicAsset.create({
      data: {
        companyId,
        path: uploaded.path,
        mime: uploaded.mime,
        kind: dto.kind,
      },
    });
    if (dto.kind === 'LOGO') {
      await this.prisma.company.update({
        where: { id: companyId },
        data: { logoAssetId: asset.id },
      });
    } else if (dto.projectId) {
      await this.linkCover(companyId, dto.projectId, asset.id);
    }
    return { id: asset.id, kind: asset.kind, mime: asset.mime };
  }

  async patchProjectPublic(
    actor: AuthUser,
    id: string,
    dto: PatchProjectPublicDto,
  ) {
    const companyId = requireCompany(actor);
    const project = await this.prisma.project.findFirst({
      where: { id, companyId },
    });
    if (!project) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Not found', 404);
    }
    if (dto.coverAssetId) {
      await this.assertCoverAsset(companyId, dto.coverAssetId);
    }
    const updated = await this.prisma.project.update({
      where: { id },
      data: { isPublic: dto.isPublic, coverAssetId: dto.coverAssetId },
    });
    return { ...serializePublicProject(updated), isPublic: updated.isPublic };
  }

  private async requirePublicCompany(slug: string) {
    if (!SLUG_PATTERN.test(slug)) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Not found', 404);
    }
    const company = await this.prisma.company.findUnique({ where: { slug } });
    if (!company || !company.isActive) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Not found', 404);
    }
    return company;
  }

  private async readPublicSettings(
    companyId: string,
  ): Promise<Record<string, string>> {
    const rows = await this.prisma.setting.findMany({
      where: {
        companyId,
        key: { in: ['public.companyName', 'public.tagline', 'public.contact'] },
      },
    });
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = typeof row.value === 'string' ? row.value : '';
    }
    return result;
  }

  private async linkCover(
    companyId: string,
    projectId: string,
    assetId: string,
  ): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
    });
    if (!project) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Not found', 404);
    }
    await this.prisma.project.update({
      where: { id: projectId },
      data: { coverAssetId: assetId },
    });
  }

  private async assertCoverAsset(
    companyId: string,
    assetId: string,
  ): Promise<void> {
    const asset = await this.prisma.publicAsset.findFirst({
      where: { id: assetId, companyId, kind: 'COVER' },
    });
    if (!asset) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Invalid coverAssetId',
        400,
      );
    }
  }

  private assertImage(file: Express.Multer.File): void {
    if (!file) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'File required', 400);
    }
    const mime = detectMime(file.buffer) ?? '';
    if (!IMAGE_MIMES.has(mime)) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Unsupported file type',
        400,
      );
    }
  }
}
