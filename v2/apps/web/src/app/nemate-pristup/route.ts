/**
 * 403 — "Nemate pristup ovoj stranici" (A2.3, 2026-11-07).
 *
 * Prije je zabranjen direktan URL tiho preusmjeravao na /pregled, pa korisnik nije znao
 * je li pogriješio adresu ili nema pravo. Route handler (ne page) jer server komponenta
 * ne može postaviti HTTP status — ovdje je status stvarno 403, s linkom na pregled.
 * Bez okvira: okvir traži sesiju i navigaciju, a ova stranica mora raditi i bez toga.
 */
export const dynamic = "force-dynamic";

const HTML = `<!doctype html>
<html lang="bs"><head><meta charset="utf-8"><title>Nemate pristup — Gradix</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{font-family:system-ui,sans-serif;background:#f4f4f4;color:#1b232a;margin:0;display:grid;place-items:center;min-height:100vh}
  main{background:#fff;border:1px solid #dadddf;border-radius:16px;padding:32px;max-width:420px;margin:16px}
  h1{font-size:22px;margin:0 0 8px} p{color:#59656f;line-height:1.5}
  a{display:inline-block;margin-top:16px;background:#140a9a;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600}
  @media (prefers-color-scheme: dark){body{background:#1b232a;color:#fff}main{background:#262e35;border-color:#394046}p{color:#adb0b2}}
</style></head>
<body><main>
  <h1>Nemate pristup ovoj stranici</h1>
  <p>Vaša rola ne uključuje ovu funkciju. Ako mislite da je greška, obratite se administratoru firme.</p>
  <a href="/pregled">Nazad na pregled</a>
</main></body></html>`;

export async function GET(): Promise<Response> {
  return new Response(HTML, {
    status: 403,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
