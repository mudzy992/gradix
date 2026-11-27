/**
 * Javni izlaz paketa `@gradix/db`.
 *
 * Tenant scope (`withCompany`) je JEDINO mjesto gdje upit dobija firmu (ADR 0003).
 * Tipovi tabela se NE pišu ručno: generiše ih `kysely-codegen` iz žive baze
 * (`pnpm db:types`, ADR 0015), pa se ne mogu razići sa stvarnom šemom.
 */
export { companyId, setTenant, withCompany, withCompanyTransactionContext, type CompanyId } from "./tenant";
export type { DB, Companies, Workers, Machines, Projects } from "./schema.generated";

export { periodTotals } from "./period-totals";

export { hoursExportSegments, type HoursExportSegment } from "./hours-export";
