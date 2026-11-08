/**
 * Opseg članstva: šta osoba smije da vidi i radi unutar firme.
 *
 * Tri opsega, jedna funkcija. Namjerno je tako: opseg se pretvara u odluku na JEDNOM mjestu, a ne
 * rasipa se kao `if` po rutama. Kad se pravilo mijenja, mijenja se ovdje i padne test — što je cilj.
 *
 *   - `COMPANY`  — sve u firmi (vlasnik, admin, kancelarija),
 *   - `PROJECTS` — samo dodijeljeni projekti i zapisi vezani za njih (rukovodilac, šef),
 *   - `SELF`     — samo svoje (radnik, vozač).
 *
 * `PROJECTS` je vraćen u R3, tek kad projekti postoje. U R1b je bio skinut namjerno: opseg koji
 * ništa ne mijenja je gori od opsega koji još ne postoji, jer izgleda kao da nešto štiti.
 *
 * Zašto `PROJECTS` traži bar jedan projekat: opseg koji ne vidi ništa nije podešavanje nego zamka
 * — čovjek se prijavi i misli da je sistem prazan. Zato servis odbija da snimi takav opseg.
 */

export const SCOPES = ["COMPANY", "PROJECTS", "SELF"] as const;
export type Scope = (typeof SCOPES)[number];

export function isScope(value: unknown): value is Scope {
  return typeof value === "string" && (SCOPES as readonly string[]).includes(value);
}

/** Radnja nad zapisom. `read` je pregled, `write` je izmjena. */
export type ScopedAction =
  | { kind: "read"; ownerId?: string | null; projectId?: string | null }
  | { kind: "write"; ownerId?: string | null; projectId?: string | null }
  /** Radnja nad cijelom firmom (npr. lista korisnika) — ni `PROJECTS` ni `SELF` je ne mogu. */
  | { kind: "company" };

export type ScopeActor = {
  userId: string;
  scope: Scope;
  /** Projekti na koje je osoba dodijeljena. Koristi se samo za `PROJECTS`. */
  projectIds?: readonly string[];
};

/**
 * Jedina tačka gdje se opseg pretvara u odluku.
 *
 * `COMPANY` propušta sve. `PROJECTS` propušta zapise vezane za dodijeljeni projekat, i ništa što
 * nema projekat — firma kao cjelina mu je zatvorena. `SELF` propušta samo svoje zapise.
 *
 * Nepoznato je tuđe: ako zapis nema projekat (a opseg je `PROJECTS`) ili nema vlasnika (a opseg je
 * `SELF`), odluka je „ne". Dozvola se ne izvodi iz nedostatka podatka.
 */
export function resolveScope(actor: ScopeActor, action: ScopedAction): boolean {
  switch (actor.scope) {
    case "COMPANY":
      return true;

    case "PROJECTS": {
      // Liste i radnje nad firmom (korisnici, audit, role) traže `COMPANY`.
      if (action.kind === "company") return false;
      if (!action.projectId) return false;
      return (actor.projectIds ?? []).includes(action.projectId);
    }

    case "SELF":
      if (action.kind === "company") return false;
      return Boolean(action.ownerId) && action.ownerId === actor.userId;

    default: {
      const exhaustive: never = actor.scope;
      return exhaustive;
    }
  }
}

/**
 * Projekti koje osoba vidi — ulaz za `WHERE` u upitima.
 *
 * `COMPANY` dobija `null` (bez filtera), ostali spisak. Namjerno `null`, a ne prazan niz: prazan
 * niz bi u `WHERE project_id = ANY('{}')` značio „nijedan red" i to je ISPRAVNO za `PROJECTS` bez
 * dodjele, ali bi za `COMPANY` značilo da ne vidi ništa — a to nije isto. Zato se razlika pravi
 * ovdje, glasno, a ne u svakom upitu ponovo.
 */
export function visibleProjectIds(actor: ScopeActor): string[] | null {
  if (actor.scope === "COMPANY") return null;
  if (actor.scope === "PROJECTS") return [...(actor.projectIds ?? [])];
  return [];
}

/** Opseg koji se nudi u UI-u, sa bosanskim opisom. Jedan izvor za formu i za matricu. */
export const SCOPE_LABELS: Record<Scope, { label: string; description: string }> = {
  COMPANY: {
    label: "Cijela firma",
    description: "Vidi i mijenja sve u firmi — kao kancelarija ili rukovodilac.",
  },
  PROJECTS: {
    label: "Samo dodijeljeni projekti",
    description: "Vidi i mijenja samo projekte na koje je dodijeljen, i zapise vezane za njih.",
  },
  SELF: {
    label: "Samo svoje",
    description: "Vidi i mijenja samo svoje zapise — kao radnik ili vozač na terenu.",
  },
};
