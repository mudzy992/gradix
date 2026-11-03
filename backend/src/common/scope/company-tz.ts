import type { PrismaService } from '../../modules/prisma/prisma.service';
import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';
import { DEFAULT_TIMEZONE } from '../constants';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export async function readCompanyTimezone(
  prisma: PrismaService,
  companyId: string,
): Promise<string> {
  const row = await prisma.setting.findUnique({
    where: { companyId_key: { companyId, key: 'app.timezone' } },
  });
  return typeof row?.value === 'string' && row.value
    ? row.value
    : DEFAULT_TIMEZONE;
}

export function calendarDateInTz(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function parseDateOnly(value: string): Date {
  if (!DATE_ONLY.test(value)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'date must be YYYY-MM-DD',
      400,
    );
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  // BE-13 (F-04): `new Date('2026-02-31')` ne pada — JavaScript ga tiho prebaci na
  // 3. mart. Za platni period (i dnevnik) to je pogrešan mjesec, pa se datum mora
  // poklopiti sa ulazom.
  if (Number.isNaN(parsed.getTime()) || dateOnlyIso(parsed) !== value) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid date', 400);
  }
  return parsed;
}

export function dateOnlyIso(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function tzDayUtcRange(
  ymd: string,
  timeZone: string,
): { start: Date; end: Date } {
  parseDateOnly(ymd);
  const start = wallTimeToUtc(ymd, timeZone);
  const next = addCalendarDay(ymd);
  return { start, end: wallTimeToUtc(next, timeZone) };
}

export function currentMonthRange(
  now: Date,
  timeZone: string,
): { from: string; to: string } {
  const today = calendarDateInTz(now, timeZone);
  const [year, month] = today.split('-').map(Number);
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextFirst = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  const last = parseDateOnly(nextFirst);
  last.setUTCDate(last.getUTCDate() - 1);
  return { from, to: dateOnlyIso(last) };
}

function addCalendarDay(ymd: string): string {
  const date = parseDateOnly(ymd);
  date.setUTCDate(date.getUTCDate() + 1);
  return dateOnlyIso(date);
}

function wallTimeToUtc(ymd: string, timeZone: string): Date {
  const [year, month, day] = ymd.split('-').map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const instant = new Date(utcGuess);
  const offset = tzOffsetMs(instant, timeZone);
  return new Date(utcGuess - offset);
}

function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}
