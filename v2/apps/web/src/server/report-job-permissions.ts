import { isScope, type ReportKey, type Scope } from "@gradix/domain";
import { can, PERMISSION_KEYS, ROLES, type Permission, type Role } from "./permissions";

export const SOURCE_PERMISSION: Record<ReportKey, Permission> = {
  PROJECT_COSTS: "projects.costs.view", MACHINE_UTILIZATION: "equipment.view", FUEL: "machines.fuel.view",
  WORK_HOURS: "payroll.hours.export", DEADLINES: "obligations.view", TENDERS: "tenders.view", HSE: "hse.view",
};

export type ReportJobAccess = {roles: readonly Role[]; scope: Scope; projectIds: readonly string[] | null};
export type GeneratedReportAccess = ReportJobAccess & {permissions: readonly Permission[]};

/** Stored JSON is untrusted. Fail closed if the generated authorization snapshot is malformed. */
export function parseGeneratedAccess(value: unknown): GeneratedReportAccess | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v=value as Record<string,unknown>;
  if (!isScope(v.scope) || !Array.isArray(v.roles) || !v.roles.length ||
      !v.roles.every(r=>typeof r === "string" && ROLES.includes(r as Role))) return null;
  if (!Array.isArray(v.permissions) || !v.permissions.includes("reports.view") || !v.permissions.includes("export.data") ||
      !v.permissions.every(p=>typeof p === "string" && PERMISSION_KEYS.includes(p as Permission))) return null;
  const ids=v.projectIds;
  if (v.scope === "COMPANY" ? ids !== null : !Array.isArray(ids) ||
    !ids.every(id=>typeof id === "string" && id.length > 0 && id.length <= 128)) return null;
  if (v.scope === "SELF" && (ids as string[]).length !== 0) return null;
  return {roles:v.roles as Role[],scope:v.scope,projectIds:ids as string[] | null,permissions:v.permissions as Permission[]};
}

/** Restrictive intersection: gaining a role or project after requesting cannot widen an export. */
export function intersectReportAccess(requested: ReportJobAccess, current: ReportJobAccess): ReportJobAccess {
  const roles=requested.roles.filter(role=>current.roles.includes(role));
  if (requested.scope === "SELF" || current.scope === "SELF") return {roles,scope:"SELF",projectIds:[]};
  if (requested.scope === "COMPANY" && current.scope === "COMPANY") return {roles,scope:"COMPANY",projectIds:null};
  const oldIds=requested.scope === "COMPANY" ? null : requested.projectIds ?? [];
  const newIds=current.scope === "COMPANY" ? null : current.projectIds ?? [];
  const projectIds=oldIds === null ? [...(newIds ?? [])] : newIds === null ? [...oldIds] : oldIds.filter(id=>newIds.includes(id));
  return {roles,scope:"PROJECTS",projectIds};
}

/** A stored file is indivisible: never serve it if any role or project used at generation was lost. */
export function coversGeneratedAccess(generated: GeneratedReportAccess, current: ReportJobAccess): boolean {
  if (!generated.permissions.length || !generated.permissions.every(permission=>can(current.roles,permission))) return false;
  if (!generated.roles.length || !current.roles.length || !generated.roles.every(role=>current.roles.includes(role))) return false;
  if ((generated.scope === "COMPANY" && generated.projectIds !== null) ||
      (generated.scope === "PROJECTS" && !Array.isArray(generated.projectIds)) ||
      (generated.scope === "SELF" && (!Array.isArray(generated.projectIds) || generated.projectIds.length !== 0))) return false;
  if (generated.scope === "COMPANY") return current.scope === "COMPANY";
  if (generated.scope === "SELF") return current.scope === "SELF" || current.scope === "COMPANY";
  if (current.scope === "COMPANY") return true;
  if (current.scope !== "PROJECTS" || !generated.projectIds || !current.projectIds) return false;
  return generated.projectIds.every(id=>current.projectIds!.includes(id));
}

export function canRunReport(access: ReportJobAccess, key: ReportKey): boolean {
  return can(access.roles,"reports.view") && can(access.roles,"export.data") && can(access.roles,SOURCE_PERMISSION[key]);
}
