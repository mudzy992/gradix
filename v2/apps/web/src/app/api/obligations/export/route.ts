/**
 * GET /api/obligations/export?format=csv|pdf — izvoz rokova (§10).
 *
 * Isti filteri kao lista (`state`, `entityKind`, `typeId`, `workerId`, `machineId`, `projectId`),
 * pa izvezeno stanje odgovara onome što je korisnik vidio na ekranu. Radnik (`SELF` opseg) ne
 * dobija izvoz: spisak svih radnika firme nije njegov podatak.
 *
 * Izvoz se auditira (`obligation.exported`): ko je i kad iznio spisak ličnih dokumenata mora
 * ostati zapisano — isto pravilo kao za pristup medicinskom nalazu.
 */
import type { NextRequest } from "next/server";
import { fail, internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { can } from "@/server/permissions";
import { listObligations } from "@/server/obligation-service";
import { writeAudit } from "@/server/audit";
import { withCompany } from "@gradix/db";
import {
  OBLIGATION_EXPORT_COLUMNS,
  STATE_LABELS_SR,
  buildObligationsCsv,
  buildObligationsPdf,
  pdfRowsFrom,
  type ObligationExportRow,
} from "@/server/obligation-export-service";

export const dynamic = "force-dynamic";

/** Gornja granica izvoza: više od ovoga je izvještaj za štampu, ne lista. */
const MAX_ROWS = 5_000;

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "obligations.view");
    if (!guardResult.ok) return guardResult.response;
    const ctx = guardResult.ctx;

    // Izvoz cijele firme nije za radnika: `SELF` opseg bi dao samo njegove redove, pa izvoz
    // nema smisla — a ako bi ga dobio, dvije rute bi imale različito vidno polje.
    if (!can(ctx.roles, "export.data") || !can(ctx.roles, "workers.view")) {
      return fail("FORBIDDEN", "Izvoz rokova zahtijeva pravo izvoza i pregled radnika.");
    }

    const params = request.nextUrl.searchParams;
    const format = params.get("format") ?? "csv";
    if (format !== "csv" && format !== "pdf") {
      return fail("VALIDATION_FAILED", "Format mora biti „csv“ ili „pdf“.");
    }

    const page = await listObligations(
      await getVerifiedPool(),
      ctx.companyId,
      {
        state: params.get("state") ?? undefined,
        entityKind: params.get("entityKind") ?? undefined,
        typeId: params.get("typeId") ?? undefined,
        workerId: params.get("workerId") ?? undefined,
        machineId: params.get("machineId") ?? undefined,
        projectId: params.get("projectId") ?? undefined,
        includeSuperseded: false,
      },
      {
        scope: ctx.scope, projectIds: ctx.projectIds,
        userId: ctx.userId,
        // Izvoz ne nosi priloge: spisak za štampu ne sadrži skenove, bez obzira na dozvolu.
        includeAttachments: false,
      },
    );

    if (page.obligations.length > MAX_ROWS) {
      return fail("VALIDATION_FAILED", `Previše redova za izvoz (${page.obligations.length}). Sužite filter.`);
    }

    const rows: ObligationExportRow[] = page.obligations.map((row) => ({
      typeLabel: row.typeLabel,
      entityKind: row.entityKind,
      entityName:
        row.workerName ?? row.machineCode ?? row.projectCode ?? row.tenderTitle ?? "—",
      number: row.number,
      issuer: row.issuer,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      reviewAt: row.reviewAt,
      state: row.state,
      stateLabel: STATE_LABELS_SR[row.state] ?? row.state,
      daysLeft: row.daysLeft,
      responsibleName: row.responsibleName,
      note: can(ctx.roles, "workers.sensitive.view") ? row.note : null,
    }));

    // Trag ide PRIJE odgovora: ako upis padne, izvoz se ne šalje (ne postoji izvezeno bez traga).
    await withCompany(await getVerifiedPool(), ctx.companyId, async (client) => {
      await writeAudit(client, {
        companyId: ctx.companyId,
        actorId: ctx.userId,
        actorEmail: null,
        action: "obligation.exported",
        entityType: "obligation",
        entityId: `export_${Date.now()}`,
        metadata: { format, rows: rows.length, filter: sanitizeFilter(params) },
        retentionClass: "ACCESS",
      });
    });

    if (format === "csv") {
      return new Response(buildObligationsCsv(rows), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="rokovi-${page.today}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const pdf = buildObligationsPdf({
      title: "Rokovi",
      subtitle: `Stanje na ${page.today} — ${rows.length} redova`,
      columns: OBLIGATION_EXPORT_COLUMNS.map((column) => ({
        header: column.header,
        width: column.width,
      })),
      rows: pdfRowsFrom(rows),
    });
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="rokovi-${page.today}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return internal(error, "obligations.export");
  }
}

/** Filter bez ličnih podataka — u trag ide ŠTA je izvezeno, ne čiji dokument. */
function sanitizeFilter(params: URLSearchParams): Record<string, string> {
  const keys = ["state", "entityKind", "typeId", "workerId", "machineId", "projectId"];
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = params.get(key);
    if (value) out[key] = value;
  }
  return out;
}
