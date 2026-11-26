import type { PoolClient } from "pg";
import type { Scope } from "@gradix/domain";
import type { can } from "./permissions";

/** The scope comes exclusively from the authenticated session, never from query parameters. */
export type TaskActor = {
  userId: string;
  companyId: string;
  roles: Parameters<typeof can>[0];
  scope: Scope;
  projectIds: string[] | null;
};

/** Appends the predicates and matching parameters to any task query. SELF sees assigned tasks only. */
export function taskScope(actor: TaskActor, params: unknown[], alias = "t"): string {
  if (actor.scope === "COMPANY") return "TRUE";
  if (actor.scope === "PROJECTS") {
    params.push(actor.projectIds ?? []);
    return `${alias}.project_id = ANY($${params.length}::text[])`;
  }
  params.push(actor.userId);
  const user = `$${params.length}`;
  return `(${alias}.assignee_user_id = ${user} OR ${alias}.assignee_worker_id IN
    (SELECT w.id FROM public.workers w WHERE w.company_id = ${alias}.company_id AND w.user_id = ${user}))`;
}

export function allowedTaskProject(actor: TaskActor, projectId: string | null): boolean {
  return actor.scope === "COMPANY" || (actor.scope === "PROJECTS" && projectId !== null && (actor.projectIds ?? []).includes(projectId));
}

/** A phase is only valid on its own project, including when a task is moved. */
export async function phaseMatchesProject(
  client: PoolClient, companyId: string, projectId: string | null, phaseId: string | null,
): Promise<boolean> {
  if (!phaseId) return true;
  const result = await client.query("SELECT 1 FROM public.project_phases WHERE company_id=$1 AND id=$2 AND project_id=$3", [companyId, phaseId, projectId]);
  return result.rows.length > 0;
}
