import { ProjectStatus } from '../../../generated/client';
import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';

const ALLOWED: Record<ProjectStatus, ProjectStatus[]> = {
  PLANNING: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['ON_HOLD', 'COMPLETED', 'CANCELLED'],
  ON_HOLD: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function assertStatusTransition(
  from: ProjectStatus,
  to: ProjectStatus,
): void {
  if (from === to) {
    return;
  }
  if (!ALLOWED[from].includes(to)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `Cannot transition ${from} → ${to}`,
      400,
    );
  }
}

export function assertProjectWritable(project: {
  status: ProjectStatus;
  archivedAt: Date | null;
}): void {
  if (
    project.archivedAt ||
    project.status === 'COMPLETED' ||
    project.status === 'CANCELLED'
  ) {
    throw new AppError(
      ERROR_CODES.PROJECT_TERMINAL,
      'Project is terminal or archived',
      409,
    );
  }
}

export function assertNotOnHold(project: { status: ProjectStatus }): void {
  if (project.status === 'ON_HOLD') {
    throw new AppError(ERROR_CODES.PROJECT_ON_HOLD, 'Project is on hold', 409);
  }
}
