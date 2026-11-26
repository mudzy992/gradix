import type PgBoss from "pg-boss";

/** Samo operativne kolone, nikad payload, output, ključ ni imena primalaca. */
export async function grantQueueHealthRead(db: PgBoss.Db): Promise<void> {
  await db.executeSql(`GRANT USAGE ON SCHEMA pgboss TO gradix_app;
    GRANT SELECT (name,state,started_on,completed_on) ON pgboss.job TO gradix_app;
    GRANT SELECT (name,cron,timezone) ON pgboss.schedule TO gradix_app;`, []);
}
