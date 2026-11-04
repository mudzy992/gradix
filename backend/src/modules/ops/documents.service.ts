import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { assertStoragePath } from '../../common/utils/storage-path';
import { assertProjectWritable } from '../../common/scope/project-lock';
import { ProjectAccessService } from './project-access.service';
import { CreateDocumentDto } from './projects.dto';

// Do not expose retry keys in responses or document lists.
const documentFields = {
  id: true,
  companyId: true,
  projectId: true,
  path: true,
  fileName: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, projectId: string) {
    await this.access.getVisibleProject(actor, projectId);
    return this.prisma.projectDocument.findMany({
      where: { projectId },
      select: documentFields,
    });
  }

  async create(actor: AuthUser, projectId: string, dto: CreateDocumentDto) {
    const project = await this.access.getVisibleProject(actor, projectId);
    await this.access.assertScopedWrite(actor, project);
    assertProjectWritable(project);
    assertStoragePath(dto.path, project.companyId);
    const idempotencyKey = dto.idempotencyKey?.toLowerCase();
    let row: {
      id: string;
      companyId: string;
      projectId: string;
      path: string;
      fileName: string;
      createdAt: Date;
      updatedAt: Date;
    };
    try {
      row = await this.prisma.projectDocument.create({
        data: {
          companyId: project.companyId,
          projectId,
          path: dto.path,
          fileName: dto.fileName,
          idempotencyKey,
        },
        select: documentFields,
      });
    } catch (error) {
      if (
        !idempotencyKey ||
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      )
        throw error;
      // The unique index serializes concurrent attempts. A different payload must
      // never be mistaken for the original operation, including after a race.
      const existing = await this.prisma.projectDocument.findFirst({
        where: { projectId, idempotencyKey },
        select: documentFields,
      });
      if (!existing) throw error;
      if (existing.path !== dto.path || existing.fileName !== dto.fileName) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          'Idempotency key already used',
          409,
        );
      }
      return existing;
    }
    await this.audit.write({
      companyId: project.companyId,
      actorId: actor.id,
      action: 'PROJECT_DOCUMENT_ADDED',
      entityType: 'ProjectDocument',
      entityId: row.id,
      payload: { projectId, fileName: row.fileName },
    });
    return row;
  }

  async remove(actor: AuthUser, projectId: string, id: string): Promise<void> {
    const project = await this.access.getVisibleProject(actor, projectId);
    await this.access.assertScopedWrite(actor, project);
    assertProjectWritable(project);
    const row = await this.prisma.projectDocument.findFirst({
      where: { id, projectId },
    });
    if (!row) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Document not found', 404);
    }
    await this.prisma.projectDocument.delete({ where: { id } });
    await this.audit.write({
      companyId: project.companyId,
      actorId: actor.id,
      action: 'PROJECT_DOCUMENT_REMOVED',
      entityType: 'ProjectDocument',
      entityId: id,
      payload: { projectId, fileName: row.fileName },
    });
  }
}
