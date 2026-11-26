import type { ReportKey, Scope } from "@gradix/domain";
import { can, type Permission, type Role } from "./permissions";

export const SOURCE_PERMISSION: Record<ReportKey, Permission> = {
  PROJECT_COSTS: "projects.costs.view", MACHINE_UTILIZATION: "equipment.view", FUEL: "machines.fuel.view",
  WORK_HOURS: "payroll.hours.export", DEADLINES: "obligations.view", TENDERS: "tenders.view", HSE: "hse.view",
};

export type ReportJobAccess = {roles: readonly Role[]; scope: Scope; projectIds: readonly string[] | null};

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
export function coversGeneratedAccess(generated: ReportJobAccess, current: ReportJobAccess): boolean {
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
