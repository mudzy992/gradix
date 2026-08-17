import ExcelJS from 'exceljs';
import { PayrollSessionDto } from './serialize-payroll';

export async function writePayrollXlsx(
  rows: PayrollSessionDto[],
  totals: { minutes: number; amount: string },
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('payroll');
  const columns = [
    'user',
    'project',
    'task',
    'startedAt',
    'durationMinutes',
    'rate',
    'amount',
  ];
  sheet.addRow(columns);
  for (const row of rows) {
    sheet.addRow([
      row.userName,
      row.projectName,
      row.taskTitle,
      row.startedAt.toISOString(),
      row.durationMinutes,
      row.hourlyRate ?? '',
      row.amount,
    ]);
  }
  sheet.addRow(['TOTAL', '', '', '', totals.minutes, '', totals.amount]);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
