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
  /*
   * F5/Korak 0 (odluka vlasnika): šef gradilišta mijenja STATUS zadatka i piše komentare na
   * projektima na koje je raspoređen, ali NE mijenja naslov, izvršioca ni projekt zadatka.
   *
   * Zašto odvojeno od `projects.manage`: potonje je „ured" — vlasnik i admin. Ako bi šef dobio
   * `projects.manage`, dobio bi i pravo da preusmjeri tuđi zadatak na drugoga. Status je jedina
   * radnja koju šef radi svaki dan na terenu, pa je dobija kao POSEBNO pravo; servis uz to
   * provjerava dodjelu na projekat (opseg `PROJECTS`), ne samo rolu.
   */
  "tasks.update_status": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR"],
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
  /*
   * F3: osjetljivi podaci radnika (datum rođenja, adresa, krvna grupa, hitni kontakt).
   * Samo vlasnik i admin (spec 04 §1.1.4); svako čitanje upisuje ACCESS audit.
   * Zašto nije uz `workers.view`: šef gradilišta treba listu i kontakt za posao, ali krvna
   * grupa i adresa stanovanja nisu podaci za gradilište.
   */
  "workers.sensitive.view": ["OWNER", "ADMIN"],
  /*
   * F3: satnice. `PM` i šef gradilišta ih NE vide (spec 04 §1.2.10) — ne zato što bi ih
   * zloupotrijebili, nego zato što plata kolege nije podatak za gradilište. Mijenja samo
   * vlasnik/admin; računovođa čita jer pravi obračun.
   */
  "workers.rates.view": ["OWNER", "ADMIN", "ACCOUNTANT"],
  "workers.rates.manage": ["OWNER", "ADMIN"],
  "workers.leave.view": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "ACCOUNTANT"],
  "workers.leave.manage": ["OWNER", "ADMIN"],
  "workers.issuances.view": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR"],
  "workers.issuances.manage": ["OWNER", "ADMIN", "SITE_SUPERVISOR"],
  /*
   * F3: promjena vrste dana (izostanak). Šef unosi izostanak jednim klikom za svoju ekipu —
   * čekati ured bi značilo da se izostanak upiše danima kasnije ili nikad.
   */
  "workdays.kind": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR"],
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
  /*
   * F8 (Modul 6/9): servis i održavanje (spec 09 §3).
   *
   * `service.view` je široko: šef gradilišta mora znati zbog čega mašina stoji, a mehaničar bez
   * njega ne vidi ni svoj red čekanja. `service.manage` je rad u radionici — mehaničar mijenja
   * stanje naloga, upisuje sate i dijelove; ured ga dobija jer izdaje naloge i zove vanjski servis.
   * `service.approve` je DRUGI par očiju za trošak iznad praga firme — nikad mehaničar koji je
   * taj trošak i napravio.
   */
  "service.view": [
    "OWNER",
    "ADMIN",
    "PROJECT_MANAGER",
    "SITE_SUPERVISOR",
    "MECHANIC",
    "ACCOUNTANT",
  ],
  "service.manage": ["OWNER", "ADMIN", "PROJECT_MANAGER", "MECHANIC"],
  "service.approve": ["OWNER", "ADMIN"],
  /*
   * Zalihe dijelova (F8 §1.3). Računovođa vidi stanje i vrijednost zaliha (to ulazi u trošak),
   * ali ne izdaje dijelove; mehaničar izdaje i prima, jer on jedini zna šta je utrošeno.
   */
  "stock.view": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "MECHANIC", "ACCOUNTANT"],
  "stock.manage": ["OWNER", "ADMIN", "SITE_SUPERVISOR", "MECHANIC"],
  /*
   * F9 — dnevnik građenja. `view` je širi od `manage`: dnevnik čita i računovodstvo (količine idu
   * u trošak i u obračun) i PM (napredak projekta). `manage` je unos i izmjena nacrta, a `sign`
   * je POTPIS — namjerno uži od `manage`: potpisuje šef gradilišta, jer je on taj koji odgovara
   * za sadržaj. Ko može unijeti, ne mora moći i potpisati.
   */
  "diary.view": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "ACCOUNTANT"],
  "diary.manage": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR"],
  "diary.sign": ["OWNER", "ADMIN", "SITE_SUPERVISOR"],
  /*
   * F9 — HSE. `hse.view` je široko (PM, šef, mehaničar, rukovalac): svi moraju znati gdje je
   * zabrana rada i koje mjere kasne. `hse.report` je PRAVO, ne privilegija — svaki radnik može
   * prijaviti incident; sistem koji traži dozvolu za prijavu opasnosti je sistem koji gubi prijave.
   * `hse.investigate` vodi istragu i zatvara mjere; `hse.training.manage` evidentira obuke.
   */
  "hse.view": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "MACHINE_OPERATOR", "MECHANIC", "DRIVER", "WORKER"],
  "hse.report": [
    "OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "MACHINE_OPERATOR", "MECHANIC", "DRIVER", "WORKER",
  ],
  "hse.investigate": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR"],
  "hse.training.view": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR"],
  "hse.training.manage": ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR"],
  "partners.view": [
    "OWNER", "ADMIN", "PROJECT_MANAGER", "MECHANIC",
  ],
  "partners.manage": ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  // R7: tenderi (v1 matrica) + convert.
  "tenders.view": ["OWNER", "ADMIN", "PROJECT_MANAGER", "ACCOUNTANT"],
  "tenders.manage": ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  "tenders.convert": ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  /*
   * F7 (spec 08 §1.7): tri nove dozvole, namjerno odvojene od `.manage`.
   *  - `tenders.price.manage` vidi i mijenja KALKULACIJU (trošak, marža, revizije). ACCOUNTANT
   *    vidi ponuđenu vrijednost i ishod, ali ne trošak i maržu — isto pravilo kao satnice u
   *    Modulu 4. Zato ovo nije `tenders.view`.
   *  - `tenders.price.approve` je DRUGI par očiju: cijena iznad praga (5 %) ili ispod minimalne
   *    marže traži vlasnika/administratora. PM predlaže, ali ne odobrava sam sebi.
   *  - `tenders.outcome.manage` piše ishod (razlog gubitka, pobjednika, rang) — to je podatak
   *    po kojem se odlučuje o budućim ponudama, pa ga ne mijenja svako ko mijenja tender.
   */
  "tenders.price.manage": ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  "tenders.price.approve": ["OWNER", "ADMIN"],
  "tenders.outcome.manage": ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  // R6.1: stope €/h i knjiženje na projekat — ACCOUNTANT/SS view; book/manage bez ACCOUNTANT.
  "machines.cost_rate.view": [
    "OWNER", "ADMIN", "PROJECT_MANAGER", "ACCOUNTANT", "SITE_SUPERVISOR",
  ],
  "machines.cost_rate.manage": ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  /*
   * F4 (Modul 5 §3): tri nove dozvole. Zašto odvojene od `.create`/`.view`:
   *  - `machines.fuel.manage` mijenja ŠIFARNIK cijena i cisterne — to nije terenski unos nego
   *    podatak po kojem se sva točenja obračunavaju, pa ga drži ured;
   *  - `machines.check.manage` mijenja ŠABLON pregleda; rukovalac popunjava pregled, ali ne
   *    odlučuje šta se provjerava (inače bi šablon mogao „proglasiti" kritičnu stavku nekritičnom);
   *  - `machines.haul.manage` mijenja šifarnik dionica sa stacionažom; vozač unosi turu, ali ne
   *    prepisuje kilometražu od koje zavisi izvedena količina.
   */
  "machines.fuel.manage": ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  "machines.check.manage": ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  "machines.haul.manage": ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  "projects.costs.view": ["OWNER", "ADMIN", "PROJECT_MANAGER", "ACCOUNTANT"],
  "projects.costs.book": ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  /*
   * F5 (spec 06 §3): dvije nove dozvole, namjerno odvojene od `.book`.
   *  - `projects.costs.manage` mijenja ŠIFARNIK kategorija i mapiranje izvor → kategorija. To
   *    nije unos troška, nego pravilo po kojem se svi budući troškovi razvrstavaju — mijenja ga
   *    ured (PM), a računovođa ga samo čita;
   *  - `projects.budget.manage` piše NOVU reviziju budžeta. Budžet je odluka (spec 06 §1.5.22),
   *    pa ga ne mijenja svako ko smije knjižiti trošak — inače bi prag 80 % bio podesiv unazad.
   */
  "projects.costs.manage": ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  "projects.budget.manage": ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  // R6.2: CSV obračun sati + dashboard agregati (G0: sati, ne puna plata).
  "payroll.hours.export": ["OWNER", "ADMIN", "PROJECT_MANAGER", "ACCOUNTANT"],
  /*
   * F6 (Modul 7): obračun kao mjesečna cjelina.
   *
   * `view`/`manage`/`approve` su SAMO ured i računovodstvo — PM i šef vide sate (`payroll.hours.
   * export`), ali nikad iznose (§1.8/29). Zato plata nije „još jedna dozvola projekta“: projekat
   * vidi mnogo ljudi, a iznos zarade samo onaj koji za nju odgovara.
   *
   * `approve` je odvojen od `manage` jer izračun i odobrenje nisu isti čin: izračun je obrada,
   * odobrenje je potpis. `SELF_APPROVAL_FORBIDDEN` (u servisu) dodatno brani da potpisnik bude
   * osoba iz obračuna — dozvola ne smije značiti „pa ti si vlasnik, možeš i svoj“.
   */
  "payroll.view": ["OWNER", "ADMIN", "ACCOUNTANT"],
  "payroll.manage": ["OWNER", "ADMIN", "ACCOUNTANT"],
  "payroll.approve": ["OWNER", "ADMIN", "ACCOUNTANT"],
  /*
   * Vlastiti obračun: svako vidi SVOJE sate. Dozvola je namjerno data svim rolama jer radnik bez
   * nje ne bi mogao provjeriti svoj mjesec — a upravo ta provjera je smisao `Moj obračun`.
   * Servis uz nju uvijek veže radnika na nalog (`workers.user_id`); tuđi ID se ne prima.
   */
  "payroll.own.view": [
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
  "tasks.update_status": {
    label: "Status zadatka",
    description:
      "Prelazak statusa zadatka i komentari na projektima na koje je osoba raspoređena — bez izmjene naslova, izvršioca i projekta.",
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
  "workers.sensitive.view": {
    label: "Osjetljivi podaci radnika",
    description:
      "Datum rođenja, adresa, krvna grupa i hitni kontakt. Svako čitanje ide u audit (klasa ACCESS).",
  },
  "workers.rates.view": {
    label: "Pregled satnica",
    description: "Istorija satnica i koeficijenata. Vođa projekta i šef gradilišta ih ne vide.",
  },
  "workers.rates.manage": {
    label: "Izmjena satnica",
    description: "Nova stopa kao novi red; iznos postojeće se ne prepisuje.",
  },
  "workers.leave.view": {
    label: "Pregled godišnjeg",
    description: "Pravo po godini i saldo izostanaka (korištenje se računa iz radnih dana).",
  },
  "workers.leave.manage": {
    label: "Upravljanje godišnjim",
    description: "Pravo i prenos po godini za radnike.",
  },
  "workers.issuances.view": {
    label: "Pregled zaduženja",
    description: "OZO, alat i uređaji kod radnika — aktivna zaduženja i povijest.",
  },
  "workers.issuances.manage": {
    label: "Izdavanje i povrat",
    description: "Zaduženje OZO/alata/uređaja i povrat; OZO set jednim klikom.",
  },
  "equipment.view": {
    label: "Pregled mašina",
    description: "Lista mašina i vozila, kategorije i stanje brojila — bez izmjena.",
  },
  "equipment.manage": {
    label: "Upravljanje mašinama",
    description: "Mašine, kategorije, brojilo i ispravke brojila.",
  },
  "workdays.kind": {
    label: "Vrsta dana i izostanci",
    description:
      "Izostanak, godišnji, bolovanje i praznik jednim klikom; dan sa izostankom ne nosi sate.",
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
  "service.view": {
    label: "Pregled servisa i održavanja",
    description:
      "Red čekanja radionice, naloge, planove preventivnog održavanja, zalihe dijelova i pouzdanost mašine (MTBF/MTTR).",
  },
  "service.manage": {
    label: "Rad na servisnom nalogu",
    description:
      "Izdaje naloge, mijenja stanje (u radu, čeka dijelove, završeno), upisuje sate mehaničara, dijelove i vanjski trošak.",
  },
  "service.approve": {
    label: "Odobrenje servisnog naloga",
    description:
      "Odobrava ili odbija nalog čiji je predračun iznad praga firme; vanjski servis iznad praga traži i ponudu.",
  },
  "stock.view": {
    label: "Pregled zaliha dijelova",
    description: "Artikli, stanje iz kretnji i upozorenje na minimum — bez izdavanja i primanja.",
  },
  "diary.view": {
    label: "Pregled dnevnika građenja",
    description:
      "Dnevnik po projektu i danu: automatski povučeni radnici, mašine i ture, ručni opis radova, zastoji, potpis i PDF izvoz.",
  },
  "diary.manage": {
    label: "Unos dnevnika građenja",
    description:
      "Otvara dan, unosi vrijeme, opis radova, količine, posjetioce, događaje i zastoje; mijenja nacrt i pokreće reviziju zaključanog dnevnika.",
  },
  "diary.sign": {
    label: "Potpis dnevnika",
    description: "Potpisuje dnevnik (SIGNED) i zaključava ga (LOCKED); poslije toga sadržaj se mijenja samo kroz reviziju sa razlogom.",
  },
  "hse.view": {
    label: "Pregled HSE",
    description: "Incidenti, inspekcije, mjere sa rokovima, obuke i statistika (LTIFR, izgubljeni dani, mjere na vrijeme).",
  },
  "hse.report": {
    label: "Prijava incidenta",
    description:
      "Prijava incidenta ili neposredne opasnosti (NEAR_MISS) sa telefona i weba, offline. Pravo je svakog radnika, ne privilegija.",
  },
  "hse.investigate": {
    label: "Istraga i mjere",
    description: "Vodi istragu incidenta, otvara i zatvara korektivne mjere, evidentira inspekcije i nalaze.",
  },
  "hse.training.view": {
    label: "Pregled obuka",
    description: "Održane obuke, toolbox razgovori i prisustvo sa potpisima.",
  },
  "hse.training.manage": {
    label: "Evidencija obuka",
    description: "Unosi obuke i toolbox razgovore sa prisutnima i potpisima; obnavlja certifikacijsku obavezu iz Modula 2.",
  },
  "stock.manage": {
    label: "Kretanje zaliha",
    description: "Unos artikala, primanje i izdavanje dijelova te popis. Stanje je uvijek zbir kretnji.",
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
  "tenders.price.manage": {
    label: "Kalkulacija ponude tendera",
    description:
      "Predmjer, resursi, marža i revizije cijene. Računovođa vidi vrijednost ponude, ali ne trošak i maržu.",
  },
  "tenders.price.approve": {
    label: "Odobrenje cijene ponude",
    description:
      "Odobrava reviziju cijene iznad 5 % promjene ili ispod minimalne marže firme — drugi par očiju.",
  },
  "tenders.outcome.manage": {
    label: "Ishod tendera",
    description: "Upis ishoda: rezultat, razlog gubitka, pobjednik, rang i broj ponuda.",
  },
  "machines.cost_rate.view": {
    label: "Pregled stope troška mašine",
    description: "Cijena po satu rada mašine (Money) — samo pregled.",
  },
  "machines.cost_rate.manage": {
    label: "Upravljanje stopom troška mašine",
    description: "Komponente stope (depresijacija, servis, operater…) i ručna stopa s razlogom.",
  },
  "machines.fuel.manage": {
    label: "Šifarnik cijena goriva i cisterne",
    description:
      "Cijena po litru po datumu i vrstama goriva, te cisterne. Po tome se predlaže cijena pri točenju.",
  },
  "machines.check.manage": {
    label: "Šabloni dnevnog pregleda",
    description:
      "Stavke pregleda po kategoriji mašine i koje su kritične. Kritična stavka traži fotografiju i otvara kvar.",
  },
  "machines.haul.manage": {
    label: "Šifarnik dionica",
    description: "Dionice sa stacionažom (km + m). Zbir po dionici daje izvedene količine.",
  },
  "projects.costs.view": {
    label: "Pregled troškova projekta",
    description: "Knjiženja troška sati mašine na projekat — samo pregled.",
  },
  "projects.costs.book": {
    label: "Knjiženje troška na projekat",
    description:
      "Ručni trošak sa gradilišta i storno. Ostali izvori (dan rada, sati mašine, gorivo, tura, servis) knjiže se automatski na promjenu statusa izvora, bez dugmeta.",
  },
  "projects.costs.manage": {
    label: "Šifarnik kategorija troška",
    description:
      "Kategorije troška firme i mapiranje izvora na kategoriju. Izvor bez mapiranja ide na „Ostalo“.",
  },
  "projects.budget.manage": {
    label: "Budžet projekta",
    description:
      "Nova revizija budžeta po kategoriji i fazi. Budžet se nikad ne prepisuje — stara revizija ostaje čitljiva, a pragovi se prate po reviziji.",
  },
  "payroll.hours.export": {
    label: "Izvoz sati za obračun",
    description: "CSV izvoz zaključenih i potvrđenih radničkih sati (LOCKED/CONFIRMED) za period.",
  },
  "payroll.view": {
    label: "Pregled obračuna",
    description:
      "Mjesečni periodi obračuna, linije po radniku i raspis (koji su dani i parametri ušli u iznos). Sadrži iznose zarada.",
  },
  "payroll.manage": {
    label: "Obračun i šifarnik",
    description:
      "Izračun perioda, komponente i parametri sa datumom važenja, akontacije i pozajmice. Ne odobrava i ne zaključava.",
  },
  "payroll.approve": {
    label: "Odobrenje i zaključavanje obračuna",
    description:
      "Odobrenje izračunatog perioda i zaključavanje poslije isplate. Niko ne odobrava obračun u kojem je sam.",
  },
  "payroll.own.view": {
    label: "Moj obračun",
    description:
      "Vlastiti sati po danu i vlastite linije obračuna kad je period odobren ili zaključan. Tuđe se ne vidi nikad.",
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
