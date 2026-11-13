/**
 * Jedan oblik odgovora i zatvoren katalog kodova (A3.3.4, preuzeto iz v1 §2.1).
 * Klijent prevodi po `code`; `message` je rezerva za logove i razvoj.
 *
 * Katalog i statusi žive u `@gradix/contracts` — isti spisak koriste klijent i OpenAPI.
 * Ovaj modul ih samo re-izvozi i pretvara u `NextResponse`, pa ne postoji druga kopija koja
 * može da se raziđe (test u `packages/contracts` to i provjerava).
 */
import { NextResponse } from "next/server";
import { ERROR_CODES, ERROR_STATUS, type ErrorCode } from "@gradix/contracts";

export { ERROR_CODES, type ErrorCode };

const STATUS = ERROR_STATUS;

export function ok<T>(data: T, meta?: Record<string, unknown>): NextResponse {
  return NextResponse.json(meta ? { success: true, data, meta } : { success: true, data });
}

export function fail(code: ErrorCode, message: string): NextResponse {
  return NextResponse.json(
    { success: false, error: { code, message } },
    { status: STATUS[code] },
  );
}

/**
 * Neočekivana greška: klijent dobija generički kod, detalji idu u log bez PII.
 *
 * A1 backstop: string s kontrolnim znakom (npr. NUL iz mobilne tipkovnice) koji je
 * nekako prošao granicu valjanja dospijeva do Postgresa, koji ga odbija (SQLSTATE
 * 22P05, „invalid byte sequence for encoding "UTF8"“). To je greška ulaza, ne servera:
 * klijent dobija 400 s jasnom porukom umjesto generičkog 500, a log i dalje bilježi
 * da je neki put ostao ne pokriven (kontekst + 22P05, bez vrijednosti polja).
 */
export function internal(error: unknown, context: string): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('invalid byte sequence for encoding "UTF8"')) {
    console.error(
      JSON.stringify({ level: "error", context, msg: "kontrolni znak dosao do baze — rupa u validaciji", pgCode: "22P05" }),
    );
    return fail("VALIDATION_FAILED", "Unos sadrži nedozvoljene kontrolne znakove.");
  }
  console.error(JSON.stringify({ level: "error", context, msg: message }));
  return fail("INTERNAL", "Došlo je do greške. Pokušajte ponovo.");
}
