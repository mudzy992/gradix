/**
 * GET  /api/tasks — zadaci: moji danas, kasne, po projektu.
 * POST /api/tasks — novi zadatak (jedan izvršilac: radnik ILI nalog).
 */
import type { NextRequest } from "next/server";
import { ProjectTaskInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { listTasks, saveTask } from "@/server/task-service";
import type { TaskQuery } from "@/server/task-types";
import type { AuthContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.view");
    if (!guardResult.ok) return guardResult.response;
    const params = request.nextUrl.searchParams;
    const query: TaskQuery = {
      projectId: params.get("projectId") ?? undefined,
      assignee: params.get("assignee") === "ME" ? "ME" : "ALL",
      open: params.get("open") === "1",
      assignedProjects: params.get("assignedProjects") === "1",
      due: params.get("due") === "TODAY" ? "TODAY" : params.get("due") === "OVERDUE" ? "OVERDUE" : undefined,
    };
    const status = params.get("status");
    if (status && ["OPEN", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"].includes(status)) {
      query.status = status as TaskQuery["status"];
    }
    const result = await saveOrList(await getVerifiedPool(), guardResult.ctx, query);
    if ("code" in result) {
      if (result.code === "FORBIDDEN") return fail("FORBIDDEN", result.message);
      return fail("VALIDATION_FAILED", result.message);
    }
    return ok(result);
  } catch (error) {
    return internal(error, "tasks.list");
  }
}

async function saveOrList(
  pool: Awaited<ReturnType<typeof getVerifiedPool>>,
  ctx: AuthContext,
  query: TaskQuery,
) {
  return listTasks(pool, { userId: ctx.userId, companyId: ctx.companyId, roles: ctx.roles as Role[], scope: ctx.scope, projectIds: ctx.projectIds }, query);
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.manage");
    if (!guardResult.ok) return guardResult.response;
    const parsed = ProjectTaskInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravan unos zadatka.");
    const result = await saveTask(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
        scope: guardResult.ctx.scope, projectIds: guardResult.ctx.projectIds,
      },
      parsed.data,
      false,
    );
    if ("code" in result) {
      if (result.code === "FORBIDDEN") return fail("FORBIDDEN", result.message);
      if (result.code === "NOT_FOUND") return fail("NOT_FOUND", result.message);
      return fail("VALIDATION_FAILED", result.message);
    }
    return ok(result);
  } catch (error) {
    return internal(error, "tasks.create");
  }
}
