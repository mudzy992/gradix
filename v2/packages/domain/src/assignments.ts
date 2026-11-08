/**
 * Blokada dodjele zbog istekle obaveze (B5.4).
 *
 * Pravilo iz briefa: „radnik s isteklim ovlaštenjem za mašinu ne može biti dodijeljen toj mašini;
 * vozilo s isteklom registracijom ne može dobiti turu — uz mogućnost evidentirane iznimke koju
 * odobrava ovlašteno lice."
 *
 * Tri stvari su namjerno OVDJE, u domeni, a ne u servisu:
 *   1. šta je blokada (samo `expired` i tip koji firma označi kao blokirajući),
 *   2. da „uskoro istječe" NIJE blokada — inače bi sistem zaustavio rad 60 dana prije roka,
 *   3. da iznimka važi samo dok ne istekne i samo uz razlog.
 *
 * `expiring` je upozorenje, ne zabrana. To je razlika koju ljudi na terenu odmah osjete: dan kad im
 * istječe ljekarski i dalje mogu raditi tog dana, jer `expired` počinje dan poslije roka.
 */

import type { ObligationState } from "./obligations";

/** Obaveza koja ulazi u provjeru — samo ono što odluka traži. */
export type AssignmentObligation = {
  id: string;
  typeLabel: string;
  state: ObligationState;
  /** Blokira li ovaj TIP dodjelu. Podatak iz `obligation_types.blocks_assignment`. */
  blocksAssignment: boolean;
};

/** Evidentirana iznimka, kako je zapisana. */
export type AssignmentOverride = {
  obligationId: string;
  reason: string;
  /** `YYYY-MM-DD`; iznimka važi do tog dana uključivo. */
  validUntil: string;
  /** Ko je odobrio — za prikaz, ne za odluku (dozvola se provjerava prije upisa). */
  createdBy?: string | null;
};

export type AssignmentBlocker = {
  obligationId: string;
  typeLabel: string;
  /** Ima li važeću iznimku. `false` = dodjela se odbija. */
  covered: boolean;
  reason?: string;
};

export type AssignmentCheck = {
  /** Blokade koje NISU pokrivene iznimkom. Ako nije prazno, dodjela se odbija. */
  blocked: AssignmentBlocker[];
  /** Blokade koje iznimka pokriva — prikazuju se, jer iznimka mora biti vidljiva. */
  overridden: AssignmentBlocker[];
};

/**
 * Iznimka važi do `validUntil` uključivo.
 *
 * Poređenje je tekstualno (`YYYY-MM-DD` se sortira leksikografski isto kao hronološki), pa nema
 * vremenske zone koja bi iznimku ugasila sat prije ili poslije ponoći. Isti razlog zbog kojeg
 * „danas" u rokovima dolazi kao poslovni datum firme.
 */
export function isOverrideActive(override: AssignmentOverride, today: string): boolean {
  return override.validUntil >= today;
}

/**
 * Odluka: smije li se dodjela upisati.
 *
 * Nepoznato je blokada: obaveza bez izračunatog stanja ne smije tiho proći. Iznimka bez razloga
 * (prazan ili prekratak tekst) ne važi — iznimka bez razloga je tiho gašenje pravila.
 */
export function checkAssignment(
  obligations: readonly AssignmentObligation[],
  overrides: readonly AssignmentOverride[],
  today: string,
): AssignmentCheck {
  const blocking = obligations.filter(
    (obligation) => obligation.blocksAssignment && obligation.state === "expired",
  );

  const blocked: AssignmentBlocker[] = [];
  const overridden: AssignmentBlocker[] = [];

  for (const obligation of blocking) {
    const override = overrides.find(
      (entry) => entry.obligationId === obligation.id && isOverrideActive(entry, today),
    );
    const hasReason = Boolean(override && override.reason.trim().length >= 10);

    if (override && hasReason) {
      overridden.push({
        obligationId: obligation.id,
        typeLabel: obligation.typeLabel,
        covered: true,
        reason: override.reason.trim(),
      });
    } else {
      blocked.push({
        obligationId: obligation.id,
        typeLabel: obligation.typeLabel,
        covered: false,
      });
    }
  }

  return { blocked, overridden };
}

/** Poruka za ekran i API — jedna, da se ne pišu dvije verzije istog objašnjenja. */
export function assignmentBlockMessage(check: AssignmentCheck): string | null {
  if (check.blocked.length === 0) return null;
  const labels = check.blocked.map((entry) => entry.typeLabel).join(", ");
  return `Ne može se dodijeliti: isteklo je — ${labels}. Dodajte iznimku sa razlogom ili obnovite obavezu.`;
}
