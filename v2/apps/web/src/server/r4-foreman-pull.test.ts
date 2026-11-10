import { describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { foremanVisibleR4EventIds, sanitizeForemanPullPayload } from "./r4-foreman-pull";

const COMPANY = "company-foreman";
const FOREMAN_WORKER = "worker-foreman";
const FOREMAN_USER = "user-foreman";
const WORKER = "worker-in-scope";
const PROJECT = "project-in-scope";
const DATE = "2026-11-09";

type MockRow = Record<string, unknown>;

function event(input: {
  id: string;
  type: "workday" | "work_entry" | "sync_conflict";
  entityId: string;
  payload: Record<string, unknown> | null;
  tombstone?: boolean;
}) {
  return {
    id: input.id,
    entityType: input.type,
    entityId: input.entityId,
    payload: input.payload,
    tombstone: input.tombstone ?? false,
  } as const;
}

function mockClient() {
  const calls: { sql: string; values: unknown[] }[] = [];
  const client = {
    query: async (sql: string, values: unknown[] = []): Promise<{ rows: MockRow[] }> => {
      calls.push({ sql, values });
      if (sql.includes("AS candidate(event_id text, entity_id text, workday_id text")) {
        const candidates = JSON.parse(String(values[2])) as Record<string, unknown>[];
        return { rows: candidates
          .filter((candidate) => candidate.worker_id === WORKER
            && candidate.project_id === PROJECT && candidate.work_date === DATE)
          .map((candidate) => ({ event_id: candidate.event_id })) };
      }
      if (sql.includes("AS candidate(event_id text, entity_id text, worker_id text, work_date date")) {
        const candidates = JSON.parse(String(values[3])) as Record<string, unknown>[];
        return { rows: candidates
          .filter((candidate) => values[2] === FOREMAN_USER
            && candidate.worker_id === WORKER && candidate.project_id === PROJECT)
          .map((candidate) => ({ event_id: candidate.event_id })) };
      }
      if (sql.includes("AS candidate(event_id text, workday_id text")) {
        const candidates = JSON.parse(String(values[2])) as Record<string, unknown>[];
        return { rows: candidates
          .filter((candidate) => candidate.worker_id === WORKER && candidate.work_date === DATE)
          .map((candidate) => ({ event_id: candidate.event_id })) };
      }
      throw new Error("unexpected foreman pull SQL");
    },
  };
  return { client: client as unknown as PoolClient, calls };
}

describe("foreman R4 pull scope candidate handling", () => {
  it("passes snake-case scope metadata and fails closed for breaks, malformed payloads, and tombstones", async () => {
    const { client, calls } = mockClient();
    const allowedEntry = event({
      id: "change-allowed-entry",
      type: "work_entry",
      entityId: "entry-allowed",
      payload: {
        id: "entry-allowed",
        workdayId: "day-allowed",
        workerId: WORKER,
        workDate: DATE,
        kind: "WORK",
        projectId: PROJECT,
      },
    });
    const outOfScopeEntry = event({
      id: "change-outside-entry",
      type: "work_entry",
      entityId: "entry-outside",
      payload: {
        id: "entry-outside",
        workdayId: "day-outside",
        workerId: "worker-outside",
        workDate: DATE,
        kind: "WORK",
        projectId: "project-outside",
      },
    });
    const allowedWorkday = event({
      id: "change-allowed-day",
      type: "workday",
      entityId: "day-allowed",
      payload: { id: "day-allowed", workerId: WORKER, workDate: DATE },
    });
    const allowedConflict = event({
      id: "change-allowed-conflict",
      type: "sync_conflict",
      entityId: "conflict-allowed",
      payload: {
        id: "conflict-allowed",
        workerId: WORKER,
        workDate: DATE,
        receivedPayload: {
          kind: "WORK",
          projectId: PROJECT,
          startedAt: `${DATE}T08:00:00+01:00`,
        },
      },
    });
    const breakEntry = event({
      id: "change-break",
      type: "work_entry",
      entityId: "entry-break",
      payload: {
        id: "entry-break",
        workdayId: "day-allowed",
        workerId: WORKER,
        workDate: DATE,
        kind: "BREAK",
        projectId: null,
      },
    });
    const tombstone = event({
      id: "change-tombstone",
      type: "work_entry",
      entityId: "entry-allowed",
      payload: null,
      tombstone: true,
    });
    const malformedDay = event({
      id: "change-malformed-day",
      type: "workday",
      entityId: "day-malformed",
      payload: { id: "different-entity-id", workerId: WORKER, workDate: DATE },
    });

    const visible = await foremanVisibleR4EventIds(
      client,
      COMPANY,
      FOREMAN_WORKER,
      FOREMAN_USER,
      [allowedEntry, outOfScopeEntry, allowedWorkday, allowedConflict, breakEntry, tombstone, malformedDay],
    );

    expect(visible).toEqual(new Set([
      "change-allowed-entry",
      "change-allowed-day",
      "change-allowed-conflict",
    ]));
    expect(calls).toHaveLength(3);
    expect(JSON.parse(String(calls[0]?.values[2]))[0]).toMatchObject({
      event_id: "change-allowed-entry",
      entity_id: "entry-allowed",
      workday_id: "day-allowed",
      worker_id: WORKER,
      work_date: DATE,
      project_id: PROJECT,
    });
    expect(JSON.parse(String(calls[1]?.values[3]))[0]).toMatchObject({
      event_id: "change-allowed-conflict",
      entity_id: "conflict-allowed",
      worker_id: WORKER,
      work_date: DATE,
      project_id: PROJECT,
    });
    expect(calls[1]?.values[2]).toBe(FOREMAN_USER);
    expect(JSON.parse(String(calls[2]?.values[2]))[0]).toMatchObject({
      event_id: "change-allowed-day",
      workday_id: "day-allowed",
      worker_id: WORKER,
      work_date: DATE,
    });
    expect(calls.map((call) => call.sql).join("\n")).not.toContain("phone");
    expect(calls.map((call) => call.sql).join("\n")).not.toContain("email");
  });

  it("projects foreman payloads onto the approved fields and strips contact properties", () => {
    const workEntry = sanitizeForemanPullPayload("work_entry", {
      id: "entry-1",
      workerId: WORKER,
      workerName: "Amina Radnik",
      workDate: DATE,
      kind: "WORK",
      projectId: PROJECT,
      note: "rad na objektu",
      phone: "+38700000000",
      email: "private@example.test",
    });
    expect(workEntry).toEqual({
      id: "entry-1",
      workerId: WORKER,
      workerName: "Amina Radnik",
      workDate: DATE,
      kind: "WORK",
      projectId: PROJECT,
      note: "rad na objektu",
    });

    const conflict = sanitizeForemanPullPayload("sync_conflict", {
      id: "conflict-1",
      workerId: WORKER,
      workerName: "Amina Radnik",
      workDate: DATE,
      receivedPayload: {
        kind: "WORK",
        projectId: PROJECT,
        startedAt: `${DATE}T08:00:00+01:00`,
        note: "offline segment",
        phone: "+38700000000",
        email: "private@example.test",
      },
      email: "private@example.test",
    });
    expect(conflict).toMatchObject({
      id: "conflict-1",
      workerId: WORKER,
      receivedPayload: {
        kind: "WORK",
        projectId: PROJECT,
        startedAt: `${DATE}T08:00:00+01:00`,
        note: "offline segment",
      },
    });
    const serialized = JSON.stringify({ workEntry, conflict });
    expect(serialized).not.toMatch(/phone|email|private@example/i);
    expect(serialized).not.toContain("+38700000000");
  });
});
