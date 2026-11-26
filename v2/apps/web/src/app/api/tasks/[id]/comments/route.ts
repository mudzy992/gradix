/**
 * GET  /api/tasks/{id}/comments — komentari (append-only).
 * POST /api/tasks/{id}/comments — novi komentar; komentar smije pisati svako ko vidi zadatak.
 */
import type { NextRequest } from "next/server";
import { TaskCommentInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { addTaskComment, listTaskComments } from "@/server/task-service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.view");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await params;
    const result = await listTaskComments(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
        scope: guardResult.ctx.scope, projectIds: guardResult.ctx.projectIds,
      },
      id,
    );
    if ("code" in result) {
      if (result.code === "FORBIDDEN") return fail("FORBIDDEN", result.message);
      return fail("VALIDATION_FAILED", result.message);
    }
    return ok({ comments: result });
  } catch (error) {
    return internal(error, "task-comments.list");
  }
}

export async function POST(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    /*
     * Komentar ostaje otvoren svakome ko VIDI zadatak (`projects.view`): šef gradilišta i radnik
     * pišu komentar uz zadatak iako ne upravljaju projektima, a komentar je append-only zapis —
     * ne izmjena zadatka. Zato se ovdje NE traži `tasks.update_status`.
     */
    const guardResult = await guard(request, "projects.view");
    if (!guardResult.ok) return guardResult.response;
    const parsed = TaskCommentInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravan komentar.");
    const { id } = await params;
    const result = await addTaskComment(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
        scope: guardResult.ctx.scope, projectIds: guardResult.ctx.projectIds,
      },
      id,
      parsed.data.body,
      parsed.data.attachmentId ?? null,
    );
    if ("code" in result) {
      if (result.code === "FORBIDDEN") return fail("FORBIDDEN", result.message);
      if (result.code === "NOT_FOUND") return fail("NOT_FOUND", result.message);
      return fail("VALIDATION_FAILED", result.message);
    }
    return ok(result);
  } catch (error) {
    return internal(error, "task-comments.create");
  }
}
