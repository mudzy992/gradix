/**
 * Javni izlaz paketa `@gradix/db`.
 *
 * U Fazi 1 postoji samo tenant scope i pool. Prisma klijent se NE izvozi dok se ne
 * riješi blokada iz ADR 0002: generator Prisma 7 skida `schema-engine` sa
 * binaries.prisma.sh, a taj host nije dostupan u ovom okruženju. Do tada svi upiti
 * idu kroz `withCompany` + parametrizovani SQL, što je isti mehanizam koji bi
 * Prisma koristila (`SET LOCAL app.company_id` u transakciji).
 */
export { companyId, setTenant, withCompany, type CompanyId } from "./tenant.js";
