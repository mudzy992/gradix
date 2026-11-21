import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { LocalSqlite } from "../db/migrations";

export type TestSqlite = LocalSqlite & {
  raw: DatabaseSync;
  path: string;
  directory: string;
  close: () => void;
};

export function createNodeSqlite(prefix = "gradix-sqlite-test-"): TestSqlite {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  const path = join(directory, "gradix.db");
  const raw = new DatabaseSync(path);
  const adapter = {
    raw,
    path,
    directory,
    execAsync: async (sql: string) => { raw.exec(sql); },
    runAsync: async (sql: string, params: readonly unknown[] = []) => raw.prepare(sql).run(...params as never[]),
    getFirstAsync: async <T>(sql: string, params: readonly unknown[] = []) => raw.prepare(sql).get(...params as never[]) as T | undefined,
    getAllAsync: async <T>(sql: string, params: readonly unknown[] = []) => raw.prepare(sql).all(...params as never[]) as T[],
    withTransactionAsync: async (task: () => Promise<void>) => {
      raw.exec("BEGIN IMMEDIATE");
      try {
        await task();
        raw.exec("COMMIT");
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
    close: () => raw.close(),
  };
  return adapter as unknown as TestSqlite;
}
