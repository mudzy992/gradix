/**
 * Dozvole po roli — tabela, ne `if` u rutama (B8/D-030).
 *
 * R1a koristi samo `users.manage`. Matrica za ostale resurse dolazi u R1b, gdje se dodaje
 * i pregled u UI-u; tada se ovaj fajl širi, a ne prepisuje.
 *
 * Pravilo koje ide uz tabelu: **ADMIN ne dira OWNER-a i ne dira sebe.** To nije dozvola nego
 * zaštita od zaključavanja firme bez vlasnika — zato se provjerava u servisu, ne u UI-u.
 */
export const PERMISSIONS = {
  "users.manage": ["OWNER", "ADMIN"],
} as const satisfies Record<string, readonly string[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(roles: readonly string[], permission: Permission): boolean {
  const allowed: readonly string[] = PERMISSIONS[permission];
  return roles.some((role) => allowed.includes(role));
}

/** Role koje osoba smije mijenjati: nikad OWNER, nikad samu sebe. */
export function canManageUser(
  actor: { userId: string; roles: readonly string[] },
  target: { userId: string; roles: readonly string[] },
): boolean {
  if (!can(actor.roles, "users.manage")) return false;
  if (actor.userId === target.userId) return false;
  return !target.roles.includes("OWNER");
}
