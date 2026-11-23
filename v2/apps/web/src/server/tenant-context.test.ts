import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetConfigForTests } from "./config";
import { issueAccessToken } from "./session";
import { authenticate } from "./tenant-context";

const originalSecret = process.env.AUTH_SECRET;
const originalDatabaseUrl = process.env.DATABASE_URL;

beforeAll(() => {
  process.env.AUTH_SECRET = "tenant-context-unit-test-secret-at-least-32-chars";
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

function requestWith(token: string): NextRequest {
  return new NextRequest("http://localhost/api/test", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("authenticate tenant claim guard", () => {
  it("rejects a malformed company claim before it can become a database/RLS context", async () => {
    const token = issueAccessToken({
      sub: "usr_test",
      sid: "ses_test",
      companyId: "tenant/escape",
    } as never);
    await expect(authenticate(requestWith(token))).resolves.toEqual({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("rejects a missing company claim instead of returning an internal database error", async () => {
    const token = issueAccessToken({ sub: "usr_test", sid: "ses_test" } as never);
    await expect(authenticate(requestWith(token))).resolves.toEqual({ ok: false, code: "UNAUTHENTICATED" });
  });
});
