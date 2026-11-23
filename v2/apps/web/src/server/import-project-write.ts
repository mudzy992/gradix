/** Upis projekata pri potvrdi uvoza (2c). */
import type { PoolClient } from "pg";
import type { CompanyId } from "@gradix/db";
import type { ProjectPreviewRow } from "./import-project-fields";

export async function insertProjectRow(
  client: PoolClient,
  companyId: CompanyId,
  actorUserId: string,
  row: ProjectPreviewRow,
): Promise<void> {
  const values = row.values as Record<string, string | number | null>;
  await client.query(
    `INSERT INTO projects (id, company_id, code, name, status, site_address, site_place,
                           starts_on, ends_on, manager_worker_id, note, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, $12)`,
    [
      `prj_${crypto.randomUUID()}`,
      companyId,
      values.code,
      values.name,
      values.status ?? "ACTIVE",
      values.siteAddress,
      values.sitePlace,
      values.startsOn,
      values.endsOn,
      values.managerWorkerId,
      values.note,
      actorUserId,
    ],
  );
}

export async function updateProjectRow(
  client: PoolClient,
  companyId: CompanyId,
  row: ProjectPreviewRow,
): Promise<void> {
  const values = row.values as Record<string, string | number | null>;
  await client.query(
    `UPDATE projects
        SET name = $3, status = $4, site_address = $5, site_place = $6,
            starts_on = $7, ends_on = $8, manager_worker_id = $9, note = $10, updated_at = now()
      WHERE company_id = $1 AND code = $2`,
    [
      companyId,
      values.code,
      values.name,
      values.status ?? "ACTIVE",
      values.siteAddress,
      values.sitePlace,
      values.startsOn,
      values.endsOn,
      values.managerWorkerId,
      values.note,
    ],
  );
}
