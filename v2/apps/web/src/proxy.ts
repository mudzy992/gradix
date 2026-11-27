/**
 * `proxy.ts` (Next 16; ranije `middleware.ts`) — JEDNA provjera „šta ova sesija smije vidjeti".
 *
 * Zašto ovdje, a ne u svakoj stranici posebno: 27 stranica je ponavljalo isti niz
 * (`!auth.ok` → `/login`, `mustChangePassword` → `/lozinka/promjena`, …) i **nijedna** nije
 * provjeravala sesiju izdatu radi UPARIVANJA 2FA. Posljedica u produkciji: nalog koji mora
 * upariti 2FA dobije sesiju, ali ga `/ured/postavke` preusmjeri na `/pregled`, gdje ga API
 * odbije sa `AUTH_2FA_ENROLLMENT_REQUIRED` — ekran za 2FA se nikad ne učita. Tiket:
 * „2FA ekran/podešavanje ne može da se učita".
 *
 * Ovaj fajl ne zamjenjuje provjere u stranicama (one i dalje rade svoj posao i daju tačan
 * razlog), nego garantuje da nijedna stranica ne može **zaboraviti** uparivanje.
 *
 * `proxy` se u Next 16 izvršava na Node runtime-u (nije Edge), pa smije koristiti isti
 * `node:crypto` verifikator koji koristi i server — nema druge implementacije JWT-a.
 */
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, verifyAccessToken } from "./server/session";

/** Ekran na koji ide sesija koja služi SAMO uparivanju 2FA. */
const ENROLLMENT_SCREEN = "/ured/postavke?tab=sigurnost";

/**
 * Putanje koje sesija za uparivanje SMIJE otvoriti.
 *
 * Namjerno kratko: uparivanje ne treba ni jedan poslovni ekran. `login` i statika su tu jer
 * se bez njih ne može ni prijaviti ni učiniti stranicu.
 */
const ENROLLMENT_ALLOWED = [/^\/ured\/postavke\/?$/, /^\/login\/?$/, /^\/lozinka\/promjena\/?$/];

function isStatic(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt"
  );
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  // API rute imaju svoj `guard` (i svoj tačan kod greške); statika nema sesiju.
  if (isStatic(pathname)) return NextResponse.next();

  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.next();
  const claims = verifyAccessToken(token);
  if (!claims || claims.enr !== true) return NextResponse.next();

  // Sesija za uparivanje: sve osim ekrana za uparivanje se preusmjerava NA uparivanje.
  if (ENROLLMENT_ALLOWED.some((pattern) => pattern.test(pathname))) {
    // Ako već jeste na Postavkama ali bez taba, dodaj tab da se otvori Sigurnost.
    if (pathname === "/ured/postavke" && !search.includes("tab=sigurnost")) {
      return NextResponse.redirect(new URL(ENROLLMENT_SCREEN, request.url));
    }
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL(ENROLLMENT_SCREEN, request.url));
}

/**
 * Matcher preskače statiku i API — dvostruka zaštita uz `isStatic` (matcher se primjenjuje
 * prije koda, pa je jeftiniji). Ne pokriva `/api` jer `guard` tamo već nosi istu odluku.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
