import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { assertStoragePath } from '../../common/utils/storage-path';
import { assertProjectWritable } from '../../common/scope/project-lock';
import { ProjectAccessService } from './project-access.service';
import { CreateDocumentDto } from './projects.dto';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async list(actor: AuthUser, projectId: string) {
    await this.access.getVisibleProject(actor, projectId);
    return this.prisma.projectDocument.findMany({ where: { projectId } });
  }

  async create(actor: AuthUser, projectId: string, dto: CreateDocumentDto) {
    const project = await this.access.getVisibleProject(actor, projectId);
    await this.access.assertScopedWrite(actor, project);
    assertProjectWritable(project);
    assertStoragePath(dto.path, project.companyId);
    return this.prisma.projectDocument.create({
      data: {
        companyId: project.companyId,
        projectId,
        path: dto.path,
        fileName: dto.fileName,
      },
    });
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
  }
}
