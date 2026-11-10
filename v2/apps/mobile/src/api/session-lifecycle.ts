import {
  clearLocalAccountData,
  getActiveLocalAccount,
  pendingLegacyR0Count,
  pendingOutboxCount,
  type LocalAccount,
} from "../db/r4-outbox";
import type { LocalSqlite } from "../db/migrations";

/** Poruka na uređaju kad administrator/server opozove sesiju (izgubljen telefon, pilot):
 * prijava više ne važi, ali neposlani zapisi ostaju na uređaju i ne idu pod tuđim nalogom. */
export const REVOKED_SESSION_MESSAGE =
  "Prijava više nije važeća — sesija je opozvana ili istekla. Prijavite se ponovo; neposlani zapisi ostaju sačuvani na ovom uređaju.";

export type LogoutSummary = {
  account: LocalAccount | null;
  pendingCount: number;
  legacyR0Count: number;
};

export async function getLogoutSummary(db: LocalSqlite): Promise<LogoutSummary> {
  const account = await getActiveLocalAccount(db);
  const [pendingCount, legacyR0Count] = await Promise.all([
    account ? pendingOutboxCount(db, account) : Promise.resolve(0),
    pendingLegacyR0Count(db),
  ]);
  return { account, pendingCount, legacyR0Count };
}

/** Confirmation is mandatory. Logging out revokes the server session when online and purges
 * private caches/cursors, but deliberately leaves outbox rows bound to their original account. */
export async function logoutMobile(
  db: LocalSqlite,
  confirmed: boolean,
  revoke?: () => Promise<boolean>,
): Promise<{ loggedOut: boolean; requiresConfirmation: boolean; pendingCount: number; serverRevoked: boolean }> {
  const summary = await getLogoutSummary(db);
  const pendingCount = summary.pendingCount + summary.legacyR0Count;
  if (!confirmed) {
    return { loggedOut: false, requiresConfirmation: true, pendingCount, serverRevoked: false };
  }
  let serverRevoked = false;
  try {
    serverRevoked = revoke
      ? await revoke()
      : await (await import("./client")).logoutServerSession();
  } catch {
    serverRevoked = false;
  } finally {
    await clearLocalAccountData(db);
  }
  return { loggedOut: true, requiresConfirmation: false, pendingCount, serverRevoked };
}
