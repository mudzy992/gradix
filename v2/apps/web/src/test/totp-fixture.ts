/**
 * Fikstura za naloge sa obaveznom 2FA u integracionim testovima.
 *
 * Od F1 svaka uredska rola (OWNER/ADMIN/ACCOUNTANT) mora imati potvrđenu 2FA, pa test koji
 * priprema takav nalog mora upisati i TOTP tajnu — inače prijava staje na `preAuthToken` i
 * test dalje nema sesiju. Tajna se upisuje u ISTU tabelu i na isti način kao kroz aplikaciju
 * (AES-256-GCM sa ključem iz `AUTH_SECRET`), pa `2fa/login` je prihvata bez posebnog puta.
 */
import { encryptTotpSecret, generateTotpSecret } from "@gradix/domain";

export type TotpFixture = { secret: string; encrypted: string };

/** Nova tajna i njen šifrat, spremni za `INSERT INTO user_totp`. */
export function totpFixture(): TotpFixture {
  const secret = generateTotpSecret();
  return { secret, encrypted: encryptTotpSecret(secret, process.env.AUTH_SECRET ?? "") };
}

/**
 * Upisuje potvrđenu 2FA za dato korisničko ime-id. `admin` je administrativni pool
 * (zaobilazi RLS jer `user_totp` je tenant tabela sa FORCE RLS).
 */
export async function seedTotp(
  admin: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  userId: string,
  fixture: TotpFixture = totpFixture(),
): Promise<TotpFixture> {
  await admin.query(
    `INSERT INTO user_totp (id, user_id, secret_enc, confirmed_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, confirmed_at = now()`,
    [`totp_${userId}`, userId, fixture.encrypted],
  );
  // `users.totp_enabled` je OZNAKA koju čita prijava (brza provjera bez join-a na tajnu);
  // `user_totp.confirmed_at` je sam dokaz. Potvrda uparivanja piše oboje — i fikstura mora,
  // inače prijava vidi „2FA nije uparena" iako tajna postoji.
  await admin.query("UPDATE users SET totp_enabled = true, must_enroll_2fa = false WHERE id = $1", [userId]);
  return fixture;
}

/**
 * Briše brojač pokušaja prijave i otključava naloge fiksture.
 *
 * Zašto je ovo potrebno: brojač je u bazi i prozor je 60 s. Test koji UISTINU provjerava
 * pogrešnu lozinku (i rate limit) ostavlja tragove, pa drugi prolaz u istoj minuti padne na
 * `RATE_LIMITED` — lažan pad koji izgleda kao greška u kodu. Reset ide kroz admin pool jer
 * aplikacijska rola ne smije ni čitati `login_attempts` (to i sam test provjerava).
 */
export async function resetLoginAttempts(
  admin: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  userIds: string[] = [],
): Promise<void> {
  await admin.query("DELETE FROM login_attempts");
  for (const userId of userIds) {
    await admin.query("UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1", [userId]);
  }
}
