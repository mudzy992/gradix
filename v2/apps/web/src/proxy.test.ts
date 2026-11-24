/**
 * `proxy.ts` — jedina provjera koja garantuje da sesija za uparivanje 2FA ne ostane zaključana.
 *
 * Ovo je regresija iz produkcije: API je puštao `/api/auth/2fa/enroll`, ali je stranica
 * `/ured/postavke` preusmjeravala na `/pregled`, a tamo je API vraćao 403. Korisnik koji MORA
 * upariti 2FA nije mogao doći do uparivanja — ekran se „nije mogao učitati".
 */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { proxy } from "./proxy";
import { resetConfigForTests } from "./server/config";
import { ACCESS_COOKIE, issueAccessToken } from "./server/session";

const originalSecret = process.env.AUTH_SECRET;
const originalDatabaseUrl = process.env.DATABASE_URL;

beforeAll(() => {
  process.env.AUTH_SECRET = "proxy-unit-test-secret-at-least-32-characters";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  resetConfigForTests();
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = originalSecret;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  resetConfigForTests();
});

function request(path: string, token?: string): NextRequest {
  const withCookie = token ? { cookie: `${ACCESS_COOKIE}=${token}` } : undefined;
  return new NextRequest(`http://localhost${path}`, withCookie ? { headers: withCookie } : undefined);
}

const enrollmentToken = () =>
  issueAccessToken({ sub: "usr_test", sid: "ses_test", companyId: "cmp_test", enr: true });

const normalToken = () =>
  issueAccessToken({ sub: "usr_test", sid: "ses_test", companyId: "cmp_test" });

describe("proxy — sesija za uparivanje 2FA", () => {
  it("poslovni ekran preusmjerava NA uparivanje (ne na /pregled, gdje bi dobio 403)", () => {
    const response = proxy(request("/ured/pregled", enrollmentToken()));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/ured/postavke?tab=sigurnost");
  });

  it("Postavke bez taba dobijaju tab Sigurnost", () => {
    const response = proxy(request("/ured/postavke", enrollmentToken()));
    expect(response.headers.get("location")).toBe("http://localhost/ured/postavke?tab=sigurnost");
  });

  it("uparivanje je dozvoljeno — ekran se učitava", () => {
    const response = proxy(request("/ured/postavke?tab=sigurnost", enrollmentToken()));
    expect(response.headers.get("location")).toBeNull();
  });

  it("promjena lozinke je dozvoljena (nalog može morati i jedno i drugo)", () => {
    expect(proxy(request("/lozinka/promjena", enrollmentToken())).headers.get("location")).toBeNull();
  });

  it("obična sesija prolazi neometano", () => {
    for (const path of ["/ured/pregled", "/ured/radnici", "/ured/postavke"]) {
      expect(proxy(request(path, normalToken())).headers.get("location")).toBeNull();
    }
  });

  it("bez sesije nema preusmjeravanja — prijava mora raditi", () => {
    expect(proxy(request("/login")).headers.get("location")).toBeNull();
    expect(proxy(request("/ured/postavke")).headers.get("location")).toBeNull();
  });

  it("API rute se ne diraju — `guard` nosi tačan kod greške", () => {
    expect(proxy(request("/api/auth/2fa/status", enrollmentToken())).headers.get("location")).toBeNull();
  });
});
