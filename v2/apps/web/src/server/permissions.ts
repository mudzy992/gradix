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
  // R2b. Rokovi su ono zbog čega aplikacija postoji u pilotu, pa ih vidi i rukovalac/mehaničar:
  // bolje da vidi da mu ljekarski istječe nego da sazna na gradilištu. Mijenja ih ured.
  "obligations.view": [
    "OWNER",
    "ADMIN",
    "PROJECT_MANAGER",
    "SITE_SUPERVISOR",
    "MACHINE_OPERATOR",
    "MECHANIC",
    "ACCOUNTANT",
    /*
     * G3 (odluka vlasnika, 2026-11-09): radnik vidi SVOJE rokove, i to samo svoje.
     *
     * Bez ovoga telefon radniku ne pokaže ni jedan rok — a rokove i gleda baš onaj kome istječu.
     * Dozvola je data, ali sa TRI ograničenja koja se provjeravaju na serveru, ne u UI-u:
     *   1. samo obaveze vezane za taj nalog (`SELF` opseg) — tuđe ne vidi ni uz `?workerId=`,
     *   2. prilozi (skenovi, ljekarski nalazi) se radniku NE prikazuju — vidi tip, rok i stanje,
     *   3. ruta za preuzimanje priloga mu je zatvorena, jer link vodi u medicinski dokument.
     */
    "WORKER",
    "DRIVER",
  ],
  "obligations.manage": ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  /*
   * Prilozi uz obavezu (skenovi, ljekarski nalazi) — POSEBNA dozvola, uža od `obligations.view`.
   *
   * Radnik ima `obligations.view` (vidi da mu ljekarski istječe), ali ne i ovo: medicinski nalaz je
   * lični podatak, a ne informacija koju treba da vidi na telefonu pred kolegama. Zato sve rute koje
   * dotiču SADRŽAJ priloga traže ovu dozvolu, a ne `obligations.view`.
   */
  "obligations.attachments.view": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "ACCOUNTANT"],
  // R3. `projects.view` je široko — radnik mora znati na kojem je projektu. Pravo i dodjele ljudi
  // su odvojeni svjesno: `projects.assign` je NOVA dozvola, ne dio `users.manage` (odluka vlasnika
  // iz R1b, preseljena u R3). Mijenjanje role i dodjela projekta su dvije različite radnje.
  "projects.view": [
    "OWNER",
    "ADMIN",
    "PROJECT_MANAGER",
    "SITE_SUPERVISOR",
    "WORKER",
    "DRIVER",
    "MACHINE_OPERATOR",
    "MECHANIC",
    "ACCOUNTANT",
  ],
  "projects.manage": ["OWNER", "ADMIN"],
  "projects.assign": ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  /*
   * R3 (odluka vlasnika, 2026-11-09): iznimka od blokade je POSEBNO pravo.
   *
   * Zašto odvojeno od `projects.assign`: dodjela je raspoređivanje ljudi, a iznimka je odobrenje da
   * čovjek radi sa ISTEKLIM dokumentom. Rukovodilac projekta (PM) raspoređuje svaki dan; ako bi
   * iznimka išla s dodjelom, pravilo iz B5.4 ne bi štitilo ni od koga — svako ko dodjeljuje bi ga
   * mogao ugasiti. PM zato može ZATRAŽITI iznimku (polje u formi), ali je odobrava samo vlasnik ili
   * admin.
   */
  "projects.override": ["OWNER", "ADMIN"],
  "workers.view": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR"],
  "workers.manage": ["OWNER", "ADMIN"],
  "equipment.view": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "MACHINE_OPERATOR", "MECHANIC"],
  // `equipment.manage` uključuje ispravku brojila (namjerno ne za rukovaoca: on unosi novo
  // stanje, ali ne prepisuje staro — to je posao ureda).
  "equipment.manage": ["OWNER", "ADMIN"],
  // Step 7 + A (2026-11-07): uredski pregled radnih dana. Stranica je prije živjela izvan
  // matrice (ručni OWNER/ADMIN uslov u page.tsx) pa nije ušla u navigaciju — matrica je
  // jedini izvor i za meni i za stranicu.
  // A2: PM i šef vide samo radnike/projekte iz svog R3 opsega, ACCOUNTANT cijelu firmu
  // (samo čitanje) — opseg provodi server (workday-review), ne meni.
  "workdays.view": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "ACCOUNTANT"],
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
  "obligations.view": {
    label: "Pregled rokova",
    description: "Obaveze, rokovi i stanje (isteklo / uskoro istječe / važeće) — bez izmjena.",
  },
  "obligations.attachments.view": {
    label: "Pregled priloga rokova",
    description:
      "Otvara skenove i nalaze uz obavezu. Radnik vidi svoj rok, ali ne i sam dokument — nalaz je lični podatak.",
  },
  "obligations.manage": {
    label: "Upravljanje rokovima",
    description: "Nove obaveze, obnova, ispravke, tipovi obaveza i prilozi.",
  },
  "projects.view": {
    label: "Pregled projekata",
    description: "Lista projekata, lokacija, tim i rokovi na projektu — bez izmjena.",
  },
  "projects.manage": {
    label: "Upravljanje projektima",
    description: "Novi projekti, izmjena naziva, statusa, perioda i rukovodioca.",
  },
  "projects.override": {
    label: "Odobravanje iznimke od blokade",
    description:
      "Dopušta dodjelu uprkos isteklom dokumentu, uz obavezan razlog i rok. Bez ovog prava se iznimka može zatražiti, ali ne odobriti.",
  },
  "projects.assign": {
    label: "Dodjela na projekte",
    description:
      "Dodjela radnika i mašina na projekat, uz iznimku od blokade zbog istekle obaveze. Odvojeno od upravljanja korisnicima.",
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
  "workdays.view": {
    label: "Pregled radnih dana",
    description: "Radni dani sa terena — samo pregled, uz oznake „Za provjeru“. Vlasnik/admin i računovođa vide cijelu firmu; vođa projekta i šef samo svoj R3 opseg.",
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
