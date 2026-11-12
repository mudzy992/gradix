/**
 * Uslovi upita koji nose svoje parametre UZ tekst.
 *
 * Ranije su liste pravile uslove kroz `param()` closure: closure je gurnuo
 * vrijednost u niz parametara i vratio broj mjesta — pa je parametar mogao da
 * ostane bez teksta koji ga koristi („bind message supplies 2 parameters, but
 * prepared statement requires 1“; tako je pala lista projekata kad je opseg
 * bio prazan, a i firma je zbog toga prvobitno ostala van WHERE-a rokova).
 *
 * Ovdje to nije moguće: `cond` odbija uslov u kome se broj mjesta (`$`) ne
 * poklapa s brojem vrijednosti, a `buildWhere` numeriše mjesta tek pri
 * sastavljanju, redom kako su uslovi dodati. Jedan znak `$` u tekstu = jedno
 * mjesto za jednu vrijednost iz tog uslova.
 */
export type SqlCondition = { text: string; values: unknown[] };

const MARK = /\$/g;

export function cond(text: string, ...values: unknown[]): SqlCondition {
  const marks = text.split("$").length - 1;
  if (marks !== values.length) {
    throw new Error(
      `SQL uslov „${text}“ ima ${marks} mjesta za parametre, a dato je ${values.length} vrijednosti.`,
    );
  }
  return { text, values };
}

/**
 * Sastavlja `WHERE ...` iz uslova. Parametri se numerišu redom kojim su uslovi
 * dodati, pa uslov ne može da „pogreši“ mjesto ni da ostavi višak parametara.
 * Prazan niz vraća prazan `where` (bez `WHERE`).
 *
 * `leading` su parametri koje koristi dio SELECT-a upita (npr. `PROJECT_SELECT`
 * koristi `$1` za „danas“): njihovi brojevi su rezervisani PRIJE uslova, pa
 * uslovi ne mogu da ih prebrišu. Ko zove `buildWhere` s `leading`, mora i u
 * tekstu upita da koristi te brojeve — povezanost je na jednom mjestu, uz poziv.
 */
export function buildWhere(
  conditions: SqlCondition[],
  leading: unknown[] = [],
): { where: string; params: unknown[] } {
  const params: unknown[] = [...leading];
  const parts: string[] = [];
  for (const condition of conditions) {
    let valueIndex = 0;
    parts.push(condition.text.replace(MARK, () => `$${params.push(condition.values[valueIndex++])}`));
  }
  return { where: parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "", params };
}
