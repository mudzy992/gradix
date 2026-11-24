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
  // C.1 (odobren dizajn, 2026-11-12): početni pregled „šta moram danas uraditi?“.
  // WORKER, DRIVER i ostali ostaju na postojećem pregledu — zato ova dozvola postoji:
  // da granica između starog i novog ekrana bude podatak (matrica, test), ne `if` u stranici.
  "pregled.view": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR"],
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
  /*
   * F2: potvrda dokumenta (§17). Odvojeno od `obligations.manage` jer je odgovornost, ne unos:
   * šef gradilišta potvrđuje da je vidio nalaz, ali ne mijenja tipove ni tuđe obaveze.
   * `rejected` mora imati razlog — to je jedina „negativna“ radnja u modulu.
   */
  "obligations.review": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR"],
  /*
   * F2: upravljanje PRILOZIMA uz obavezu (§27–29). Uže od `obligations.manage`: dodavanje i
   * uklanjanje skenova je lični podatak, pa ga ne dobija svako ko smije unijeti obavezu.
   */
  "obligations.attachments.manage": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR"],
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
  // R4a-2: razrješenje sukoba je odvojeno od pregleda — ACCOUNTANT vidi, ne razrješava.
  // Strana u sukobu ne razrješava vlastiti sukob (workday-review.canResolveConflict).
  "workdays.resolve": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR"],
  // R4b (ODOBREN): potvrda / sedmica / zaključavanje / revizija — bez UI ekrana u ovom rezu.
  "workdays.confirm": ["SITE_SUPERVISOR"],
  "workdays.week_decide": ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  "workdays.lock": ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  "workdays.revise": ["OWNER", "ADMIN"],
  // R5.1: sati mašine — ured lista, mobilni unos, revizija.
  "machines.work_log.view": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "ACCOUNTANT", "MACHINE_OPERATOR"],
  "machines.work_log.create": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "MACHINE_OPERATOR"],
  "machines.work_log.revise": ["OWNER", "ADMIN"],
  // R5.2: gorivo — vozač/rukovatil unos; cijena u API samo uredskim rolama (fuel-entry-price.ts).
  "machines.fuel.view": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "ACCOUNTANT", "DRIVER", "MACHINE_OPERATOR"],
  "machines.fuel.create": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "DRIVER", "MACHINE_OPERATOR"],
  "machines.fuel.revise": ["OWNER", "ADMIN"],
  // R5.3: ture — vozač unos; ured (PM/OWNER/ADMIN) mutate; ACCOUNTANT+SS read-only.
  "machines.haul.view": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "ACCOUNTANT", "DRIVER"],
  "machines.haul.create": ["OWNER", "ADMIN", "PROJECT_MANAGER", "DRIVER"],
  "machines.haul.revise": ["OWNER", "ADMIN"],
  // R5.4: dnevni pregled — OPERATOR/MECHANIC + ured; ACCOUNTANT view RO.
  "machines.check.view": [
    "OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "ACCOUNTANT", "MACHINE_OPERATOR", "MECHANIC",
  ],
  "machines.check.create": [
    "OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "MACHINE_OPERATOR", "MECHANIC",
  ],
  "machines.check.revise": [
    "OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "MACHINE_OPERATOR", "MECHANIC",
  ],
  // R5.5: kvarovi — OPERATOR/MECHANIC/SS/PM + ured; approve samo OWNER/ADMIN; ACCOUNTANT view RO.
  "machines.fault.view": [
    "OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "ACCOUNTANT", "MACHINE_OPERATOR", "MECHANIC",
  ],
  "machines.fault.create": [
    "OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "MACHINE_OPERATOR", "MECHANIC",
  ],
  "machines.fault.revise": [
    "OWNER", "ADMIN", "PROJECT_MANAGER", "MECHANIC",
  ],
  "machines.fault.approve": ["OWNER", "ADMIN"],
  "partners.view": [
    "OWNER", "ADMIN", "PROJECT_MANAGER", "MECHANIC",
  ],
  "partners.manage": ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  // R7: tenderi (v1 matrica) + convert.
  "tenders.view": ["OWNER", "ADMIN", "PROJECT_MANAGER", "ACCOUNTANT"],
  "tenders.manage": ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  "tenders.convert": ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  // R6.1: stope €/h i knjiženje na projekat — ACCOUNTANT/SS view; book/manage bez ACCOUNTANT.
  "machines.cost_rate.view": [
    "OWNER", "ADMIN", "PROJECT_MANAGER", "ACCOUNTANT", "SITE_SUPERVISOR",
  ],
  "machines.cost_rate.manage": ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  "projects.costs.view": ["OWNER", "ADMIN", "PROJECT_MANAGER", "ACCOUNTANT"],
  "projects.costs.book": ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  // R6.2: CSV obračun sati + dashboard agregati (G0: sati, ne puna plata).
  "payroll.hours.export": ["OWNER", "ADMIN", "PROJECT_MANAGER", "ACCOUNTANT"],
  "dashboard.view": ["OWNER", "ADMIN", "PROJECT_MANAGER", "ACCOUNTANT"],
  /*
   * F1 (spec 01 §3): postavke firme.
   *
   * `view` je širi od `manage` jer radno vrijeme i praznike moraju VIDJETI svi koji planiraju
   * — PM i računovođa rade obračun i raspored. Mijenja ih samo vlasnik/admin: prag prekovremenog
   * i noćni prozor mijenjaju zaradu, pa to nije stvar koja se „usput“ prepravlja.
   */
  "company.settings.view": ["OWNER", "ADMIN", "PROJECT_MANAGER", "ACCOUNTANT"],
  "company.settings.manage": ["OWNER", "ADMIN"],
  "company.holidays.manage": ["OWNER", "ADMIN"],
  // Red obavještenja (neuspjeli email/push, „ponovi“) — ured, ne svaki korisnik.
  "notifications.manage": ["OWNER", "ADMIN"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

/** Opis za matricu — isti tekst u UI-u i u testu koji provjerava da nije prazan. */
export const PERMISSION_INFO: Record<Permission, { label: string; description: string }> = {
  "pregled.view": {
    label: "Početni pregled (šta traži pažnju)",
    description:
      "Početni ekran nakon prijave: istekli rokovi, nerazriješeni sukobi, dani za provjeru, blokirane dodjele i stanje sinhronizacije. Vlasnik i admin vide cijelu firmu i sinhronizaciju; vođa projekta i šef samo svoj opseg, bez sinhronizacije. Radnik, vozač i ostali ostaju na starom pregledu.",
  },
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
  "obligations.review": {
    label: "Potvrda dokumenata rokova",
    description:
      "Potvrđivanje ili odbijanje dokumenta koji čeka provjeru, uz obavezan razlog kod odbijanja.",
  },
  "obligations.attachments.manage": {
    label: "Upravljanje prilozima rokova",
    description: "Dodavanje i uklanjanje skenova uz obavezu (prilog je lični podatak).",
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
  "workdays.resolve": {
    label: "Razrješenje sukoba radnih dana",
    description: "Odluka o sukobu server/telefon unosa: prihvati jedan, ispravi vremena ili odbaci uz razlog koji autor vidi. Vlasnik/admin cijela firma; vođa projekta i šef samo svoj opseg. Strana u sukobu ne razrješava vlastiti sukob.",
  },
  "workdays.confirm": {
    label: "Potvrda radnog dana (šef)",
    description: "Šef potvrđuje predani dan u svom R3 opsegu (samo web, online). Blokirano uz otvoren sukob ili otvoren segment.",
  },
  "workdays.week_decide": {
    label: "Odobrenje ili odbijanje sedmice",
    description: "Vlasnik, admin ili vođa projekta odobrava/odbija sedmicu (pon–ned) uz razlog pri odbijanju.",
  },
  "workdays.lock": {
    label: "Zaključavanje sedmice",
    description: "Zaključava odobrenu sedmicu; ista uloga kao odobravanje. Poslije toga sync unosa je odbijen.",
  },
  "workdays.revise": {
    label: "Ispravka (revizija) poslije potvrde",
    description: "Vlasnik/admin upisuje reviziju s razlogom; ne prepisuje LOCKED original.",
  },
  "machines.work_log.view": {
    label: "Pregled sati mašine",
    description: "Lista radnih sati mašina — samo pregled. Računovođa vidi sve, rukovalac samo svoje.",
  },
  "machines.work_log.create": {
    label: "Unos sati mašine",
    description: "Novi zapis radnih sati mašine uz očitanje brojila. Rukovalac unosi vlastite sate.",
  },
  "machines.work_log.revise": {
    label: "Ispravka sati mašine",
    description: "Vlasnik/admin upisuje reviziju sati mašine s razlogom; original ostaje nepromijenjen.",
  },
  "machines.fuel.view": {
    label: "Pregled goriva",
    description: "Točenja goriva po mašini. Računovođa vidi cijenu; vozač vidi litre, ne cijenu.",
  },
  "machines.fuel.create": {
    label: "Unos goriva",
    description: "Novo točenje uz mašinu, litre i po želji očitanje brojila.",
  },
  "machines.fuel.revise": {
    label: "Ispravka točenja goriva",
    description: "Vlasnik/admin upisuje reviziju s razlogom; original ostaje nepromijenjen.",
  },
  "machines.haul.view": {
    label: "Pregled tura",
    description: "Ture po mašini i vozaču — samo pregled. Računovođa i šef vide listu bez unosa.",
  },
  "machines.haul.create": {
    label: "Unos ture",
    description: "Nova tura uz polazište, odredište, materijal, količinu i broj tura.",
  },
  "machines.haul.revise": {
    label: "Ispravka ture",
    description: "Vlasnik/admin upisuje reviziju s razlogom; original ostaje nepromijenjen.",
  },
  "machines.check.view": {
    label: "Pregled dnevnih pregleda",
    description: "Dnevni pregledi mašina — samo pregled. Računovođa vidi listu bez unosa.",
  },
  "machines.check.create": {
    label: "Unos dnevnog pregleda",
    description: "Novi dnevni pregled uz ishod (PASS/FAIL/CONDITIONAL) i napomenu.",
  },
  "machines.check.revise": {
    label: "Ispravka dnevnog pregleda",
    description: "Ispravka s razlogom; original ostaje nepromijenjen (append-only revizija).",
  },
  "machines.fault.view": {
    label: "Pregled kvarova",
    description: "Kvarovi mašina — samo pregled. Računovođa vidi listu i procijenjeni trošak.",
  },
  "machines.fault.create": {
    label: "Prijava kvara",
    description: "Nova prijava kvara uz prioritet i opcionalni procijenjeni trošak.",
  },
  "machines.fault.revise": {
    label: "Ispravka kvara",
    description: "Ispravka s razlogom; original ostaje u reviziji (append-only).",
  },
  "machines.fault.approve": {
    label: "Odobrenje troška kvara",
    description: "Vlasnik/admin odobrava ili odbija trošak iznad praga.",
  },
  "partners.view": {
    label: "Pregled partnera",
    description: "Vanjski servisi i dobavljači za kvarove — samo pregled.",
  },
  "partners.manage": {
    label: "Upravljanje partnerima",
    description: "Unos i ažuriranje partnera (naručilac/servis/dobavljač).",
  },
  "tenders.view": {
    label: "Pregled tendera",
    description: "Lista i detalj tendera, status i naručilac.",
  },
  "tenders.manage": {
    label: "Upravljanje tenderima",
    description: "Unos tendera, prilozi i promjena statusa po matrici.",
  },
  "tenders.convert": {
    label: "Konverzija tendera u projekat",
    description: "Jednim klikom pretvara dobijeni tender u projekat (atomski).",
  },
  "machines.cost_rate.view": {
    label: "Pregled stope troška mašine",
    description: "Cijena po satu rada mašine (Money) — samo pregled.",
  },
  "machines.cost_rate.manage": {
    label: "Upravljanje stopom troška mašine",
    description: "Unos i izmjena stope (€/h ili BAM/h) s periodom važenja.",
  },
  "projects.costs.view": {
    label: "Pregled troškova projekta",
    description: "Knjiženja troška sati mašine na projekat — samo pregled.",
  },
  "projects.costs.book": {
    label: "Knjiženje troška na projekat",
    description: "Knjiži sati mašine × stopa na projekat (idempotentno po izvoru).",
  },
  "payroll.hours.export": {
    label: "Izvoz sati za obračun",
    description: "CSV izvoz zaključenih i potvrđenih radničkih sati (LOCKED/CONFIRMED) za period.",
  },
  "dashboard.view": {
    label: "Dashboard agregati",
    description: "Na pregledu: aktivni projekti, zbir knjiženih troškova i sati u tekućem mjesecu.",
  },
  "company.settings.view": {
    label: "Pregled postavki firme",
    description:
      "Podaci firme, radno vrijeme, praznici, pragovi i pravila. Radno vrijeme i praznici su vidljivi svima koji planiraju ili računaju.",
  },
  "company.settings.manage": {
    label: "Upravljanje postavkama firme",
    description:
      "Izmjena podataka firme, radnog vremena, noćnog prozora, pragova odobrenja i pravila. Svaka izmjena ide u audit.",
  },
  "company.holidays.manage": {
    label: "Upravljanje praznicima",
    description:
      "Praznici i prenesene radne subote. Bez ovoga obračun sati ne zna da je subota bila radna.",
  },
  "notifications.manage": {
    label: "Upravljanje redom obavještenja",
    description: "Pregled neuspjelih email/push isporuka i ponovni pokušaj slanja.",
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
