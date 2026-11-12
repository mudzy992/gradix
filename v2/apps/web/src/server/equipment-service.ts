/**
 * R2a servis: radnici, kategorije mašina, mašine i vozila.
 *
 * Pravila koja žive OVDJE, a ne u rutama ili UI-u:
 *  - kategorija mora biti iz iste firme (kompozitni FK to i na nivou baze odbija),
 *  - brojilo je jednosmjerno osim izričite ispravke (greška u kucanju bi inače trajno pokvarila
 *    brojilo, a R2 nema historiju očitanja iz koje bi se vidjelo šta se dogodilo),
 *  - promjena vrste brojila je dozvoljena samo dok brojilo nema vrijednost,
 *  - veza radnik↔nalog je opciona, jedan na jedan, i NE daje nikakve dozvole.
 *
 * Svaka izmjena ide u istoj transakciji sa auditom (`withCompany` + `writeAudit`).
 */
import type { Pool, PoolClient } from "pg";
import { withCompany, type CompanyId } from "@gradix/db";
import { writeAudit } from "./audit";
import type { Actor } from "./rbac-service";

export type ServiceError =
  | { code: "FORBIDDEN"; message: string }
  | { code: "NOT_FOUND"; message: string }
  | { code: "VALIDATION_FAILED"; message: string }
  | { code: "CONFLICT"; message: string };

/**
 * Tip greške se prepoznaje po `message`, ne po `code`: `MachineRow` i `CategoryRow` imaju svoje
 * polje `code` (inventarska oznaka), pa bi `"code" in result` tiho propustilo grešku dalje.
 */
export function isServiceError(value: unknown): value is ServiceError {
  return typeof value === "object" && value !== null && "code" in value && "message" in value;
}

export const ENGAGEMENTS = ["PERMANENT", "FIXED_TERM", "SEASONAL", "CONTRACT"] as const;
export type Engagement = (typeof ENGAGEMENTS)[number];

export const METERS = ["HOURS", "KM"] as const;
export type Meter = (typeof METERS)[number];

export const OWNERSHIPS = ["OWN", "RENT"] as const;
export type Ownership = (typeof OWNERSHIPS)[number];

export function isEngagement(value: unknown): value is Engagement {
  return typeof value === "string" && (ENGAGEMENTS as readonly string[]).includes(value);
}
export function isMeter(value: unknown): value is Meter {
  return typeof value === "string" && (METERS as readonly string[]).includes(value);
}
export function isOwnership(value: unknown): value is Ownership {
  return typeof value === "string" && (OWNERSHIPS as readonly string[]).includes(value);
}

/* ================================================================== radnici */

export type WorkerRow = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  jobTitle: string | null;
  engagement: string;
  hiredAt: string;
  endedAt: string | null;
  team: string | null;
  supervisorId: string | null;
  supervisorName: string | null;
  userId: string | null;
  /** Email naloga kad je veza postavljena — UI prikazuje „Nalog: …“, ne goli id. */
  userEmail: string | null;
  isActive: boolean;
};

export type WorkerInput = {
  firstName: string;
  lastName: string;
  phone?: string | null;
  email?: string | null;
  jobTitle?: string | null;
  engagement?: string;
  hiredAt: string;
  endedAt?: string | null;
  team?: string | null;
  supervisorId?: string | null;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Poslovni datum (`DATE`), ne trenutak. Vrijeme se odbija namjerno: „početak rada“ je dan u
 * zoni firme, a ne UTC ponoć koja u Sarajevu pokazuje jučerašnji datum.
 */
function normaliseDate(value: string, field: string): string | ServiceError {
  if (!DATE_ONLY.test(value)) return { code: "VALIDATION_FAILED", message: `${field} mora biti datum (gggg-mm-dd).` };
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return { code: "VALIDATION_FAILED", message: `${field} nije ispravan datum.` };
  }
  return value;
}

export function validateWorkerInput(input: WorkerInput): WorkerInput | ServiceError {
  const firstName = input.firstName?.trim() ?? "";
  const lastName = input.lastName?.trim() ?? "";
  if (firstName.length < 1 || firstName.length > 100) {
    return { code: "VALIDATION_FAILED", message: "Ime je obavezno (do 100 znakova)." };
  }
  if (lastName.length < 1 || lastName.length > 100) {
    return { code: "VALIDATION_FAILED", message: "Prezime je obavezno (do 100 znakova)." };
  }
  if (input.engagement !== undefined && !isEngagement(input.engagement)) {
    return { code: "VALIDATION_FAILED", message: "Vrsta angažmana nije ispravna." };
  }

  const hiredAt = normaliseDate(input.hiredAt, "Datum početka");
  if (typeof hiredAt !== "string") return hiredAt;

  let endedAt: string | null = null;
  if (input.endedAt) {
    const checked = normaliseDate(input.endedAt, "Datum prestanka");
    if (typeof checked !== "string") return checked;
    if (checked < hiredAt) {
      return { code: "VALIDATION_FAILED", message: "Datum prestanka ne može biti prije početka rada." };
    }
    endedAt = checked;
  }

  const email = input.email?.trim() || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { code: "VALIDATION_FAILED", message: "Email radnika nije ispravan." };
  }

  return {
    firstName,
    lastName,
    phone: input.phone?.trim() || null,
    email,
    jobTitle: input.jobTitle?.trim() || null,
    engagement: input.engagement ?? "PERMANENT",
    hiredAt,
    endedAt,
    team: input.team?.trim() || null,
    supervisorId: input.supervisorId || null,
  };
}

const WORKER_SELECT = `
  SELECT w.id, w.first_name, w.last_name, w.phone, w.email, w.job_title, w.engagement,
         to_char(w.hired_at, 'YYYY-MM-DD') AS hired_at,
         to_char(w.ended_at, 'YYYY-MM-DD') AS ended_at,
         w.team, w.supervisor_id, s.first_name || ' ' || s.last_name AS supervisor_name,
         w.user_id, u.email AS user_email, w.is_active
    FROM workers w
    LEFT JOIN workers s ON s.company_id = w.company_id AND s.id = w.supervisor_id
    LEFT JOIN users u ON u.id = w.user_id
`;

const toWorker = (row: Record<string, unknown>): WorkerRow => ({
  id: String(row.id),
  firstName: String(row.first_name),
  lastName: String(row.last_name),
  phone: (row.phone as string | null) ?? null,
  email: (row.email as string | null) ?? null,
  jobTitle: (row.job_title as string | null) ?? null,
  engagement: String(row.engagement),
  hiredAt: String(row.hired_at),
  endedAt: (row.ended_at as string | null) ?? null,
  team: (row.team as string | null) ?? null,
  supervisorId: (row.supervisor_id as string | null) ?? null,
  supervisorName: (row.supervisor_name as string | null) ?? null,
  userId: (row.user_id as string | null) ?? null,
  userEmail: (row.user_email as string | null) ?? null,
  isActive: Boolean(row.is_active),
});

export async function listWorkers(pool: Pool, companyId: CompanyId): Promise<WorkerRow[]> {
  return withCompany(pool, companyId, async (client) => {
    const result = await client.query(`${WORKER_SELECT} ORDER BY w.is_active DESC, w.last_name, w.first_name`);
    return result.rows.map(toWorker);
  });
}

export async function createWorker(
  pool: Pool,
  companyId: CompanyId,
  actor: Actor,
  input: WorkerInput,
): Promise<WorkerRow | ServiceError> {
  const valid = validateWorkerInput(input);
  if ("code" in valid) return valid;

  return withCompany(pool, companyId, async (client) => {
    if (valid.supervisorId) {
      const supervisor = await client.query("SELECT 1 FROM workers WHERE id = $1 AND company_id = $2", [valid.supervisorId, companyId]);
      if (supervisor.rowCount === 0) {
        return { code: "NOT_FOUND", message: "Nadređeni nije pronađen u ovoj firmi." } as ServiceError;
      }
    }

    const id = `wrk_${crypto.randomUUID()}`;
    await client.query(
      `INSERT INTO workers (id, company_id, first_name, last_name, phone, email, job_title,
                            engagement, hired_at, ended_at, team, supervisor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        companyId,
        valid.firstName,
        valid.lastName,
        valid.phone,
        valid.email,
        valid.jobTitle,
        valid.engagement,
        valid.hiredAt,
        valid.endedAt,
        valid.team,
        valid.supervisorId,
      ],
    );

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "worker.created",
      entityType: "worker",
      entityId: id,
      // Bez imena i kontakta u tragu: audit je za radnju, ne za kopiju ličnih podataka.
      metadata: { engagement: valid.engagement },
    });

    const created = await client.query(`SELECT * FROM (${WORKER_SELECT}) w WHERE w.id = $1`, [id]);
    return toWorker(created.rows[0]!);
  });
}

export async function updateWorker(
  pool: Pool,
  companyId: CompanyId,
  actor: Actor,
  workerId: string,
  input: WorkerInput,
): Promise<WorkerRow | ServiceError> {
  const valid = validateWorkerInput(input);
  if ("code" in valid) return valid;

  return withCompany(pool, companyId, async (client) => {
    const existing = await client.query("SELECT id, engagement FROM workers WHERE id = $1 AND company_id = $2", [workerId, companyId]);
    if (existing.rowCount === 0) return { code: "NOT_FOUND", message: "Radnik nije pronađen." } as ServiceError;

    if (valid.supervisorId) {
      if (valid.supervisorId === workerId) {
        return { code: "VALIDATION_FAILED", message: "Radnik ne može biti sam sebi nadređen." } as ServiceError;
      }
      const supervisor = await client.query("SELECT 1 FROM workers WHERE id = $1 AND company_id = $2", [valid.supervisorId, companyId]);
      if (supervisor.rowCount === 0) {
        return { code: "NOT_FOUND", message: "Nadređeni nije pronađen u ovoj firmi." } as ServiceError;
      }
    }

    await client.query(
      `UPDATE workers
          SET first_name = $2, last_name = $3, phone = $4, email = $5, job_title = $6,
              engagement = $7, hired_at = $8, ended_at = $9, team = $10, supervisor_id = $11,
              updated_at = now()
        WHERE id = $1 AND company_id = $12`,
      [
        workerId,
        valid.firstName,
        valid.lastName,
        valid.phone,
        valid.email,
        valid.jobTitle,
        valid.engagement,
        valid.hiredAt,
        valid.endedAt,
        valid.team,
        valid.supervisorId,
      ],
    );

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "worker.updated",
      entityType: "worker",
      entityId: workerId,
      metadata: { engagement: valid.engagement },
    });

    const updated = await client.query(`SELECT * FROM (${WORKER_SELECT}) w WHERE w.id = $1`, [workerId]);
    return toWorker(updated.rows[0]!);
  });
}

export async function setWorkerActive(
  pool: Pool,
  companyId: CompanyId,
  actor: Actor,
  workerId: string,
  active: boolean,
): Promise<WorkerRow | ServiceError> {
  return withCompany(pool, companyId, async (client) => {
    const result = await client.query(
      "UPDATE workers SET is_active = $3, updated_at = now() WHERE id = $1 AND company_id = $2 RETURNING id",
      [workerId, companyId, active],
    );
    if (result.rowCount === 0) return { code: "NOT_FOUND", message: "Radnik nije pronađen." } as ServiceError;

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: active ? "worker.activated" : "worker.deactivated",
      entityType: "worker",
      entityId: workerId,
    });

    const updated = await client.query(`SELECT * FROM (${WORKER_SELECT}) w WHERE w.id = $1`, [workerId]);
    return toWorker(updated.rows[0]!);
  });
}

/**
 * Veza radnik ↔ nalog. Radi je **administrator** (`users.manage`), i ona ne daje dozvole:
 * role i opseg ostaju ono što su bili. Nalog može imati najviše jednog radnika (`UNIQUE`).
 */
export async function linkWorkerUser(
  pool: Pool,
  companyId: CompanyId,
  actor: Actor,
  workerId: string,
  userId: string | null,
): Promise<WorkerRow | ServiceError> {
  return withCompany(pool, companyId, async (client) => {
    const worker = await client.query("SELECT user_id FROM workers WHERE id = $1 AND company_id = $2", [workerId, companyId]);
    if (worker.rowCount === 0) return { code: "NOT_FOUND", message: "Radnik nije pronađen." } as ServiceError;

    if (userId) {
      // Nalog mora biti član OVE firme — inače bi veza spajala dvije firme.
      const member = await client.query(
        "SELECT 1 FROM memberships WHERE user_id = $1 AND company_id = $2",
        [userId, companyId],
      );
      if (member.rowCount === 0) {
        return { code: "NOT_FOUND", message: "Osoba nije član ove firme." } as ServiceError;
      }

      const taken = await client.query("SELECT id FROM workers WHERE user_id = $1 AND id <> $2", [userId, workerId]);
      if ((taken.rowCount ?? 0) > 0) {
        return {
          code: "CONFLICT",
          message: "Taj nalog je već povezan sa drugim radnikom. Odvežite ga pa pokušajte ponovo.",
        } as ServiceError;
      }
    }

    await client.query("UPDATE workers SET user_id = $3, updated_at = now() WHERE id = $1 AND company_id = $2", [workerId, companyId, userId]);

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: userId ? "worker.user_linked" : "worker.user_unlinked",
      entityType: "worker",
      entityId: workerId,
      metadata: userId ? { userId } : {},
    });

    const updated = await client.query(`SELECT * FROM (${WORKER_SELECT}) w WHERE w.id = $1`, [workerId]);
    return toWorker(updated.rows[0]!);
  });
}

/* ================================================================== kategorije */

export type CategoryRow = {
  id: string;
  code: string;
  name: string;
  meter: string;
  isActive: boolean;
  sortOrder: number;
  machineCount: number;
};

export async function listCategories(pool: Pool, companyId: CompanyId): Promise<CategoryRow[]> {
  return withCompany(pool, companyId, async (client) => {
    const result = await client.query(
      `SELECT c.id, c.code, c.name, c.meter, c.is_active, c.sort_order,
              (SELECT count(*)::int FROM machines m WHERE m.category_id = c.id) AS machine_count
         FROM equipment_categories c
        ORDER BY c.sort_order, c.name`,
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      code: String(row.code),
      name: String(row.name),
      meter: String(row.meter),
      isActive: Boolean(row.is_active),
      sortOrder: Number(row.sort_order),
      machineCount: Number(row.machine_count),
    }));
  });
}

export type CategoryInput = { code: string; name: string; meter: string; sortOrder?: number };

export async function createCategory(
  pool: Pool,
  companyId: CompanyId,
  actor: Actor,
  input: CategoryInput,
): Promise<CategoryRow | ServiceError> {
  const code = input.code?.trim().toUpperCase() ?? "";
  const name = input.name?.trim() ?? "";
  if (!/^[A-Z0-9_]{2,40}$/.test(code)) {
    return { code: "VALIDATION_FAILED", message: "Oznaka kategorije: 2–40 znakova, velika slova, brojevi i _." };
  }
  if (name.length < 1 || name.length > 80) {
    return { code: "VALIDATION_FAILED", message: "Naziv kategorije je obavezan (do 80 znakova)." };
  }
  if (!isMeter(input.meter)) {
    return { code: "VALIDATION_FAILED", message: "Vrsta brojila je HOURS ili KM." };
  }

  return withCompany(pool, companyId, async (client) => {
    const exists = await client.query("SELECT 1 FROM equipment_categories WHERE code = $1", [code]);
    if ((exists.rowCount ?? 0) > 0) {
      return { code: "CONFLICT", message: `Kategorija sa oznakom ${code} već postoji.` } as ServiceError;
    }

    const id = `cat_${crypto.randomUUID()}`;
    await client.query(
      `INSERT INTO equipment_categories (id, company_id, code, name, meter, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, companyId, code, name, input.meter, input.sortOrder ?? 500],
    );

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "equipment.category_created",
      entityType: "equipment_category",
      entityId: id,
      metadata: { code },
    });

    return {
      id,
      code,
      name,
      meter: input.meter,
      isActive: true,
      sortOrder: input.sortOrder ?? 500,
      machineCount: 0,
    };
  });
}

/* ================================================================== mašine */

export type MachineRow = {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  categoryName: string;
  categoryCode: string;
  make: string | null;
  model: string | null;
  serialNo: string | null;
  plate: string | null;
  year: number | null;
  ownership: string;
  meter: string;
  meterValue: number | null;
  meterUpdatedAt: string | null;
  isActive: boolean;
};

export type MachineInput = {
  code: string;
  name: string;
  categoryId: string;
  make?: string | null;
  model?: string | null;
  serialNo?: string | null;
  plate?: string | null;
  year?: number | null;
  ownership?: string;
  meter?: string;
  meterValue?: number | null;
  /** Deaktivacija umjesto brisanja: mašina ostaje u istoriji. */
  isActive?: boolean;
};

const MACHINE_SELECT = `
  SELECT m.id, m.code, m.name, m.category_id, c.name AS category_name, c.code AS category_code,
         m.make, m.model, m.serial_no, m.plate, m.year, m.ownership, m.meter, m.meter_value,
         m.meter_updated_at, m.is_active
    FROM machines m
    JOIN equipment_categories c ON c.company_id = m.company_id AND c.id = m.category_id
`;

const toMachine = (row: Record<string, unknown>): MachineRow => ({
  id: String(row.id),
  code: String(row.code),
  name: String(row.name),
  categoryId: String(row.category_id),
  categoryName: String(row.category_name),
  categoryCode: String(row.category_code),
  make: (row.make as string | null) ?? null,
  model: (row.model as string | null) ?? null,
  serialNo: (row.serial_no as string | null) ?? null,
  plate: (row.plate as string | null) ?? null,
  year: row.year === null || row.year === undefined ? null : Number(row.year),
  ownership: String(row.ownership),
  meter: String(row.meter),
  meterValue: row.meter_value === null || row.meter_value === undefined ? null : Number(row.meter_value),
  meterUpdatedAt: row.meter_updated_at ? (row.meter_updated_at as Date).toISOString() : null,
  isActive: Boolean(row.is_active),
});

export async function listMachines(pool: Pool, companyId: CompanyId): Promise<MachineRow[]> {
  return withCompany(pool, companyId, async (client) => {
    const result = await client.query(`${MACHINE_SELECT} ORDER BY m.is_active DESC, m.code`);
    return result.rows.map(toMachine);
  });
}

export async function createMachine(
  pool: Pool,
  companyId: CompanyId,
  actor: Actor,
  input: MachineInput,
): Promise<MachineRow | ServiceError> {
  const code = input.code?.trim().toUpperCase() ?? "";
  const name = input.name?.trim() ?? "";
  if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(code)) {
    return { code: "VALIDATION_FAILED", message: "Inventarska oznaka: 2–20 znakova, velika slova, brojevi i crtica." };
  }
  if (name.length < 1 || name.length > 120) {
    return { code: "VALIDATION_FAILED", message: "Naziv mašine je obavezan (do 120 znakova)." };
  }
  if (input.ownership !== undefined && !isOwnership(input.ownership)) {
    return { code: "VALIDATION_FAILED", message: "Vlasništvo je OWN ili RENT." };
  }
  if (input.meter !== undefined && !isMeter(input.meter)) {
    return { code: "VALIDATION_FAILED", message: "Brojilo je HOURS ili KM." };
  }
  if (input.meterValue !== undefined && input.meterValue !== null) {
    if (!Number.isFinite(input.meterValue) || input.meterValue < 0) {
      return { code: "VALIDATION_FAILED", message: "Vrijednost brojila ne može biti negativna." };
    }
  }

  return withCompany(pool, companyId, async (client) => {
    const category = await client.query<{ meter: string }>(
      "SELECT meter FROM equipment_categories WHERE id = $1 AND company_id = $2",
      [input.categoryId, companyId],
    );
    if (category.rowCount === 0) {
      return { code: "NOT_FOUND", message: "Kategorija nije pronađena u ovoj firmi." } as ServiceError;
    }

    const duplicate = await client.query("SELECT 1 FROM machines WHERE code = $1", [code]);
    if ((duplicate.rowCount ?? 0) > 0) {
      return { code: "CONFLICT", message: `Mašina sa oznakom ${code} već postoji.` } as ServiceError;
    }

    const meter = input.meter ?? category.rows[0]!.meter;
    const meterValue = input.meterValue ?? null;
    const id = `mch_${crypto.randomUUID()}`;

    await client.query(
      `INSERT INTO machines (id, company_id, code, name, category_id, make, model, serial_no, plate,
                             year, ownership, meter, meter_value, meter_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        id,
        companyId,
        code,
        name,
        input.categoryId,
        input.make?.trim() || null,
        input.model?.trim() || null,
        input.serialNo?.trim() || null,
        input.plate?.trim() || null,
        input.year ?? null,
        input.ownership ?? "OWN",
        meter,
        meterValue,
        meterValue === null ? null : new Date(),
      ],
    );

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "equipment.created",
      entityType: "equipment",
      entityId: id,
      metadata: { code, categoryId: input.categoryId, meter },
    });

    const created = await client.query(`SELECT * FROM (${MACHINE_SELECT}) m WHERE m.id = $1`, [id]);
    return toMachine(created.rows[0]!);
  });
}

export async function updateMachine(
  pool: Pool,
  companyId: CompanyId,
  actor: Actor,
  machineId: string,
  input: MachineInput,
): Promise<MachineRow | ServiceError> {
  const name = input.name?.trim() ?? "";
  if (name.length < 1 || name.length > 120) {
    return { code: "VALIDATION_FAILED", message: "Naziv mašine je obavezan (do 120 znakova)." };
  }
  if (input.ownership !== undefined && !isOwnership(input.ownership)) {
    return { code: "VALIDATION_FAILED", message: "Vlasništvo je OWN ili RENT." };
  }
  if (input.meter !== undefined && !isMeter(input.meter)) {
    return { code: "VALIDATION_FAILED", message: "Brojilo je HOURS ili KM." };
  }

  return withCompany(pool, companyId, async (client) => {
    const existing = await client.query<{ meter: string; meter_value: string | null }>(
      "SELECT meter, meter_value FROM machines WHERE id = $1 AND company_id = $2",
      [machineId, companyId],
    );
    if (existing.rowCount === 0) return { code: "NOT_FOUND", message: "Mašina nije pronađena." } as ServiceError;

    const current = existing.rows[0]!;
    const nextMeter = input.meter ?? current.meter;
    // Miješanje sati i kilometara u istoj koloni nema smisla: vrsta se mijenja samo dok brojilo
    // nema vrijednost. Poslije toga je potrebna ispravka kroz zasebnu radnju (R5, historija).
    if (nextMeter !== current.meter && current.meter_value !== null) {
      return {
        code: "CONFLICT",
        message: "Vrsta brojila se ne može promijeniti kad brojilo već ima vrijednost.",
      } as ServiceError;
    }

    if (input.categoryId) {
      const category = await client.query("SELECT 1 FROM equipment_categories WHERE id = $1 AND company_id = $2", [input.categoryId, companyId]);
      if (category.rowCount === 0) {
        return { code: "NOT_FOUND", message: "Kategorija nije pronađena u ovoj firmi." } as ServiceError;
      }
    }

    await client.query(
      `UPDATE machines
          SET name = $2,
              category_id = COALESCE($3, category_id),
              make = $4, model = $5, serial_no = $6, plate = $7, year = $8,
              ownership = COALESCE($9, ownership), meter = $10,
              is_active = COALESCE($11, is_active), updated_at = now()
        WHERE id = $1 AND company_id = $12`,
      [
        machineId,
        name,
        input.categoryId ?? null,
        input.make?.trim() || null,
        input.model?.trim() || null,
        input.serialNo?.trim() || null,
        input.plate?.trim() || null,
        input.year ?? null,
        input.ownership ?? null,
        nextMeter,
        input.isActive ?? null,
        companyId,
      ],
    );

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "equipment.updated",
      entityType: "equipment",
      entityId: machineId,
      metadata:
        input.isActive === undefined ? {} : { isActive: input.isActive, code: input.code?.trim().toUpperCase() ?? null },
    });

    const updated = await client.query(`SELECT * FROM (${MACHINE_SELECT}) m WHERE m.id = $1`, [machineId]);
    return toMachine(updated.rows[0]!);
  });
}

/**
 * Brojilo: samo TRENUTNA vrijednost (historija je R5).
 *
 * Unos je jednosmjeran — nova vrijednost mora biti ≥ postojeće. Manja vrijednost je dozvoljena
 * samo kao izričita **ispravka** (`correct: true`, dozvola `equipment.manage`) i bilježi se u
 * audit sa starom i novom vrijednošću. Bez toga bi jedna pogrešna cifra trajno pokvarila brojilo.
 */
export async function setMeterValue(
  pool: Pool,
  companyId: CompanyId,
  actor: Actor,
  machineId: string,
  value: number,
  options: { correct?: boolean } = {},
): Promise<MachineRow | ServiceError> {
  if (!Number.isFinite(value) || value < 0) {
    return { code: "VALIDATION_FAILED", message: "Vrijednost brojila ne može biti negativna." };
  }

  return withCompany(pool, companyId, async (client) => {
    const existing = await client.query<{ meter_value: string | null }>(
      "SELECT meter_value FROM machines WHERE id = $1 AND company_id = $2 FOR UPDATE",
      [machineId, companyId],
    );
    if (existing.rowCount === 0) return { code: "NOT_FOUND", message: "Mašina nije pronađena." } as ServiceError;

    const previous = existing.rows[0]!.meter_value === null ? null : Number(existing.rows[0]!.meter_value);
    if (previous !== null && value < previous && !options.correct) {
      return {
        code: "CONFLICT",
        message: `Nova vrijednost (${value}) je manja od upisane (${previous}). Ako je upisana pogrešna, potvrdite ispravku.`,
      } as ServiceError;
    }

    await client.query(
      "UPDATE machines SET meter_value = $3, meter_updated_at = now(), updated_at = now() WHERE id = $1 AND company_id = $2",
      [machineId, companyId, value],
    );

    const corrected = previous !== null && value < previous;
    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: corrected ? "equipment.meter_corrected" : "equipment.meter_updated",
      entityType: "equipment",
      entityId: machineId,
      metadata: { from: previous, to: value },
    });

    const updated = await client.query(`SELECT * FROM (${MACHINE_SELECT}) m WHERE m.id = $1`, [machineId]);
    return toMachine(updated.rows[0]!);
  });
}

/** Za uvoz: postojeće oznake mašina u firmi (da se red preskoči, ne duplira). */
export async function existingMachineCodes(client: PoolClient): Promise<Set<string>> {
  const result = await client.query<{ code: string }>("SELECT code FROM machines");
  return new Set(result.rows.map((row) => row.code));
}
