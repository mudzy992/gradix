/** R5.2: koji uloge smiju vidjeti cijenu goriva u API/UI. */
const PRICE_VISIBLE = new Set([
  "OWNER",
  "ADMIN",
  "ACCOUNTANT",
  "PROJECT_MANAGER",
  "SITE_SUPERVISOR",
]);

export function canViewFuelPrice(roles: readonly string[]): boolean {
  return roles.some((role) => PRICE_VISIBLE.has(role));
}