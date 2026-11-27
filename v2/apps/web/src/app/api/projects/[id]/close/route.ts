/**
 * POST /api/projects/{id}/close — `FINISHED` + zamrznut snapshot.
 *
 * Nakon ovoga knjiženje je BLOKIRANO (triger `cost_entry_guard`). `PENDING` trošak se može
 * prihvatiti uz razlog — inače bi jedan račun držao projekat otvoren mjesecima i ljudi bi
 * zaobilazili zatvaranje.
 */
import type { NextRequest } from "next/server";
import { ProjectCloseInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { closeProject } from "@/server/project-finance-service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.manage");
    if (!guardResult.ok) return guardResult.response;
    const parsed = ProjectCloseInput.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravan zahtjev za zatvaranje.");
    const { id } = await params;
    const result = await closeProject(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      parsed.data.pendingCostsReason ?? null,
    );
    if ("code" in result) {
      if (result.code === "FORBIDDEN") return fail("FORBIDDEN", result.message);
      if (result.code === "NOT_FOUND") return fail("NOT_FOUND", result.message);
      if (result.code === "CONFLICT") return fail("CONFLICT", result.message);
      if (result.code === "PROJECT_CLOSE_CHECKLIST_INCOMPLETE") {
        return fail("PROJECT_CLOSE_CHECKLIST_INCOMPLETE", result.message);
      }
      return fail("VALIDATION_FAILED", result.message);
    }
    return ok(result);
  } catch (error) {
    return internal(error, "project-close.post");
  }
}
