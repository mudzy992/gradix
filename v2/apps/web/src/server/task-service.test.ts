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
import { listTasks } from "./task-service";

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
