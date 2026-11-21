import { Task, TaskPriority } from '../../../generated/client';

export function serializeTask(
  task: Task & { assignees?: { userId: string }[] },
) {
  return {
    id: task.id,
    companyId: task.companyId,
    projectId: task.projectId,
    phaseId: task.phaseId,
    title: task.title,
    description: task.description,
    priority: task.priority,
    status: task.status,
    plannedStart: task.plannedStart,
    plannedEnd: task.plannedEnd,
    totalTimeSpentMinutes: task.totalTimeSpentMinutes,
    assigneeIds: task.assignees?.map((item) => item.userId),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}
