import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetConfigForTests } from "./config";
import { decodeSyncCursor, encodeSyncCursor, SyncCursorError } from "./sync-cursor";

const originalSecret = process.env.AUTH_SECRET;
const originalDatabaseUrl = process.env.DATABASE_URL;

beforeAll(() => {
  process.env.AUTH_SECRET = "sync-cursor-unit-test-secret-at-least-32-chars";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  resetConfigForTests();
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = originalSecret;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  resetConfigForTests();
});

describe("opaque tenant-bound sync cursor", () => {
  it("round-trips an int8 sequence without exposing it as the cursor token", () => {
    const token = encodeSyncCursor("company_a", "9007199254740993");
    expect(token).not.toContain("9007199254740993");
    expect(decodeSyncCursor(token, "company_a")).toEqual({ companyId: "company_a", sequence: "9007199254740993" });
  });

  it("rejects tampering and cursor reuse across tenants", () => {
    const token = encodeSyncCursor("company_a", "12");
    const [payload, signature] = token.split(".");
    expect(() => decodeSyncCursor(`${payload}.x${signature?.slice(1)}`, "company_a")).toThrow(SyncCursorError);
    expect(() => decodeSyncCursor(token, "company_b")).toThrow(SyncCursorError);
  });

  it("rejects raw R0 watermarks and invalid PostgreSQL BIGINT sequences", () => {
    expect(() => decodeSyncCursor("2030-01-01T00:00:00Z", "company_a")).toThrow(SyncCursorError);
    expect(() => encodeSyncCursor("company_a", "9223372036854775808")).toThrow(SyncCursorError);
  });
});
