import { describe, expect, it } from "vitest";
import { assertSyncAccount } from "./account-binding";

describe("mobile sync account binding", () => {
  it("permits only the company and user that own the SQLite outbox partition", () => {
    const owner = { companyId: "company-A", userId: "user-A" };
    expect(() => assertSyncAccount(owner, owner)).not.toThrow();
    expect(() => assertSyncAccount(owner, { companyId: "company-A", userId: "user-B" }))
      .toThrowError(expect.objectContaining({ code: "LOCAL_ACCOUNT_SCOPE_MISMATCH" }));
    expect(() => assertSyncAccount(owner, { companyId: "company-B", userId: "user-A" }))
      .toThrowError(expect.objectContaining({ code: "LOCAL_ACCOUNT_SCOPE_MISMATCH" }));
    expect(() => assertSyncAccount(owner, null))
      .toThrowError(expect.objectContaining({ code: "LOCAL_ACCOUNT_SCOPE_MISMATCH" }));
  });
});
