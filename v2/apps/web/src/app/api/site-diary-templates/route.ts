/**
 * GET/PATCH /api/site-diary-templates — šablon PDF dnevnika po firmi (§1.7/31-32).
 *
 * PATCH mijenja zaglavlje i uključene sekcije. `formatConfirmedAt` se postavlja SAMO eksplicitno:
 * dok ga nema, svaki izvoz nosi `DRAFT_FORMAT`. To je jedina tačka gdje sistem tvrdi da je obrazac
 * zakonski potvrđen, pa je ne smije postaviti nijedna druga radnja.
 */
import type { NextRequest } from "next/server";
import { withCompany } from "@gradix/db";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { listDiaryTemplates, type DiaryTemplateSection } from "@/server/diary-template-service";
import { writeAudit } from "@/server/audit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "diary.view");
    if (!guardResult.ok) return guardResult.response;
    const pool = await getVerifiedPool();
    const templates = await withCompany(pool, guardResult.ctx.companyId, (client) =>
      listDiaryTemplates(client, guardResult.ctx.companyId),
    );
    return ok({ templates });
  } catch (error) {
    return internal(error, "site-diary-templates.list");
  }
}

type PatchBody = {
  id: string;
  name?: string;
  header?: { companyLine?: string | null; projectLine?: string | null; legalNote?: string | null };
  sections?: DiaryTemplateSection[];
  confirmFormat?: boolean;
};

export async function PATCH(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "diary.manage");
    if (!guardResult.ok) return guardResult.response;
    const body = (await request.json().catch(() => null)) as PatchBody | null;
    if (!body?.id) return fail("VALIDATION_FAILED", "id šablona je obavezan.");
    const ctx = guardResult.ctx;

    const outcome = await withCompany(await getVerifiedPool(), ctx.companyId, async (client) => {
      const current = await client.query<{ name: string; header: Record<string, unknown>; sections: DiaryTemplateSection[] }>(
        "SELECT name, header, sections FROM public.site_diary_templates WHERE company_id = $1 AND id = $2",
        [ctx.companyId, body.id],
      );
      const row = current.rows[0];
      if (!row) return { outcome: "NOT_FOUND" as const };

      const header = { ...row.header, ...(body.header ?? {}) };
      const sections = body.sections ?? row.sections;
      /* Sekcije moraju imati poznat ključ — nepoznata sekcija bi u PDF-u bila prazna rupa. */
      const allowed = new Set(["HEADER", "WEATHER", "WORKERS", "MACHINES", "QUANTITIES", "HAULS", "EVENTS", "DELAYS", "ATTACHMENTS", "SIGNATURES"]);
      if (!Array.isArray(sections) || sections.some((section) => !allowed.has(section.key))) {
        return { outcome: "VALIDATION_FAILED" as const, message: "Šablon sadrži nepoznatu sekciju." };
      }

      await client.query(
        `UPDATE public.site_diary_templates
            SET name = COALESCE($3, name), header = $4::jsonb, sections = $5::jsonb,
                format_confirmed_at = CASE WHEN $6 THEN COALESCE(format_confirmed_at, clock_timestamp())
                                           ELSE format_confirmed_at END,
                format_confirmed_by = CASE WHEN $6 THEN COALESCE(format_confirmed_by, $7) ELSE format_confirmed_by END,
                updated_at = clock_timestamp(), updated_by = $7
          WHERE company_id = $1 AND id = $2`,
        [ctx.companyId, body.id, body.name ?? null, JSON.stringify(header), JSON.stringify(sections),
          body.confirmFormat === true, ctx.userId],
      );
      await writeAudit(client, {
        companyId: ctx.companyId,
        actorId: ctx.userId,
        actorEmail: null,
        action: "diary.template_updated",
        entityType: "site_diary",
        entityId: body.id,
        metadata: { confirmed: body.confirmFormat === true, sections: sections.length },
        retentionClass: "ACCESS",
      });
      return { outcome: "OK" as const };
    });

    if (outcome.outcome === "NOT_FOUND") return fail("NOT_FOUND", "Šablon ne postoji.");
    if (outcome.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", outcome.message);
    return ok({ templates: await withCompany(await getVerifiedPool(), ctx.companyId, (client) =>
      listDiaryTemplates(client, ctx.companyId)) });
  } catch (error) {
    return internal(error, "site-diary-templates.patch");
  }
}
