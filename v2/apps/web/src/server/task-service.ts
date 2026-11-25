/**
 * F5 (Modul 6 §1.6): zadaci i komentari.
 *
 *  - **Jedan izvršilac.** Radnik (`assignee_worker_id`) ILI nalog (`assignee_user_id`), nikad
 *    oboje — model timova nije u opsegu, a dva izvršioca znače da niko nije odgovoran.
 *  - **`DONE` nosi `completed_at`.** Baza to veže CHECK-om; servis ga popunjava u istoj
 *    transakciji da klijent ne mora pamtiti pravilo.
 *  - **`overdue` računa server.** „Kasni“ zavisi od poslovnog datuma firme, ne od sata telefona;
 *    inače bi dva telefona u istoj firmi pokazivala različito.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { can } from "./permissions";
import { writeAudit } from "./audit";
import { companyToday } from "./project-service";
import type { Scope } from "@gradix/domain";
import { visibleProjectIds } from "@gradix/domain";
import type {
  TaskCommentRow,
  TaskInput,
  TaskListResult,
  TaskQuery,
  TaskRow,
  TaskServiceError,
} from "./task-types";

function toTask(row: Record<string, unknown>, today: string): TaskRow {
  const status = String(row.status) as TaskRow["status"];
  const dueOn = row.due_on ? String(row.due_on) : null;
  return {
    id: String(row.id),
    project_id: row.project_id ? String(row.project_id) : null,
    project_code: row.project_code ? String(row.project_code) : null,
    project_name: row.project_name ? String(row.project_name) : null,
    phase_id: row.phase_id ? String(row.phase_id) : null,
    phase_name: row.phase_name ? String(row.phase_name) : null,
    title: String(row.title),
    description: row.description ? String(row.description) : null,
    assignee_worker_id: row.assignee_worker_id ? String(row.assignee_worker_id) : null,
    assignee_worker_name: row.assignee_worker_name ? String(row.assignee_worker_name) : null,
    assignee_user_id: row.assignee_user_id ? String(row.assignee_user_id) : null,
    assignee_user_name: row.assignee_user_name ? String(row.assignee_user_name) : null,
    due_on: dueOn,
    priority: String(row.priority) as TaskRow["priority"],
    status,
    completed_at: row.completed_at ? new Date(String(row.completed_at)).toISOString() : null,
    overdue: status !== "DONE" && status !== "CANCELLED" && dueOn !== null && dueOn < today,
    comment_count: Number(row.comment_count ?? 0),
  };
}

const TASK_SELECT = `
  SELECT t.id, t.project_id, p.code AS project_code, p.name AS project_name,
         t.phase_id, ph.name AS phase_name, t.title, t.description,
         t.assignee_worker_id,
         COALESCE(w.first_name || ' ' || w.last_name, NULL) AS assignee_worker_name,
         t.assignee_user_id,
         COALESCE(u.first_name || ' ' || u.last_name, u.email) AS assignee_user_name,
         t.due_on::text, t.priority, t.status, t.completed_at::text,
         (SELECT count(*)::int FROM public.task_comments c
           WHERE c.company_id = t.company_id AND c.task_id = t.id) AS comment_count
    FROM public.project_tasks t
    LEFT JOIN public.projects p ON p.company_id = t.company_id AND p.id = t.project_id
    LEFT JOIN public.project_phases ph ON ph.company_id = t.company_id AND ph.id = t.phase_id
    LEFT JOIN public.workers w ON w.company_id = t.company_id AND w.id = t.assignee_worker_id
    LEFT JOIN public.users u ON u.id = t.assignee_user_id
`;

export async function listTasks(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: Parameters<typeof can>[0] },
  query: TaskQuery,
): Promise<TaskListResult | TaskServiceError> {
  if (!can(actor.roles, "projects.view")) {
    return { code: "FORBIDDEN", message: "Nemate pravo pregleda zadataka." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const today = await companyToday(client, toCompanyId(actor.companyId));
    const conditions = ["t.company_id = $1"];
    /*
     * `$2` se dodaje SAMO kad ga filter koristi: Postgres odbija višak parametara
     * („bind message supplies 2 parameters, but prepared statement requires 1“), pa bi lista
     * bez `due` filtera — najčešći poziv — vraćala 500.
     */
    const params: unknown[] = [actor.companyId];
    const todayIndex = () => {
      const index = params.indexOf(today);
      if (index >= 0) return index + 1;
      params.push(today);
      return params.length;
    };
    if (query.projectId) {
      params.push(query.projectId);
      conditions.push(`t.project_id = $${params.length}`);
    }
    if (query.status) {
      params.push(query.status);
      conditions.push(`t.status = $${params.length}`);
    }
    if (query.due === "OVERDUE") {
      conditions.push(`t.status NOT IN ('DONE', 'CANCELLED') AND t.due_on < $${todayIndex()}::date`);
    }
    if (query.due === "TODAY") {
      conditions.push(`t.status NOT IN ('DONE', 'CANCELLED') AND t.due_on = $${todayIndex()}::date`);
    }
    if (query.assignee === "ME") {
      /*
       * „Moji zadaci“ pokriva DVA puta do iste osobe: kao korisnik naloga i kao radnik povezan
       * s nalogom. Bez drugog puta bi šef na terenu vidio praznu listu iako su mu zadaci
       * dodijeljeni po radniku — a to je najčešći način dodjele u gradnji.
       */
      params.push(actor.userId);
      const userIdx = params.length;
      conditions.push(
        `(t.assignee_user_id = $${userIdx}
          OR t.assignee_worker_id IN (SELECT id FROM public.workers
                                       WHERE company_id = $1 AND user_id = $${userIdx}))`,
      );
    }
    const result = await client.query(
      `${TASK_SELECT} WHERE ${conditions.join(" AND ")}
        ORDER BY (t.status IN ('DONE', 'CANCELLED')) ASC,
                 t.due_on ASC NULLS LAST, t.priority DESC, t.created_at DESC
        LIMIT 500`,
      params,
    );
    const counts = await client.query<{ mine_today: string; overdue: string; open: string }>(
      `SELECT
         count(*) FILTER (WHERE t.status NOT IN ('DONE','CANCELLED') AND t.due_on = $2::date
                            AND (t.assignee_user_id = $3
                                 OR t.assignee_worker_id IN (SELECT id FROM public.workers
                                                              WHERE company_id = $1 AND user_id = $3)))::text AS mine_today,
         count(*) FILTER (WHERE t.status NOT IN ('DONE','CANCELLED') AND t.due_on < $2::date)::text AS overdue,
         count(*) FILTER (WHERE t.status NOT IN ('DONE','CANCELLED'))::text AS open
       FROM public.project_tasks t WHERE t.company_id = $1`,
      [actor.companyId, today, actor.userId],
    );
    return {
      tasks: result.rows.map((row) => toTask(row, today)),
      counts: {
        mine_today: Number(counts.rows[0]?.mine_today ?? "0"),
        overdue: Number(counts.rows[0]?.overdue ?? "0"),
        open: Number(counts.rows[0]?.open ?? "0"),
      },
    };
  });
}

/**
 * Akter zadatka. `scope`/`projectIds` su OPCIONI: servis ih koristi da šefu gradilišta ograniči
 * radnju na projekte na koje je raspoređen. Bez njih se ponaša kao `COMPANY` — to je slučaj za
 * postojeće pozivaoce (worker poslovi, testovi) i za role koje ionako imaju `projects.manage`.
 */
export type TaskActor = {
  userId: string;
  companyId: string;
  roles: Parameters<typeof can>[0];
  scope?: Scope;
  projectIds?: string[] | null;
};

/**
 * Djelimična izmjena: `statusOnly` je jedina stvar koju smije šef gradilišta.
 *
 * `SITE_SUPERVISOR` ima `tasks.update_status`, ali NE `projects.manage` — pa servis mora sam
 * odlučiti koja polja smije mijenjati. Provjera ide PRIJE upisa, jer bi inače šef mogao
 * preusmjeriti tuđi zadatak na drugoga i time ga tiho izgubiti iz svog spiska.
 */
const STATUS_ONLY_FIELDS = ["status", "id"] as const;

export async function saveTask(
  pool: Pool,
  actor: TaskActor,
  input: TaskInput,
  isUpdate: boolean,
): Promise<TaskRow | TaskServiceError> {
  const full = can(actor.roles, "projects.manage");
  const statusOnly = !full && can(actor.roles, "tasks.update_status");
  if (!full && !statusOnly) {
    return { code: "FORBIDDEN", message: "Nemate pravo upravljanja zadacima." };
  }
  if (statusOnly) {
    if (!isUpdate) {
      return { code: "FORBIDDEN", message: "Novi zadatak upisuje ured ili rukovodilac projekta." };
    }
    const allowed = new Set<string>([...STATUS_ONLY_FIELDS]);
    const changed = Object.entries(input).filter(
      ([key, value]) => value !== undefined && !allowed.has(key),
    );
    if (changed.length > 0) {
      return {
        code: "FORBIDDEN",
        message: "Šef gradilišta mijenja samo status zadatka; ostala polja mijenja ured.",
      };
    }
  }
  if (input.assigneeWorkerId && input.assigneeUserId) {
    return { code: "VALIDATION_FAILED", message: "Zadatak ima jednog izvršioca — radnika ili nalog." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const today = await companyToday(client, toCompanyId(actor.companyId));
    if (isUpdate) {
      if (!input.id) return { code: "VALIDATION_FAILED", message: "Nedostaje id zadatka." };
      const existing = await client.query<{ status: string; project_id: string | null }>(
        "SELECT status, project_id FROM public.project_tasks WHERE company_id = $1 AND id = $2 FOR UPDATE",
        [actor.companyId, input.id],
      );
      if (!existing.rows[0]) return { code: "NOT_FOUND", message: "Zadatak nije pronađen." };
      /*
       * Opseg `PROJECTS`: šef mijenja status samo na projektima na koje je raspoređen. Zadatak bez
       * projekta (opći zadatak firme) ostaje u redu ureda — nije „svačiji“.
       */
      if (!full) {
        const visible = visibleProjectIds({
          userId: actor.userId,
          scope: actor.scope ?? "COMPANY",
          projectIds: actor.projectIds ?? [],
        });
        const projectId = existing.rows[0].project_id;
        if (visible !== null && (projectId === null || !visible.includes(projectId))) {
          return {
            code: "FORBIDDEN",
            message: "Status mijenjate samo na projektima na koje ste raspoređeni.",
          };
        }
      }
      const status = input.status ?? existing.rows[0].status;
      /*
       * `completed_at` slijedi status, u OBA smjera: vraćanje iz `DONE` mora ga očistiti, inače
       * bi CHECK pao ili bi zadatak ostao „završen“ sa datumom iako je ponovno otvoren.
       */
      const sets: string[] = [];
      const params: unknown[] = [actor.companyId];
      const set = (column: string, value: unknown, cast = "") => {
        params.push(value);
        sets.push(`${column} = $${params.length}${cast}`);
      };
      if (input.projectId !== undefined) set("project_id", input.projectId);
      if (input.phaseId !== undefined) set("phase_id", input.phaseId);
      if (input.title !== undefined) set("title", input.title);
      if (input.description !== undefined) set("description", input.description);
      if (input.assigneeWorkerId !== undefined) set("assignee_worker_id", input.assigneeWorkerId);
      if (input.assigneeUserId !== undefined) set("assignee_user_id", input.assigneeUserId);
      if (input.dueOn !== undefined) set("due_on", input.dueOn, "::date");
      if (input.priority !== undefined) set("priority", input.priority);
      if (input.status !== undefined) {
        set("status", input.status);
        if (input.status === "DONE") {
          sets.push("completed_at = coalesce(completed_at, clock_timestamp())");
        } else {
          sets.push("completed_at = NULL");
        }
      }
      params.push(actor.userId);
      sets.push(`updated_by = $${params.length}`, "updated_at = clock_timestamp()");
      if (sets.length === 2) return { code: "VALIDATION_FAILED", message: "Nema izmjena." };
      params.push(input.id);
      await client.query(
        `UPDATE public.project_tasks SET ${sets.join(", ")}
          WHERE company_id = $1 AND id = $${params.length}`,
        params,
      );
      await writeAudit(client, {
        companyId: actor.companyId,
        actorId: actor.userId,
        actorEmail: null,
        action: "project.task_updated",
        entityType: "project_task",
        entityId: input.id,
        metadata: { status },
      });
      const row = await client.query(`${TASK_SELECT} WHERE t.company_id = $1 AND t.id = $2`, [
        actor.companyId,
        input.id,
      ]);
      return toTask(row.rows[0]!, today);
    }

    if (!input.title) return { code: "VALIDATION_FAILED", message: "Naslov zadatka je obavezan." };
    const id = `tsk_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
    const status = input.status ?? "OPEN";
    try {
      await client.query(
        `INSERT INTO public.project_tasks
           (id, company_id, project_id, phase_id, title, description, assignee_worker_id,
            assignee_user_id, due_on, priority, status, completed_at, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,
                 CASE WHEN $11 = 'DONE' THEN clock_timestamp() ELSE NULL END,$12,$12)`,
        [
          id,
          actor.companyId,
          input.projectId ?? null,
          input.phaseId ?? null,
          input.title,
          input.description ?? null,
          input.assigneeWorkerId ?? null,
          input.assigneeUserId ?? null,
          input.dueOn ?? null,
          input.priority ?? "NORMAL",
          status,
          actor.userId,
        ],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("project_tasks_assignee_check")) {
        return { code: "VALIDATION_FAILED", message: "Zadatak ima jednog izvršioca." };
      }
      throw error;
    }
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "project.task_created",
      entityType: "project_task",
      entityId: id,
      metadata: { projectId: input.projectId ?? null, priority: input.priority ?? "NORMAL" },
    });
    const row = await client.query(`${TASK_SELECT} WHERE t.company_id = $1 AND t.id = $2`, [
      actor.companyId,
      id,
    ]);
    return toTask(row.rows[0]!, today);
  });
}

export async function listTaskComments(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: Parameters<typeof can>[0] },
  taskId: string,
): Promise<TaskCommentRow[] | TaskServiceError> {
  if (!can(actor.roles, "projects.view")) {
    return { code: "FORBIDDEN", message: "Nemate pravo pregleda zadataka." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const rows = await client.query(
      `SELECT c.id, c.task_id, c.author_id,
              COALESCE(u.first_name || ' ' || u.last_name, u.email) AS author_name,
              c.body, c.created_at::text
         FROM public.task_comments c
         JOIN public.users u ON u.id = c.author_id
        WHERE c.company_id = $1 AND c.task_id = $2
        ORDER BY c.created_at, c.id`,
      [actor.companyId, taskId],
    );
    return rows.rows.map((row) => ({
      id: String(row.id),
      task_id: String(row.task_id),
      author_id: String(row.author_id),
      author_name: String(row.author_name),
      body: String(row.body),
      created_at: new Date(String(row.created_at)).toISOString(),
    }));
  });
}

export async function addTaskComment(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: Parameters<typeof can>[0] },
  taskId: string,
  body: string,
  attachmentId: string | null,
): Promise<TaskCommentRow | TaskServiceError> {
  // Komentar smije pisati svako ko vidi zadatak: pitanje na terenu je upravo ono što nedostaje
  // kad komentar smiju pisati samo rukovodioci.
  if (!can(actor.roles, "projects.view")) {
    return { code: "FORBIDDEN", message: "Nemate pravo komentarisanja." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const task = await client.query("SELECT 1 FROM public.project_tasks WHERE company_id = $1 AND id = $2", [
      actor.companyId,
      taskId,
    ]);
    if (!task.rows[0]) return { code: "NOT_FOUND", message: "Zadatak nije pronađen." };
    if (attachmentId) {
      const attachment = await client.query<{ status: string }>(
        "SELECT status FROM public.attachments WHERE company_id = $1 AND id = $2",
        [actor.companyId, attachmentId],
      );
      if (!attachment.rows[0] || attachment.rows[0].status !== "ready") {
        return { code: "VALIDATION_FAILED", message: "Prilog nije spreman." };
      }
    }
    const id = `tcm_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
    await client.query(
      `INSERT INTO public.task_comments (id, company_id, task_id, author_id, body)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, actor.companyId, taskId, actor.userId, body],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "project.task_commented",
      entityType: "project_task_comment",
      entityId: id,
      metadata: { taskId },
    });
    const row = await client.query(
      `SELECT c.id, c.task_id, c.author_id,
              COALESCE(u.first_name || ' ' || u.last_name, u.email) AS author_name,
              c.body, c.created_at::text
         FROM public.task_comments c JOIN public.users u ON u.id = c.author_id
        WHERE c.company_id = $1 AND c.id = $2`,
      [actor.companyId, id],
    );
    const saved = row.rows[0]!;
    return {
      id: String(saved.id),
      task_id: String(saved.task_id),
      author_id: String(saved.author_id),
      author_name: String(saved.author_name),
      body: String(saved.body),
      created_at: new Date(String(saved.created_at)).toISOString(),
    };
  });
}
