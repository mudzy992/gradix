/** Report catalogue only; loaders and authorization are server-side. */
export const REPORT_DEFINITIONS = {
  PROJECT_COSTS: { title: "Trošak po projektu" },
  MACHINE_UTILIZATION: { title: "Iskorištenost i trošak mašina" },
  FUEL: { title: "Potrošnja goriva" },
  WORK_HOURS: { title: "Radni sati po radniku i projektu" },
  DEADLINES: { title: "Rokovi i isteci" },
  TENDERS: { title: "Tenderi" },
  HSE: { title: "Zaštita na radu" },
} as const;
export type ReportKey = keyof typeof REPORT_DEFINITIONS;
export function isReportKey(value: string): value is ReportKey {
  return Object.hasOwn(REPORT_DEFINITIONS, value);
}
