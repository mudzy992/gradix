/**
 * F4 (Modul 5 §1.4) — stacionaža: šifarnik dionica sa kilometražom + zbir izvedenih količina.
 *
 * Zašto kilometraža numerički, a ne slobodan tekst (dosadašnje stanje): zbir po dionici je
 * ULAZ u Modul 6 (predmjer) i kasnije u situacije. Iz teksta „od kbr. 3 do kbr. 7 + 240 m" se
 * ne sabira, pa se količina po dionici nikad ne bi mogla izvesti — a to je jedini razlog zašto
 * dionica postoji.
 *
 * Pravila koja servis drži (baza ima iste CHECK-ove, ali poruke su ovdje razumljive):
 *  - ili su OBA kraja numerička, ili nijedan — pola kilometraže je gore od nikakve;
 *  - kraj mora biti STROGO poslije početka: dionica ima smjer;
 *  - zbir se računa iz `hauls`, ne čuva se: ispravka ture mora odmah promijeniti zbir.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { writeAudit } from "./audit";
import { can, type Role } from "./permissions";

export type SegmentActor = { userId: string; companyId: string; roles: readonly Role[] };

export type SegmentView = {
  id: string;
  code: string;
  name: string;
  project_id: string | null;
  project_code: string | null;
  project_name: string | null;
  from_station: string | null;
  to_station: string | null;
  from_km: number | null;
  from_m: number | null;
  to_km: number | null;
  to_m: number | null;
  length_m: number | null;
  haul_count: number;
  quantity_sum: number | null;
  quantity_unit: string | null;
};

export type SegmentInput = {
  id?: string;
  code: string;
  name: string;
  projectId?: string | null;
  fromStation?: string | null;
  toStation?: string | null;
  fromKm?: number | null;
  fromM?: number | null;
  toKm?: number | null;
  toM?: number | null;
};

export type SegmentOutcome =
  | { outcome: "OK"; data: SegmentView }
  | { outcome: "FORBIDDEN"; code: string; message?: string }
  | { outcome: "VALIDATION_FAILED"; code: string; message: string }
  | { outcome: "CONFLICT"; code: string; message: string };

const SEGMENT_SELECT = `SELECT rs.id, rs.code, rs.name, rs.project_id,
         p.code AS project_code, p.name AS project_name,
         rs.from_station, rs.to_station,
         rs.from_km, rs.from_m, rs.to_km, rs.to_m,
         CASE WHEN rs.from_km IS NULL THEN NULL
              ELSE (rs.to_km * 1000 + rs.to_m) - (rs.from_km * 1000 + rs.from_m)
         END AS length_m`;

const toSegment = (row: Record<string, unknown>): SegmentView => ({
  id: String(row.id),
  code: String(row.code),
  name: String(row.name),
  project_id: (row.project_id as string | null) ?? null,
  project_code: (row.project_code as string | null) ?? null,
  project_name: (row.project_name as string | null) ?? null,
  from_station: (row.from_station as string | null) ?? null,
  to_station: (row.to_station as string | null) ?? null,
  from_km: row.from_km === null || row.from_km === undefined ? null : Number(row.from_km),
  from_m: row.from_m === null || row.from_m === undefined ? null : Number(row.from_m),
  to_km: row.to_km === null || row.to_km === undefined ? null : Number(row.to_km),
  to_m: row.to_m === null || row.to_m === undefined ? null : Number(row.to_m),
  length_m: row.length_m === null || row.length_m === undefined ? null : Number(row.length_m),
  haul_count: Number(row.haul_count ?? 0),
  quantity_sum:
    row.quantity_sum === null || row.quantity_sum === undefined ? null : Number(row.quantity_sum),
  quantity_unit: (row.quantity_unit as string | null) ?? null,
});

/**
 * Zbir po dionici: broj tura i količina.
 *
 * Količine različitih jedinica (`M3` i `T`) se NE sabiraju — dvije mjerne jedinice u jednom
 * zbiru su besmislen zbir. Tada je `quantity_sum` `null`, a ekran kaže „miješane jedinice".
 */
const AGGREGATE_JOIN = `
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS haul_count,
           CASE WHEN count(DISTINCT h.quantity_unit) = 1 THEN sum(h.quantity) ELSE NULL END AS quantity_sum,
           CASE WHEN count(DISTINCT h.quantity_unit) = 1 THEN min(h.quantity_unit) ELSE NULL END AS quantity_unit
      FROM public.hauls h
     WHERE h.company_id = rs.company_id AND h.segment_id = rs.id
  ) agg ON true`;

export async function listSegments(pool: Pool, actor: SegmentActor): Promise<SegmentView[]> {
  if (!can(actor.roles, "machines.haul.view")) return [];
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const result = await client.query(
      `${SEGMENT_SELECT}, agg.haul_count, agg.quantity_sum::text, agg.quantity_unit
         FROM public.route_segments rs
         LEFT JOIN public.projects p ON p.company_id = rs.company_id AND p.id = rs.project_id
         ${AGGREGATE_JOIN}
        WHERE rs.company_id = $1
        ORDER BY rs.code`,
      [actor.companyId],
    );
    return result.rows.map(toSegment);
  });
}

/** Naziv mjesta kad ga ekran ne pošalje: „km 10+250". */
function stationLabel(km: number | null, meters: number | null): string {
  if (km === null) return "nepoznato";
  return `km ${km}+${String(meters ?? 0).padStart(3, "0")}`;
}

function validateStationing(input: SegmentInput): string | null {
  const from = input.fromKm ?? null;
  const to = input.toKm ?? null;
  const fromM = input.fromM ?? null;
  const toM = input.toM ?? null;
  const hasAny = from !== null || to !== null || fromM !== null || toM !== null;
  const hasAll = from !== null && to !== null;
  if (hasAny && !hasAll) {
    return "Stacionaža traži OBA kraja (od i do) — pola kilometraže ne ulazi ni u jedan zbir.";
  }
  if (!hasAll) return null;
  if ((fromM ?? 0) < 0 || (fromM ?? 0) > 999 || (toM ?? 0) < 0 || (toM ?? 0) > 999) {
    return "Metri moraju biti između 0 i 999.";
  }
  if (to! * 1000 + (toM ?? 0) <= from! * 1000 + (fromM ?? 0)) {
    return "Kraj dionice mora biti poslije početka — dionica ima smjer.";
  }
  return null;
}

export async function createSegment(
  pool: Pool,
  actor: SegmentActor,
  input: SegmentInput,
): Promise<SegmentOutcome> {
  if (!can(actor.roles, "machines.haul.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  const invalid = validateStationing(input);
  if (invalid) return { outcome: "VALIDATION_FAILED", code: "STATIONING", message: invalid };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (input.projectId) {
      const project = await client.query<{ id: string }>(
        "SELECT id FROM public.projects WHERE company_id = $1 AND id = $2",
        [actor.companyId, input.projectId],
      );
      if (!project.rows[0]) {
        return { outcome: "VALIDATION_FAILED", code: "PROJECT", message: "Projekat nije pronađen." };
      }
    }
    const id = `rgs_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    try {
      await client.query(
        `INSERT INTO public.route_segments
           (id, company_id, code, name, project_id, from_station, to_station,
            from_km, from_m, to_km, to_m)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id, actor.companyId, input.code.trim().toUpperCase(), input.name.trim(),
          input.projectId ?? null,
          // `from_station`/`to_station` su NOT NULL od Modula 2 (nazivi mjesta). Kad ekran pošalje
          // samo kilometražu, naziv izvodimo iz stacionaže — bolje to nego izmišljeno mjesto.
          input.fromStation ?? stationLabel(input.fromKm ?? null, input.fromM ?? null),
          input.toStation ?? stationLabel(input.toKm ?? null, input.toM ?? null),
          input.fromKm ?? null, input.fromM ?? null, input.toKm ?? null, input.toM ?? null,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return {
          outcome: "CONFLICT",
          code: "DUPLICATE",
          message: `Dionica sa oznakom ${input.code.trim().toUpperCase()} već postoji.`,
        };
      }
      throw error;
    }
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "route_segment.created",
      entityType: "route_segment",
      entityId: id,
      metadata: { code: input.code, fromKm: input.fromKm ?? null, toKm: input.toKm ?? null },
    });
    const created = await client.query(
      `${SEGMENT_SELECT}, agg.haul_count, agg.quantity_sum::text, agg.quantity_unit
         FROM public.route_segments rs
         LEFT JOIN public.projects p ON p.company_id = rs.company_id AND p.id = rs.project_id
         ${AGGREGATE_JOIN}
        WHERE rs.company_id = $1 AND rs.id = $2`,
      [actor.companyId, id],
    );
    return { outcome: "OK", data: toSegment(created.rows[0]!) };
  });
}

export async function updateSegment(
  pool: Pool,
  actor: SegmentActor,
  input: SegmentInput,
): Promise<SegmentOutcome> {
  if (!can(actor.roles, "machines.haul.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (!input.id) {
    return { outcome: "VALIDATION_FAILED", code: "ID", message: "Nedostaje id dionice." };
  }
  const invalid = validateStationing(input);
  if (invalid) return { outcome: "VALIDATION_FAILED", code: "STATIONING", message: invalid };
  const segmentId: string = input.id;
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (input.projectId) {
      const project = await client.query<{ id: string }>(
        "SELECT id FROM public.projects WHERE company_id = $1 AND id = $2",
        [actor.companyId, input.projectId],
      );
      if (!project.rows[0]) {
        return { outcome: "VALIDATION_FAILED", code: "PROJECT", message: "Projekat nije pronađen." };
      }
    }
    const updated = await client.query<{ id: string }>(
      `UPDATE public.route_segments
          SET code = $3, name = $4, project_id = $5, from_station = $6, to_station = $7,
              from_km = $8, from_m = $9, to_km = $10, to_m = $11
        WHERE company_id = $1 AND id = $2
        RETURNING id`,
      [
        actor.companyId, segmentId, input.code.trim().toUpperCase(), input.name.trim(),
        input.projectId ?? null,
        input.fromStation ?? stationLabel(input.fromKm ?? null, input.fromM ?? null),
        input.toStation ?? stationLabel(input.toKm ?? null, input.toM ?? null),
        input.fromKm ?? null, input.fromM ?? null, input.toKm ?? null, input.toM ?? null,
      ],
    );
    if (!updated.rows[0]) {
      return { outcome: "VALIDATION_FAILED", code: "NOT_FOUND", message: "Dionica nije pronađena." };
    }
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "route_segment.updated",
      entityType: "route_segment",
      entityId: segmentId,
      metadata: { code: input.code, fromKm: input.fromKm ?? null, toKm: input.toKm ?? null },
    });
    const row = await client.query(
      `${SEGMENT_SELECT}, agg.haul_count, agg.quantity_sum::text, agg.quantity_unit
         FROM public.route_segments rs
         LEFT JOIN public.projects p ON p.company_id = rs.company_id AND p.id = rs.project_id
         ${AGGREGATE_JOIN}
        WHERE rs.company_id = $1 AND rs.id = $2`,
      [actor.companyId, segmentId],
    );
    return { outcome: "OK", data: toSegment(row.rows[0]!) };
  });
}
