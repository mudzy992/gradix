/**
 * Opseg članstva: šta osoba smije da vidi i radi unutar firme.
 *
 * Jedna funkcija, namjerno. R1b ima dva opsega:
 *   - `COMPANY` — sve u firmi (admin, vlasnik, kancelarija),
 *   - `SELF`    — samo svoje zapise (radnik, vozač).
 *
 * R2 dodaje treći (`PROJECTS` = samo dodijeljeni projekti) **ovdje**, u isti `switch`, uz
 * svoj test — a ne rasipanjem uslova po rutama. Dok se to ne desi, `PROJECTS` ne postoji ni
 * u bazi ni u API-ju: opseg koji UI ne nudi i koji ništa ne mijenja je gori od opsega koji
 * još ne postoji.
 */

export const SCOPES = ["COMPANY", "SELF"] as const;
export type Scope = (typeof SCOPES)[number];

export function isScope(value: unknown): value is Scope {
  return typeof value === "string" && (SCOPES as readonly string[]).includes(value);
}

/** Radnja nad zapisom. `read` je pregled, `write` je izmjena. */
export type ScopedAction =
  | { kind: "read"; ownerId?: string | null }
  | { kind: "write"; ownerId?: string | null }
  /** Radnja nad cijelom firmom (npr. lista korisnika) — `SELF` je ne može. */
  | { kind: "company" };

export type ScopeActor = { userId: string; scope: Scope };

/**
 * Jedina tačka gdje se opseg pretvara u odluku.
 *
 * `COMPANY` propušta sve. `SELF` propušta samo zapise čiji je vlasnik osoba koja radi, i to
 * samo za čitanje i izmjenu **svojih** zapisa — nikad firmu kao cjelinu. Nepoznat vlasnik
 * (`ownerId` nedostaje) se tretira kao tuđ: nepoznato nije dozvoljeno.
 */
export function resolveScope(actor: ScopeActor, action: ScopedAction): boolean {
  switch (actor.scope) {
    case "COMPANY":
      return true;
    case "SELF":
      if (action.kind === "company") return false;
      return Boolean(action.ownerId) && action.ownerId === actor.userId;
    default: {
      // Novo u R2: `PROJECTS` — dodijeljeni projekti. TS ovdje traži da se doda slučaj.
      const exhaustive: never = actor.scope;
      return exhaustive;
    }
  }
}

/** Opseg koji se nudi u UI-u, sa bosanskim opisom. Jedan izvor za formu i za matricu. */
export const SCOPE_LABELS: Record<Scope, { label: string; description: string }> = {
  COMPANY: {
    label: "Cijela firma",
    description: "Vidi i mijenja sve u firmi — kao kancelarija ili rukovodilac.",
  },
  SELF: {
    label: "Samo svoje",
    description: "Vidi i mijenja samo svoje zapise — kao radnik ili vozač na terenu.",
  },
};
