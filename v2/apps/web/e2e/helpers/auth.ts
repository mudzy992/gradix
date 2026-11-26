/** E2E auth — Izvor obrasca: v2 e2e smoke/navigation (refaktor Faza 3). */
import { expect, type Page } from "@playwright/test";
import { totpCode, totpStep, TOTP_PERIOD_SECONDS, TOTP_WINDOW_STEPS } from "@gradix/domain/server";

/**
 * Sintetička TOTP tajna iz demo seed-a (`scripts/seed.ts`).
 *
 * F1: OWNER/ADMIN/ACCOUNTANT imaju obaveznu 2FA, pa se E2E prijava sastoji iz dva koraka.
 * Tajna je javna NAMJERNO — demo baza je sintetička; u produkciji korisnik tajnu nikad ne
 * dijeli. Test računa kod istim algoritmom kao autentikator aplikacija.
 */
export const E2E_TOTP_SECRET = process.env.SEED_TOTP_SECRET ?? "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

/** Kod za tekući 30-s korak; `offset` pomjera korak (za test isteka). */
export function e2eTotpCode(offset = 0): string {
  return totpCode(E2E_TOTP_SECRET, totpStep(Date.now()) + offset);
}

/**
 * Skida replay-brojač demo naloga prije prijave (`user_totp.last_used_step`).
 *
 * Zašto je to nužno: zaštita od replay-a (spec 01 §1.5.23) odbija kod čiji je korak `<=`
 * zadnji iskorišteni, pa **isti nalog** može da se prijavi najviše tri puta u jednom
 * 30-s periodu (prozor je ±1 korak). E2E suite prijavljuje iste demo naloge desetinama puta u
 * minuti — bez ovoga drugi login pada kao „pogrešan kod", a stvarni uzrok je zaštita koja
 * radi kako treba.
 *
 * Zaštita se NE gasi: testira je `f1-access.integration.test.ts` na pravom serveru. Ovdje se
 * samo resetuje brojač sintetičkog naloga, i to samo kad je izričito dozvoljeno
 * (`E2E_RESET_TOTP_STEP=1`, postavljeno u CI-ju) — produkcija tu varijablu nikad nema.
 */
export async function resetTotpReplayGuard(email: string): Promise<boolean> {
  if (process.env.E2E_RESET_TOTP_STEP !== "1") return false;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return false;
  const { Client } = await import("pg");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    /*
     * Dvije RLS politike na `user_totp` traže različit kontekst, pa red ide u dva koraka:
     *   1. `user_totp_login_lookup` čita tajnu po `app.auth_lookup_user` — BEZ tenant konteksta
     *      (to je putanja prijave: email + lozinka su već provjereni);
     *   2. `user_totp_member` traži `app.company_id`, pa se firma nađe preko `memberships`
     *      i postavi prije `UPDATE`.
     * Prvi pokušaj sa JOIN-om je vraćao `false` — RLS je red sakrio, a ne nedostatak podatka.
     */
    await client.query("BEGIN");
    /*
     * `users` je također pod RLS-om; politika `users_login_email_lookup` pušta tačno jedan
     * red, i to po `app.auth_lookup_email` (isti obrazac koji koristi prijava).
     */
    await client.query("SELECT set_config('app.auth_lookup_email', $1, true)", [email]);
    const userId = (await client.query<{ id: string }>("SELECT id FROM users WHERE email = $1 LIMIT 1", [email]))
      .rows[0]?.id;
    await client.query("SELECT set_config('app.auth_lookup_email', '', true)");
    if (!userId) {
      await client.query("ROLLBACK");
      return false;
    }

    await client.query("SELECT set_config('app.auth_lookup_user', $1, true)", [userId]);
    const secret = await client.query<{ user_id: string }>(
      "SELECT user_id FROM user_totp WHERE user_id = $1",
      [userId],
    );
    if (secret.rowCount === 0) {
      await client.query("ROLLBACK");
      return false;
    }

    // Ključ `app.auth_lookup_user` pokriva i `memberships` (`auth_lookup_membership`), pa se
    // firma čita prije nego se ključ obriše — inače RLS vrati ništa i reset tiho ne uradi ništa.
    const companyIdValue = (
      await client.query<{ company_id: string }>(
        "SELECT company_id FROM memberships WHERE user_id = $1 LIMIT 1",
        [userId],
      )
    ).rows[0]?.company_id;
    if (!companyIdValue) {
      await client.query("ROLLBACK");
      return false;
    }

    await client.query("SELECT set_config('app.company_id', $1, true)", [companyIdValue]);
    await client.query("UPDATE user_totp SET last_used_step = NULL, updated_at = now() WHERE user_id = $1", [
      userId,
    ]);
    await client.query("COMMIT");
    return true;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Kod koji server još NIJE vidio za ovaj nalog.
 *
 * Redoslijed: tekući korak → `current + 1` (dozvoljeni prozor, pomjera brojač unaprijed) →
 * čekanje prvog koraka koji server sigurno nije vidio. Prva dva pokušaja pokrivaju slučaj
 * kad reset nije dostupan (lokalno bez baze); treći je posljednja linija odbrane, da test
 * nikad ne padne zbog sata, nego samo sporije prođe.
 */
const lastLoginStep = new Map<string, number>();

export async function freshTotpCode(
  attempt: (code: string) => Promise<boolean>,
  user = "shared",
): Promise<boolean> {
  const now = totpStep(Date.now());
  const previous = lastLoginStep.get(user);
  if (previous === undefined || previous < now) {
    if (await attempt(totpCode(E2E_TOTP_SECRET, now))) {
      lastLoginStep.set(user, now);
      return true;
    }
  }
  if (await attempt(totpCode(E2E_TOTP_SECRET, now + TOTP_WINDOW_STEPS))) {
    lastLoginStep.set(user, now + TOTP_WINDOW_STEPS);
    return true;
  }
  const waitMs =
    ((TOTP_PERIOD_SECONDS * 2 - (Date.now() / 1000) % TOTP_PERIOD_SECONDS) % TOTP_PERIOD_SECONDS) * 1000;
  await new Promise((resolve) => setTimeout(resolve, waitMs + 250));
  const next = totpStep(Date.now()) + TOTP_WINDOW_STEPS;
  const ok = await attempt(totpCode(E2E_TOTP_SECRET, next));
  if (ok) lastLoginStep.set(user, next);
  return ok;
}

export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? "";

export const E2E_USERS = {
  owner: "vlasnik@demo.test",
  admin: "ured@demo.test",
  pm: "voditelj@demo.test",
  supervisor: "sef@demo.test",
  worker: "radnik@demo.test",
  accountant: "racunovodja@demo.test",
} as const;

export function requireE2ePassword(): void {
  if (!E2E_PASSWORD) throw new Error("E2E_PASSWORD nije postavljen (demo seed lozinka).");
}

/**
 * UI prijava (cookie u browser kontekstu).
 *
 * Dva koraka od F1: lozinka, pa TOTP kod za role koje ga traže. Korak za kod se prepoznaje
 * po polju, a ne po URL-u — pre-auth nije sesija i ekran ostaje isti.
 */
export async function loginUi(page: Page, email: string): Promise<void> {
  requireE2ePassword();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Lozinka").fill(E2E_PASSWORD);
  // Uhvati odgovor servera PRIJE klika: bez toga pad prijave izgleda kao „waitForURL je
  // istekao", a stvarni status (401/423/429/500) ostaje skriven — to je tačno ono što je
  // E2E prijavljivao u CI-ju.
  const loginResponse = page.waitForResponse((response) => response.url().includes("/api/auth/login"), {
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Prijavi se", exact: true }).click();

  // Drugi korak: polje za kod. `isVisible` odmah poslije prikaza lozinke; bez čekanja bi
  // test prošao i kad 2FA nije ni tražena (lažno zeleno).
  const codeField = page.getByLabel("Kod iz autentikatora ili recovery kod");
  let needsCode = false;
  try {
    const response = await loginResponse;
    if (response.status() !== 200) {
      throw new Error(`POST /api/auth/login → ${response.status()} ${(await response.text()).slice(0, 200)}`);
    }
    needsCode = await codeField.isVisible({ timeout: 3_000 }).catch(() => false);
  } catch (error) {
    // Dijagnostika: URL i vidljivi tekst. Anotacije prolaze tamo gdje logovi ne prolaze.
    const text = await page
      .locator("body")
      .innerText()
      .then((value) => value.replace(/\s+/g, " ").slice(0, 300))
      .catch(() => "?");
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} | url=${page.url()} | ekran=${text}`,
    );
  }
  if (needsCode) {
    // Svjež brojač prije svake prijave: isti demo nalog ulazi više puta u istom periodu.
    await resetTotpReplayGuard(email).catch(() => false);
    const accepted = await freshTotpCode(async (code) => {
      await codeField.fill(code);
      await page.getByRole("button", { name: "Potvrdi kod" }).click();
      // Uspjeh = napustili smo prijavu; promašaj = poruka ostaje na ekranu.
      return page
        .waitForURL("**/pregled", { timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
    }, email);
    if (!accepted) {
      const shown = await page.getByRole("alert").textContent().catch(() => null);
      throw new Error(`2FA prijava nije prošla${shown ? `: ${shown}` : ""}`);
    }
  }

  await page.waitForURL("**/pregled");
}

/**
 * Sesija za API setup: UI login puni browser cookie jar;
 * page.request često ne zadrži cookie nakon čistog API logina u CI.
 */
export async function loginApi(page: Page, email: string): Promise<void> {
  await loginUi(page, email);
}

/**
 * Odjava preko fetch u page kontekstu (cookie jar preglednika).
 * UI meni na Pixel 5 je nestabilan kad je drawer otvoren (sidebar intercept).
 */
export async function logoutUi(page: Page): Promise<void> {
  const status = await page.evaluate(async () => {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    return response.status;
  });
  expect(status, "logout status").toBeLessThan(400);
  await page.goto("/login");
  await page.waitForURL("**/login");
}
