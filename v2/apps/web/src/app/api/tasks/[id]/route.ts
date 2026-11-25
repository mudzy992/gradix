/** PATCH /api/tasks/{id} — izmjena zadatka / prelazak statusa; `DONE` postavlja `completed_at`. */
import type { NextRequest } from "next/server";
import { ProjectTaskPatch } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { saveTask } from "@/server/task-service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    /*
     * Dozvola se bira prema tome ŠTA zahtjev mijenja (F5/Korak 0):
     *   - samo `status`  → `tasks.update_status` (šef gradilišta na svojim projektima),
     *   - bilo šta drugo → `projects.manage` (ured).
     *
     * Servis ponavlja provjeru i ograničava polja — ruta ne smije biti jedina kapija, jer je
     * zovu i testovi i mobilni klijent.
     */
    const body = await request.json().catch(() => null);
    const statusOnlyRequest =
      typeof body === "object" && body !== null && Object.keys(body).every((key) => key === "status");
    const guardResult = await guard(
      request,
      statusOnlyRequest ? "tasks.update_status" : "projects.manage",
    );
    if (!guardResult.ok) return guardResult.response;
    const parsed = ProjectTaskPatch.safeParse(body);
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravna izmjena zadatka.");
    const { id } = await params;
    const result = await saveTask(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
        scope: guardResult.ctx.scope,
        projectIds: guardResult.ctx.projectIds,
      },
      { ...parsed.data, id },
      true,
    );
    if ("code" in result) {
      if (result.code === "FORBIDDEN") return fail("FORBIDDEN", result.message);
      if (result.code === "NOT_FOUND") return fail("NOT_FOUND", result.message);
      return fail("VALIDATION_FAILED", result.message);
    }
    return ok(result);
  } catch (error) {
    return internal(error, "tasks.update");
  }
}
