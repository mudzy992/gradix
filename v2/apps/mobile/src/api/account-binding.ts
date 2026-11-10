export type AccountIdentity = { companyId: string; userId: string };

export class SyncAccountMismatchError extends Error {
  readonly code = "LOCAL_ACCOUNT_SCOPE_MISMATCH";
  constructor() {
    super("Sync je zaustavljen jer prijavljena firma ili korisnik ne odgovara vlasniku lokalnih redova.");
    this.name = "SyncAccountMismatchError";
  }
}

export function assertSyncAccount(expected: AccountIdentity, actual: AccountIdentity | null | undefined): void {
  if (!actual || actual.companyId !== expected.companyId || actual.userId !== expected.userId) {
    throw new SyncAccountMismatchError();
  }
}
