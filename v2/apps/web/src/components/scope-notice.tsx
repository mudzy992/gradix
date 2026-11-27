import { Alert } from "@/components/ui/index";

/**
 * Obavještenje kad opseg „samo dodijeljeni projekti" nema ni jednu dodjelu.
 *
 * Zašto komponenta, a ne tekst u stranici: poruka je dio PONAŠANJA, ne ukrasa. Poništavanje zadnje
 * važeće dodjele spušta opseg na `SELF`, ali normalna dodjela može isteći po datumu između dvije
 * prijave. Tada su liste prazne, i ako ekran ćuti, čovjek zaključi da je sistem pokvaren — pa zove
 * ured zbog nečega što radi kako treba.
 *
 * Poruka zato kaže TRI stvari: (1) šta je podešeno, (2) da nije greška, (3) kome se obratiti.
 */
export function ScopeNotice({
  scope,
  assignmentCount,
}: {
  scope: string | null | undefined;
  assignmentCount: number;
}) {
  if (scope !== "PROJECTS" || assignmentCount > 0) return null;

  return (
    <Alert tone="warning" role="alert">
      Vaš pristup je podešen na „samo dodijeljeni projekti", ali trenutno niste dodijeljeni ni na
      jedan projekat — zato su liste projekata prazne. Nije greška. Obratite se uredu da vas dodijeli;
      do tada vidite samo svoje rokove.
    </Alert>
  );
}
