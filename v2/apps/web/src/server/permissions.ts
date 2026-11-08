/**
 * Dozvole po roli — tabela, ne `if` u rutama (B8/D-030).
 *
 * Jedan izvor za tri stvari: rute (`guard`), matrica u UI-u (`/ured/role`) i test dozvola
 * koji se generiše iz ove tabele. Zato svaka dozvola ima i bosanski naziv i objašnjenje —
 * matrica prikazuje ISTO ono što ruta provjerava, pa ne može lagati.
 *
 * Šta ovdje NIJE: dozvole koje ništa ne provjerava. Ako stavka stoji u matrici, ona stvarno
 * pušta ili odbija zahtjev; nova dozvola se dodaje zajedno sa rutom koja je koristi.
 *
 * Pravilo koje ide uz tabelu: **ADMIN ne dira OWNER-a i ne dira sebe.** To nije dozvola nego
 * zaštita od zaključavanja firme bez vlasnika — zato se provjerava u servisu, ne u UI-u.
 */
/** Opseg članstva — izvor je `@gradix/domain`, ovdje se samo re-izvozi za rute i servis. */
export type { Scope } from "@gradix/domain";
export { SCOPES, SCOPE_LABELS, isScope } from "@gradix/domain";

export type Role =
  | "OWNER"
  | "ADMIN"
  | "PROJECT_MANAGER"
  | "SITE_SUPERVISOR"
  | "WORKER"
  | "DRIVER"
  | "MACHINE_OPERATOR"
  | "MECHANIC"
  | "ACCOUNTANT";

export const ROLES: readonly Role[] = [
  "OWNER",
  "ADMIN",
  "PROJECT_MANAGER",
  "SITE_SUPERVISOR",
  "WORKER",
  "DRIVER",
  "MACHINE_OPERATOR",
  "MECHANIC",
  "ACCOUNTANT",
];

export const PERMISSIONS = {
  "users.manage": ["OWNER", "ADMIN"],
  "audit.view": ["OWNER", "ADMIN"],
  "roles.view": ["OWNER", "ADMIN"],
  // R2a. `workers.view` je širi od `manage`: šef gradilišta mora vidjeti ljude, ali ne mijenja
  // njihove podatke. Isto za mašine — rukovalac vidi svoju mašinu, ne uređuje katalog.
  "workers.view": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR"],
  "workers.manage": ["OWNER", "ADMIN"],
  "equipment.view": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "MACHINE_OPERATOR", "MECHANIC"],
  // `equipment.manage` uključuje ispravku brojila (namjerno ne za rukovaoca: on unosi novo
  // stanje, ali ne prepisuje staro — to je posao ureda).
  "equipment.manage": ["OWNER", "ADMIN"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

/** Opis za matricu — isti tekst u UI-u i u testu koji provjerava da nije prazan. */
export const PERMISSION_INFO: Record<Permission, { label: string; description: string }> = {
  "users.manage": {
    label: "Upravljanje korisnicima",
    description: "Pozivnice, reset lozinke, deaktivacija i dodjela rola i opsega.",
  },
  "audit.view": {
    label: "Pregled audit traga",
    description: "Ko je šta mijenjao, sa filterima po osobi, radnji i vremenu.",
  },
  "roles.view": {
    label: "Pregled matrica rola",
    description: "Koja rola šta smije — samo pregled, ne mijenja dozvole.",
  },
  "workers.view": {
    label: "Pregled radnika",
    description: "Lista radnika, kontakt i angažman — bez izmjena.",
  },
  "workers.manage": {
    label: "Upravljanje radnicima",
    description: "Dodavanje, izmjena, deaktivacija i veza radnika sa nalogom.",
  },
  "equipment.view": {
    label: "Pregled mašina",
    description: "Lista mašina i vozila, kategorije i stanje brojila — bez izmjena.",
  },
  "equipment.manage": {
    label: "Upravljanje mašinama",
    description: "Mašine, kategorije, brojilo i ispravke brojila.",
  },
};

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

export function can(roles: readonly string[], permission: Permission): boolean {
  const allowed: readonly string[] = PERMISSIONS[permission];
  return roles.some((role) => allowed.includes(role));
}

/** Dozvole za jednu rolu — ulaz u matricu. */
export function permissionsFor(role: Role): Permission[] {
  return PERMISSION_KEYS.filter((permission) => can([role], permission));
}

/** Bosanski nazivi rola. Jedan izvor za listu, matricu i dijalog. */
export const ROLE_LABELS: Record<Role, { label: string; description: string }> = {
  OWNER: { label: "Vlasnik", description: "Puna kontrola nad firmom; ne može se ukloniti iz firme." },
  ADMIN: { label: "Administrator", description: "Upravlja ljudima i pregleda trag; ne dira vlasnika." },
  PROJECT_MANAGER: { label: "Vođa projekta", description: "Vodi posao na projektima koji su mu dodijeljeni." },
  SITE_SUPERVISOR: { label: "Šef gradilišta", description: "Raspoređuje ljude i mašine na gradilištu." },
  WORKER: { label: "Radnik", description: "Svakodnevni terenski rad i svoji zapisi." },
  DRIVER: { label: "Vozač", description: "Ture, gorivo i vozilo." },
  MACHINE_OPERATOR: { label: "Rukovalac mašine", description: "Radni sati i stanje mašine." },
  MECHANIC: { label: "Mehaničar", description: "Servisi i popravke mašina." },
  ACCOUNTANT: { label: "Računovođa", description: "Finansije, fakture i obračuni." },
};

/** Role koje smije dodijeliti akter: `OWNER` daje samo `OWNER`, ostalo svako sa `users.manage`. */
export function assignableRoles(actorRoles: readonly string[]): Role[] {
  const isOwner = actorRoles.includes("OWNER");
  return ROLES.filter((role) => role !== "OWNER" || isOwner);
}

/** Role koje osoba smije mijenjati: nikad OWNER (ako nije vlasnik), nikad samu sebe. */
export function canManageUser(
  actor: { userId: string; roles: readonly string[] },
  target: { userId: string; roles: readonly string[] },
): boolean {
  if (!can(actor.roles, "users.manage")) return false;
  if (actor.userId === target.userId) return false;
  if (target.roles.includes("OWNER")) return actor.roles.includes("OWNER");
  return true;
}
