/**
 * F5 (Modul 6 §1.6): lista zadataka — parametri upita se vezuju tačno kad ih filter koristi.
 *
 * Bug koji ovaj test čuva: `today` se dodavao u parametre UVIJEK, a `$2` se koristio samo kad
 * postoji `due` filter. Postgres odbija višak parametara („bind message supplies 2 parameters, but
 * prepared statement requires 1“), pa je `/api/tasks` bez filtera vraćao **500** — a to je
 * najčešći poziv (lista zadataka u projektu i `/ured/zadaci`). Jedinični test to ne bi vidio;
 * ovdje se vidi jer lažni klijent broji parametre i baca istu grešku kao Postgres.
 */
import { describe, expect, it } from "vitest";
import { listTasks, saveTask } from "./task-service";

type Call = { sql: string; params: unknown[] };

/**
 * Lažni `PoolClient` koji se ponaša kao Postgres u JEDNOM detalju koji je ovdje bitan: broj
 * vezanih parametara mora biti tačno najveći `$n` iz upita, inače se baca greška.
 */
function fakeClient(calls: Call[]) {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("clock_timestamp() AT TIME ZONE timezone")) {
        return { rows: [{ today: "2026-11-24" }], rowCount: 1 };
      }
      const used = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
      const max = used.length === 0 ? 0 : Math.max(...used);
      if (max !== params.length) {
        throw new Error("bind message supplies 2 parameters, but prepared statement requires 1");
      }
      if (sql.includes("AS mine_today")) {
        return { rows: [{ mine_today: "0", overdue: "0", open: "0" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const pool = (calls: Call[]) =>
  ({
    connect: async () => ({
      ...fakeClient(calls),
      release: () => undefined,
    }),
  }) as never;

const ACTOR = {
  userId: "usr_test",
  companyId: "cmp_test",
  roles: ["OWNER"] as never,
};

describe("zadaci — parametri liste", () => {
  it("lista bez filtera ne šalje parametar koji upit ne koristi", async () => {
    const calls: Call[] = [];
    const result = await listTasks(pool(calls), ACTOR, { assignee: "ALL" });
    expect("tasks" in result).toBe(true);
    const listCall = calls.find((call) => call.sql.includes("ORDER BY (t.status IN"))!;
    expect(listCall.params).toEqual(["cmp_test"]);
  });

  it("filter „danas“ veže poslovni datum na $2", async () => {
    const calls: Call[] = [];
    await listTasks(pool(calls), ACTOR, { assignee: "ALL", due: "TODAY" });
    const listCall = calls.find((call) => call.sql.includes("ORDER BY (t.status IN"))!;
    expect(listCall.sql).toContain("t.due_on = $2::date");
    expect(listCall.params).toEqual(["cmp_test", "2026-11-24"]);
  });

  it("filter projekta i „moji“ pomjeraju datum na stvarni indeks parametra", async () => {
    const calls: Call[] = [];
    await listTasks(pool(calls), ACTOR, { assignee: "ME", projectId: "prj_1", due: "OVERDUE" });
    const listCall = calls.find((call) => call.sql.includes("ORDER BY (t.status IN"))!;
    /* $1 firma, $2 projekat, $3 datum, $4 korisnik — datum NIJE na fiksnom `$2`. */
    expect(listCall.sql).toContain("t.due_on < $3::date");
    expect(listCall.sql).toContain("t.assignee_user_id = $4");
    expect(listCall.params).toEqual(["cmp_test", "prj_1", "2026-11-24", "usr_test"]);
  });
});

/**
 * F5/Korak 0: `SITE_SUPERVISOR` mijenja STATUS zadatka, ali NE upravlja projektima.
 *
 * Dvije stvari se lako pokvare tiho: (a) šef dobije `projects.manage` „usput“, pa može
 * preusmjeriti tuđi zadatak; (b) servis prihvati cijeli patch jer ga je ruta već propustila.
 * Testovi zato gledaju SAM SERVIS — on je posljednja kapija i njega zovu i testovi i mobilni.
 */
describe("zadaci — šef gradilišta mijenja samo status", () => {
  const SUPERVISOR = {
    userId: "usr_sef",
    companyId: "cmp_test",
    roles: ["SITE_SUPERVISOR"] as never,
    scope: "PROJECTS" as const,
    projectIds: ["prj_moj"],
  };

  it("odbija izmjenu naslova bez ijednog SQL upita", async () => {
    const calls: Call[] = [];
    const result = await saveTask(
      pool(calls),
      SUPERVISOR,
      { id: "tsk_1", title: "Preusmjeren zadatak" },
      true,
    );
    expect(result).toMatchObject({ code: "FORBIDDEN" });
    expect((result as { message: string }).message).toContain("samo status");
    // Nijedan upit: odbijanje je PRIJE transakcije, pa se ništa ne zaključava ni ne piše.
    expect(calls).toHaveLength(0);
  });

  it("odbija kreiranje novog zadatka", async () => {
    const calls: Call[] = [];
    const result = await saveTask(
      pool(calls),
      SUPERVISOR,
      { title: "Novi zadatak", projectId: "prj_moj" },
      false,
    );
    expect(result).toMatchObject({ code: "FORBIDDEN" });
  });

  it("dodjela na tuđi projekat je odbijena i poslije čitanja zadatka", async () => {
    const calls: Call[] = [];
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        // `saveTask` prvo čita poslovni datum firme — bez njega servis baca, ne vraća grešku.
        if (sql.includes("clock_timestamp() AT TIME ZONE timezone")) {
          return { rows: [{ today: "2026-11-24" }], rowCount: 1 };
        }
        if (sql.includes("FOR UPDATE")) {
          return { rows: [{ status: "OPEN", project_id: "prj_tudji" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    };
    const limitedPool = { connect: async () => client } as never;
    const result = await saveTask(limitedPool, SUPERVISOR, { id: "tsk_1", status: "DONE" }, true);
    expect(result).toMatchObject({ code: "FORBIDDEN" });
    expect((result as { message: string }).message).toContain("raspoređeni");
    // Status NIJE upisan: provjera opsega ide prije `UPDATE`.
    expect(calls.some((call) => call.sql.includes("UPDATE public.project_tasks"))).toBe(false);
  });

  it("na svom projektu status prolazi, a opseg se čita iz zadatka", async () => {
    const calls: Call[] = [];
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        // `saveTask` prvo čita poslovni datum firme — bez njega servis baca, ne vraća grešku.
        if (sql.includes("clock_timestamp() AT TIME ZONE timezone")) {
          return { rows: [{ today: "2026-11-24" }], rowCount: 1 };
        }
        if (sql.includes("FOR UPDATE")) {
          return { rows: [{ status: "OPEN", project_id: "prj_moj" }], rowCount: 1 };
        }
        if (sql.includes("UPDATE public.project_tasks")) {
          return { rows: [{ id: "tsk_1" }], rowCount: 1 };
        }
        // Završno čitanje reda (`TASK_SELECT`) — servis vraća zadatak, ne broj pogođenih.
        if (sql.includes("FROM public.project_tasks t")) {
          return {
            rows: [
              {
                id: "tsk_1",
                project_id: "prj_moj",
                title: "Zadatak",
                priority: "NORMAL",
                status: "DONE",
                due_on: null,
                completed_at: "2026-11-24T08:00:00Z",
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    };
    const limitedPool = { connect: async () => client } as never;
    const result = await saveTask(limitedPool, SUPERVISOR, { id: "tsk_1", status: "DONE" }, true);
    // Nije `FORBIDDEN` — servis je prošao kapiju i pokušao upis (oblik reda nije tema ovog testa).
    expect(result).not.toMatchObject({ code: "FORBIDDEN" });
    const update = calls.find((call) => call.sql.includes("UPDATE public.project_tasks"));
    expect(update).toBeDefined();
  });
});
