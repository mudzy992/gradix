import { Prisma } from '../../../generated/client';
import { payrollAmount } from './payroll-amount';

export type PayrollSessionSource = {
  id: string;
  userId: string;
  startedAt: Date;
  closedAt: Date | null;
  durationMinutes: number | null;
  pauseAccumMinutes: number;
  approvalStatus: string;
  user: {
    firstName: string;
    lastName: string;
    hourlyRate: Prisma.Decimal | null;
  };
  task: {
    id: string;
    title: string;
    projectId: string;
    project: { id: string; name: string };
  };
};

export type PayrollSessionDto = {
  id: string;
  userId: string;
  userName: string;
  projectId: string;
  projectName: string;
  taskId: string;
  taskTitle: string;
  startedAt: Date;
  closedAt: Date | null;
  durationMinutes: number;
  hourlyRate: string | null;
  amount: string;
  approvalStatus: string;
};

export function serializePayrollSession(row: PayrollSessionSource): PayrollSessionDto {
  const durationMinutes = row.durationMinutes ?? 0;
  return {
    id: row.id,
    userId: row.userId,
    userName: `${row.user.firstName} ${row.user.lastName}`.trim(),
    projectId: row.task.project.id,
    projectName: row.task.project.name,
    taskId: row.task.id,
    taskTitle: row.task.title,
    startedAt: row.startedAt,
    closedAt: row.closedAt,
    durationMinutes,
    hourlyRate: row.user.hourlyRate?.toFixed(2) ?? null,
    amount: payrollAmount(durationMinutes, row.user.hourlyRate).toFixed(2),
    approvalStatus: row.approvalStatus,
  };
}
