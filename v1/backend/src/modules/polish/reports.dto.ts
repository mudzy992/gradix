import { IsOptional, IsString } from 'class-validator';

export const REPORT_SLUGS = [
  'project-spend',
  'machine-hours',
  'fuel-summary',
  'trips-summary',
  'tender-comparison',
  'phase-quantities',
] as const;

export type ReportSlug = (typeof REPORT_SLUGS)[number];

export class ReportQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  projectId?: string;
}
