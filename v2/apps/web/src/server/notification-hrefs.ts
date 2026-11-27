/**
 * Putanje koje `notify()` smije upisati u obavještenje.
 *
 * Zašto konstanta, a ne string na mjestu poziva: `href` je OBAVEZAN (`LIKE '/%'`) i inbox ga
 * renderuje kao `<Link>`. Next taj link i prefetchuje, pa nepostojeća putanja nije „mrtav link
 * u kutiji" nego 404 u konzoli SVAKOG ekrana te role — i tako je F3 oborio smoke test: razrješenje
 * sukoba pisalo je `href: "/moj-dan"`, a `/moj-dan` postoji samo u mobilnoj aplikaciji. Web nema
 * taj ekran, pa je radnik na `/ured/obavjestenja` dobijao 404 pri svakom otvaranju inboxa.
 *
 * Pravilo koje test (`notification-hrefs.test.ts`) drži:
 *   1. putanja MORA imati `page.tsx` u `src/app` (nema linkova na ekrane koji ne postoje u webu);
 *   2. stranica NE SMIJE imati `redirect("/nemate-pristup")` — primaoc obavještenja može biti
 *      bilo koja rola, pa link mora otvoriti svako kome poruka stigne.
 *
 * Kad ekran postoji samo na telefonu (npr. „Moj dan"), web obavještenje vodi na ekran koji ta
 * rola zaista ima — bolje pošten pregled nego 404.
 */
export const NOTIFICATION_HREFS = {
  /**
   * Razrješenje sukoba radnog dana (spec 03 §1.6.31). Primaoc je radnik, a radnik na webu ima
   * samo pregled, rokove, projekte i inbox — ekran „Moj dan" je mobilni. Zato pregled: on je
   * jedina web stranica koju svaka rola otvara.
   */
  workdayConflictResolved: "/pregled",
  /** Report job notice lands on an existing page until reports UI is implemented. */
  reportJobReady: "/pregled",
} as const;
