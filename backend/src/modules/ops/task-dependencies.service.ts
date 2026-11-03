import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { ProjectAccessService } from './project-access.service';
import { TasksService } from './tasks.service';
import { DependencyDto } from './tasks.dto';

@Injectable()
export class TaskDependenciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly tasks: TasksService,
  ) {}

  async add(actor: AuthUser, taskId: string, dto: DependencyDto) {
    const task = await this.tasks.loadVisibleTask(actor, taskId);
    const project = await this.access.getVisibleProject(actor, task.projectId);
    await this.access.assertScopedWrite(actor, project);
    const toId = dto.toId || taskId;
    const fromId = dto.fromId;
    const from = await this.prisma.task.findFirst({
      where: { id: fromId, projectId: task.projectId },
    });
    const to = await this.prisma.task.findFirst({
      where: { id: toId, projectId: task.projectId },
    });
    if (!from || !to) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Dependency must be same project',
        400,
      );
    }
    // BE-06: unique [fromId, toId] je ranije vraćao 500 (P2002).
    const duplicate = await this.prisma.taskDependency.findFirst({
      where: { fromId, toId },
    });
    if (duplicate) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'Dependency already exists',
        409,
      );
    }
    if (await this.wouldCycle(fromId, toId)) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Dependency cycle',
        400,
      );
    }
    return this.prisma.taskDependency.create({
      data: { companyId: project.companyId, fromId, toId, type: 'FS' },
    });
  }

  async remove(actor: AuthUser, taskId: string, id: string): Promise<void> {
    const task = await this.tasks.loadVisibleTask(actor, taskId);
    const project = await this.access.getVisibleProject(actor, task.projectId);
    await this.access.assertScopedWrite(actor, project);
    const row = await this.prisma.taskDependency.findFirst({
      where: { id, OR: [{ fromId: taskId }, { toId: taskId }] },
    });
    if (!row) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Dependency not found', 404);
    }
    await this.prisma.taskDependency.delete({ where: { id } });
  }

  private async wouldCycle(fromId: string, toId: string): Promise<boolean> {
    const visited = new Set<string>();
    const stack = [toId];
    while (stack.length) {
      const current = stack.pop()!;
      if (current === fromId) {
        return true;
      }
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      const next = await this.prisma.taskDependency.findMany({
        where: { fromId: current },
      });
      for (const edge of next) {
        stack.push(edge.toId);
      }
    }
    return false;
  }
}
