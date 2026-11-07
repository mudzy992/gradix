/**
 * Dva dizajn smjera za R1a (pristup) + wireframe ekrana, na STVARNIM podacima iz baze.
 *
 * Ovo je DOKAZ, ne ekran: nijedna aplikaciona ruta ga ne uvozi. Služi da vlasnik izabere
 * smjer prije nego se potroši vrijeme na ekrane. Poslije odluke ovaj fajl se briše,
 * a izabrani smjer postaje `src/components/*`.
 *
 * Pokretanje:
 *   DATABASE_URL=... SEED_PASSWORD=nije,kikiriki pnpm --filter @gradix/web seed
 *   DATABASE_URL=... AUTH_SECRET=<32+> node scripts/smjera.mjs
 *   → http://localhost:3132/smjera/1
 *
 * Renderuje oba smjera sa istim podacima; razlika je samo u rasporedu i naglasku.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../src/app/globals.css"), "utf8");
const themeBlock = css.slice(css.indexOf("@theme {"), css.lastIndexOf("}") + 1);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Tenant scope kao u aplikaciji: `SET LOCAL app.company_id` u transakciji, pa RLS radi.
 * Firma sa najviše članova je demo firma (Druga Firma ima jednog).
 * Namjerno ne koristim `withCompany` — `@gradix/db` se ne može uvesti u `tsx` bez builda,
 * a dokaz mora raditi bez ijednog build koraka.
 */
async function withTenant(id, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.company_id', $1, true)", [id]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Demo firma = ona sa najviše članova. Namjerno kroz `companies` (ta tabela NIJE pod RLS-om),
 * jer bi upit na `memberships` bez postavljenog tenanta vratio nula redova — fail-closed
 * politika radi svoj posao. Broj članova se onda broji UNUTAR tenanta.
 */
async function pickCompany() {
  const ids = (await pool.query("SELECT id FROM companies")).rows.map((row) => row.id);
  let best = null;
  for (const id of ids) {
    const count = (
      await withTenant(id, (client) => client.query("SELECT count(*)::int AS n FROM memberships"))
    ).rows[0].n;
    if (!best || count > best.count) best = { id, count };
  }
  return best?.id;
}

async function loadData() {
  const id = await pickCompany();

  return withTenant(id, async (client) => {
    const company = (await client.query("SELECT id, name, currency FROM companies WHERE id = $1", [id])).rows[0];
    const users = (
      await client.query(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.is_active, u.must_change_password,
                u.created_at, m.roles::text[] AS roles
           FROM users u
           JOIN memberships m ON m.user_id = u.id
          WHERE m.company_id = $1
          ORDER BY (m.roles)[1], u.last_name`,
        [id],
      )
    ).rows;
    const audit = (
      await client.query(
        `SELECT a.created_at, a.action, a.entity_type,
                COALESCE(NULLIF(u.first_name || ' ' || u.last_name, ''), 'sistem') AS actor
           FROM audit_events a
           LEFT JOIN users u ON u.id = a.actor_id
          WHERE a.company_id = $1
          ORDER BY a.created_at DESC
          LIMIT 5`,
        [id],
      )
    ).rows;
    const counts = (
      await client.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE u.is_active = false)::int AS inactive,
                count(*) FILTER (WHERE u.must_change_password)::int AS must_change
           FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.company_id = $1`,
        [id],
      )
    ).rows[0];
    return { company, users, audit, counts };
  });
}

const initials = (u) => `${u.first_name[0] ?? ""}${u.last_name[0] ?? ""}`.toUpperCase();
const ROLE_BS = {
  OWNER: "Vlasnik",
  ADMIN: "Administrator",
  PROJECT_MANAGER: "Vođa projekta",
  SITE_SUPERVISOR: "Šef gradilišta",
  WORKER: "Radnik",
  DRIVER: "Vozač",
  MACHINE_OPERATOR: "Rukovalac",
  MECHANIC: "Mehaničar",
  ACCOUNTANT: "Računovođa",
};
/** `roles` je PG niz; `pg` ga vraća kao JS niz, ali tip iz baze je enum — kast u text[]. */
const roleBs = (roles) => (Array.isArray(roles) ? roles : []).map((r) => ROLE_BS[r] ?? r).join(", ");
const dateBs = (d) => new Intl.DateTimeFormat("bs-BA", { dateStyle: "medium" }).format(new Date(d));

const PAGE_CSS = String.raw`
*{box-sizing:border-box}
body{margin:0;font-family:var(--font-sans);color:var(--color-text);background:var(--color-surface-muted)}
.wrap{max-width:1240px;margin:0 auto;padding:24px}
.switch{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:12px 24px;background:var(--color-surface-inverse);color:var(--color-text-inverse);position:sticky;top:0;z-index:10}
.switch a{color:var(--color-accent);text-decoration:none;font-weight:700;padding:6px 10px;border-radius:8px}
.switch a[aria-current]{background:var(--color-accent);color:var(--color-text)}
.switch .sep{opacity:.5}
h1{font-size:26px;margin:0}
h3{font-size:16px;margin:0 0 10px}
.muted{color:var(--color-text-muted);font-size:14px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start}
.grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
@media(max-width:980px){.grid2,.grid3{grid-template-columns:1fr}}
.card{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);padding:20px}
.card>h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--color-text-muted);margin:0 0 14px}
section{margin:26px 0 40px}
.sec-title{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:14px}
.sec-title h2{font-size:20px;margin:0}
table{width:100%;border-collapse:collapse;font-size:15px}
th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--color-text-muted);padding:8px 10px;border-bottom:2px solid var(--color-border)}
td{padding:12px 10px;border-bottom:1px solid var(--color-border);vertical-align:middle}
tr:hover td{background:var(--color-brand-soft)}
.who{display:flex;gap:10px;align-items:center;font-weight:600}
.av{width:34px;height:34px;border-radius:999px;display:grid;place-items:center;font-size:12px;font-weight:800;background:var(--color-accent);color:var(--color-text);flex:none}
.btn{min-height:44px;padding:0 16px;border-radius:10px;font:600 15px var(--font-sans);cursor:pointer;border:2px solid transparent;display:inline-flex;align-items:center;justify-content:center;gap:8px;text-decoration:none}
.btn-sm{min-height:36px;font-size:13px;padding:0 12px}
.btn-primary{background:var(--color-brand);color:var(--color-text-inverse)}
.btn-primary:hover{background:var(--color-brand-hover)}
.btn-ghost{background:var(--color-surface);color:var(--color-brand);border-color:var(--color-brand)}
.btn-quiet{background:transparent;color:var(--color-text);border-color:var(--color-border-strong)}
.btn-danger{background:var(--color-surface);color:var(--color-danger);border-color:var(--color-danger)}
.btn:focus-visible,a:focus-visible,.inp:focus-visible{outline:3px solid var(--color-focus);outline-offset:2px}
.btn[disabled]{opacity:.55;cursor:not-allowed}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.field{display:grid;gap:6px;margin-bottom:14px}
label{font-size:14px;font-weight:600}
.inp{min-height:44px;padding:10px 12px;border:2px solid var(--color-border-strong);border-radius:10px;font:400 16px var(--font-sans);background:var(--color-surface);color:var(--color-text);width:100%}
.hint{font-size:13px;color:var(--color-text-muted)}
.err{background:var(--color-danger-soft);color:var(--color-danger);padding:10px 12px;border-radius:10px;font-size:14px;margin-bottom:12px}
.ok{background:var(--color-success-soft);color:var(--color-success);padding:10px 12px;border-radius:10px;font-size:14px}
.warn{background:var(--color-warning-soft);color:var(--color-warning-text);padding:10px 12px;border-radius:10px;font-size:14px}
.pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700;white-space:nowrap}
.pill-brand{background:var(--color-brand-soft);color:var(--color-brand)}
.pill-accent{background:var(--color-accent);color:var(--color-text)}
.pill-danger{background:var(--color-danger-soft);color:var(--color-danger)}
.pill-success{background:var(--color-success-soft);color:var(--color-success)}
.pill-quiet{background:var(--color-surface-muted);color:var(--color-text-muted)}
.empty{border:2px dashed var(--color-border-strong);border-radius:var(--radius-card);padding:32px;text-align:center;color:var(--color-text-muted)}
.ann{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--color-text-muted);margin-bottom:8px}
.stat{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);padding:16px}
.stat b{display:block;font-size:28px;line-height:1.1}
.sw{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.sw i{width:52px;height:26px;border-radius:6px;border:1px solid var(--color-border);display:block}
.note{font-size:13px;color:var(--color-text-muted);margin-top:8px}
/* Smjer A — gusta tabela, uredski */
.A .masthead{background:var(--color-surface-inverse);color:var(--color-text-inverse);border-radius:var(--radius-card);padding:18px 20px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
.A .masthead .muted{color:#c9d2d8}
.A .btn-quiet{color:var(--color-text-inverse);border-color:#3d474f;background:transparent}
.A tr:focus-within td{background:var(--color-brand-soft)}
/* Smjer B — kartice, veliki dodir, akcenat na akciji */
.B .masthead{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;padding:4px 0 16px;border-bottom:4px solid var(--color-accent)}
.B .masthead h1{font-size:30px}
.B table,.B thead,.B tbody,.B th,.B td,.B tr{display:block}
.B thead{display:none}
.B tbody{display:grid;gap:12px}
.B tr{border:1px solid var(--color-border);border-radius:var(--radius-card);padding:16px;display:grid;grid-template-columns:1fr auto;gap:12px;background:var(--color-surface)}
.B td{border:0;padding:0}
.B td[data-l]::before{content:attr(data-l);display:block;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--color-text-muted);margin-bottom:2px}
.B .actions{grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap}
.B .stat{border-top:4px solid var(--color-accent)}
.B .btn-primary{width:100%}
`;

function html(body, direction) {
  return `<!doctype html><html lang="bs"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>R1a — smjer ${direction}</title>
<style>${themeBlock}</style><style>${PAGE_CSS}</style></head>
<body class="${direction}">
<nav class="switch">
  <strong>Smjer:</strong>
  <a href="/smjera/A" ${direction === "A" ? 'aria-current="page"' : ""}>A — gusta tabela</a>
  <a href="/smjera/B" ${direction === "B" ? 'aria-current="page"' : ""}>B — kartice, akcija uz osobu</a>
  <span class="sep">·</span>
  <a href="#prijava">1 Prijava</a><a href="#promjena">2 Promjena</a>
  <a href="#token">3 Token</a><a href="#korisnici">4 Korisnici</a><a href="#pozivnica">5 Pozivnica</a>
</nav>
${body}
</body></html>`;
}

/* ---------- 1. Prijava ---------- */
function screenLogin() {
  return `<section id="prijava"><div class="sec-title"><h2>1 · Prijava</h2>
    <span class="muted">dodato: „Zaboravljena lozinka? → obrati se administratoru“ (bez emaila)</span></div>
  <div class="grid2">
    <div class="card"><h3>Podrazumijevano</h3>
      <div class="field"><label for="e1">Email</label><input class="inp" id="e1" value="ured@demo.ba"></div>
      <div class="field"><label for="p1">Lozinka</label><input class="inp" id="p1" type="password" value="············"></div>
      <button class="btn btn-primary">Prijavi se</button>
      <p class="note">Zaboravljena lozinka? Obrati se administratoru firme.</p>
    </div>
    <div class="card"><h3>Greška (ne otkriva postoji li nalog)</h3>
      <div class="err" role="alert">Email ili lozinka nisu ispravni.</div>
      <div class="field"><label for="e2">Email</label><input class="inp" id="e2" value="ured@demo.ba"></div>
      <div class="field"><label for="p2">Lozinka</label><input class="inp" id="p2" type="password" value="········"></div>
      <button class="btn btn-primary">Prijavi se</button>
      <div class="warn" style="margin-top:12px">Poslije 5 pokušaja: „Previše pokušaja. Sačekajte minutu.“ (kod <code>RATE_LIMITED</code>)</div>
    </div>
  </div></section>`;
}

/* ---------- 2. Obavezna promjena lozinke ---------- */
function screenChange() {
  return `<section id="promjena"><div class="sec-title"><h2>2 · Prva prijava — obavezna promjena</h2>
    <span class="muted">polje <code>mustChangePassword</code> postoji od R0; ovo je ekran koji ga koristi</span></div>
  <div class="grid2">
    <div class="card"><h3>Promjena</h3>
      <div class="field"><label for="c1">Trenutna lozinka</label><input class="inp" id="c1" type="password" value="············"></div>
      <div class="field"><label for="c2">Nova lozinka</label><input class="inp" id="c2" type="password" value="············">
        <span class="hint">Najmanje 10 znakova. Ne smije biti ista kao trenutna.</span></div>
      <div class="field"><label for="c3">Nova lozinka još jednom</label><input class="inp" id="c3" type="password" value="············"></div>
      <button class="btn btn-primary">Postavi lozinku i nastavi</button>
      <p class="note">Poslije promjene sve ostale sesije se gase — ako je neko drugi bio prijavljen, ispada.</p>
    </div>
    <div class="card"><h3>Greške</h3>
      <div class="err" role="alert">Lozinka mora imati najmanje 10 znakova.</div>
      <div class="err" role="alert">Nova lozinka ne smije biti ista kao trenutna.</div>
      <div class="err" role="alert">Lozinke se ne poklapaju.</div>
      <div class="ok" style="margin-top:12px">Lozinka je promijenjena. Ostale sesije su odjavljene.</div>
    </div>
  </div></section>`;
}

/* ---------- 3. Postavljanje lozinke preko linka ---------- */
function screenToken() {
  return `<section id="token"><div class="sec-title"><h2>3 · Postavljanje lozinke preko linka</h2>
    <span class="muted">admin kopira link i pošalje sam; u bazi je samo hash tokena</span></div>
  <div class="grid3">
    <div class="card"><h3>Token važi</h3>
      <div class="field"><label for="t1">Email</label><input class="inp" id="t1" value="sef@demo.ba" disabled></div>
      <div class="field"><label for="t2">Nova lozinka</label><input class="inp" id="t2" type="password" value="············"></div>
      <button class="btn btn-primary">Postavi lozinku</button>
      <p class="note">Link važi 48 h i može se iskoristiti jednom.</p>
    </div>
    <div class="card"><h3>Link istekao</h3>
      <div class="warn">Link je istekao. Zamolite administratora da izda novi.</div>
      <button class="btn btn-ghost" style="margin-top:12px">Na prijavu</button>
    </div>
    <div class="card"><h3>Link već iskorišten</h3>
      <div class="warn">Link je već iskorišten. Ako niste vi postavili lozinku, odmah javite administratoru.</div>
      <button class="btn btn-ghost" style="margin-top:12px">Na prijavu</button>
    </div>
  </div></section>`;
}

/* ---------- 4. Lista korisnika ---------- */
function screenUsers(data, direction) {
  const rows = data.users
    .map((u) => {
      const status = !u.is_active
        ? '<span class="pill pill-danger">Deaktiviran</span>'
        : u.must_change_password
          ? '<span class="pill pill-accent">Čeka prvu prijavu</span>'
          : '<span class="pill pill-success">Aktivan</span>';
      const role = `<span class="pill pill-brand">${roleBs(u.roles)}</span>`;
      if (direction === "A") {
        return `<tr>
          <td><div class="who"><span class="av">${initials(u)}</span>
            <span>${u.first_name} ${u.last_name}<br><span class="muted">${u.email}</span></span></div></td>
          <td>${role}</td>
          <td>${status}</td>
          <td class="muted">${dateBs(u.created_at)}</td>
          <td><div class="row">
            <button class="btn btn-sm btn-quiet">Pošalji reset</button>
            <button class="btn btn-sm btn-danger">Deaktiviraj</button>
          </div></td>
        </tr>`;
      }
      return `<tr>
        <td><div class="who"><span class="av">${initials(u)}</span>
          <span>${u.first_name} ${u.last_name}<br><span class="muted">${u.email}</span></span></div></td>
        <td data-l="Rola">${role}</td>
        <td data-l="Status">${status}</td>
        <td data-l="Dodan" class="muted">${dateBs(u.created_at)}</td>
        <td class="actions">
          <button class="btn btn-sm btn-ghost">Pošalji reset</button>
          <button class="btn btn-sm btn-danger">Deaktiviraj</button>
        </td>
      </tr>`;
    })
    .join("\n");

  const head =
    direction === "A"
      ? `<thead><tr><th>Osoba</th><th>Rola</th><th>Status</th><th>Dodan</th><th>Akcije</th></tr></thead>`
      : "";

  return `<section id="korisnici"><div class="sec-title"><h2>4 · Korisnici</h2>
    <span class="muted">stvarni podaci: ${data.company.name}</span></div>
  <div class="grid3" style="margin-bottom:16px">
    <div class="stat"><span class="ann">Ukupno</span><b>${data.counts.total}</b><span class="muted">osoba u firmi</span></div>
    <div class="stat"><span class="ann">Čeka prvu prijavu</span><b>${data.counts.must_change}</b><span class="muted">nisu još postavili lozinku</span></div>
    <div class="stat"><span class="ann">Deaktivirano</span><b>${data.counts.inactive}</b><span class="muted">bez pristupa</span></div>
  </div>
  <div class="card">
    <div class="row" style="justify-content:space-between;margin-bottom:14px">
      <div class="row"><input class="inp" style="width:260px" placeholder="Traži po imenu ili emailu" aria-label="Traži korisnika">
        <select class="inp" style="width:170px" aria-label="Filtriraj po roli"><option>Sve role</option><option>Administrator</option><option>Šef gradilišta</option></select></div>
      <button class="btn btn-primary">+ Pozovi osobu</button>
    </div>
    <table>${head}<tbody>${rows}</tbody></table>
  </div>
  <div class="grid2" style="margin-top:16px">
    <div class="card"><h3>Prazno stanje</h3>
      <div class="empty"><p><strong>Nema osoba koje odgovaraju filteru.</strong></p>
        <p class="muted">Obrišite filter ili pozovite novu osobu.</p>
        <button class="btn btn-ghost">Obriši filter</button></div></div>
    <div class="card"><h3>Greška i učitavanje</h3>
      <div class="err" role="alert">Nema veze sa serverom. Provjerite mrežu i pokušajte ponovo.</div>
      <div class="empty" style="border-style:solid">Učitavanje…</div></div>
  </div></section>`;
}

/* ---------- 5. Pozivnica ---------- */
function screenInvite(data) {
  const first = data.users[0] ?? { email: "osoba@firma.ba" };
  return `<section id="pozivnica"><div class="sec-title"><h2>5 · Pozivnica — link koji admin kopira</h2>
    <span class="muted">nema email provajdera; to je ADR 0008</span></div>
  <div class="grid2">
    <div class="card"><h3>Nova pozivnica</h3>
      <div class="field"><label for="i1">Email osobe</label><input class="inp" id="i1" placeholder="ime@firma.ba"></div>
      <div class="field"><label for="i2">Rola</label>
        <select class="inp" id="i2"><option>Radnik</option><option>Šef gradilišta</option><option>Administrator</option></select></div>
      <div class="field"><label for="i3">Opseg</label>
        <select class="inp" id="i3"><option>Cijela firma</option><option>Dodijeljeni projekti</option><option>Samo svoje</option></select></div>
      <button class="btn btn-primary">Napravi link</button>
      <p class="note">Link važi 48 h, jednokratan je. U bazi se čuva samo hash.</p>
    </div>
    <div class="card"><h3>Link napravljen</h3>
      <div class="ok">Pozivnica je napravljena. Kopirajte link i pošaljite ga sami.</div>
      <div class="field" style="margin-top:12px"><label for="l1">Link (važi do 10. 11. 2026. 09:14)</label>
        <input class="inp" id="l1" readonly value="https://gradix.ba101.top/lozinka/postavi?token=gx1_9f3c…e21a">
      </div>
      <div class="row"><button class="btn btn-ghost">Kopiraj link</button>
        <button class="btn btn-quiet">Zatvori</button></div>
      <div class="warn" style="margin-top:14px">Ako zatvorite bez kopiranja, link se više ne može prikazati — samo napraviti novi.</div>
      <p class="note">Primjer za ${first.first_name ?? "osobu"} (${first.email}).</p>
    </div>
  </div></section>`;
}

function page(data, direction) {
  const mast =
    direction === "A"
      ? `<div class="masthead"><div><div class="ann" style="color:#c9d2d8">${data.company.name}</div>
          <h1>Korisnici</h1></div>
          <div class="row"><button class="btn btn-quiet">Audit</button>
          <button class="btn btn-primary">+ Pozovi osobu</button></div></div>`
      : `<div class="masthead"><div><h1>Korisnici</h1>
          <p class="muted">${data.company.name} · ${data.counts.total} osoba</p></div>
          <div class="row" style="min-width:260px"><button class="btn btn-primary">+ Pozovi osobu</button></div></div>`;

  const swatches = ["brand", "brand-soft", "accent", "surface-inverse", "text-muted", "border-strong", "danger", "success"];

  return html(
    `<div class="wrap">
      ${mast}
      ${direction === "A" ? "" : ""}
      ${screenLogin()}
      ${screenChange()}
      ${screenToken()}
      ${screenUsers(data, direction)}
      ${screenInvite(data)}
      <section><div class="sec-title"><h2>Paleta u upotrebi</h2></div>
        <div class="card">
          <div class="row"><span class="pill pill-brand">Brend</span><span class="pill pill-accent">Čeka prvu prijavu</span>
            <span class="pill pill-success">Aktivan</span><span class="pill pill-danger">Deaktiviran</span>
            <span class="pill pill-quiet">Neaktivno</span>
            <button class="btn btn-primary btn-sm">Primarna</button>
            <button class="btn btn-ghost btn-sm">Sekundarna</button>
            <button class="btn btn-quiet btn-sm">Tiha</button>
            <button class="btn btn-danger btn-sm">Opasna</button></div>
          <div class="sw">${swatches.map((s) => `<i style="background:var(--color-${s})" title="--color-${s}"></i>`).join("")}</div>
          <p class="note">Sve boje dolaze iz <code>globals.css</code>. Primijeni ih isto i na mobilni (<code>src/theme/tokens.ts</code>) — test čuva da se ne raziđu.</p>
        </div>
      </section>
      <section><div class="sec-title"><h2>Audit (R1b, samo pregled)</h2></div>
        <div class="card">${data.audit.length === 0
          ? `<div class="empty">Nema zapisa u auditu. Prva izmjena korisnika će se pojaviti ovdje.</div>`
          : `<table><thead><tr><th>Vrijeme</th><th>Ko</th><th>Akcija</th><th>Resurs</th></tr></thead><tbody>
              ${data.audit.map((a) => `<tr><td class="muted">${dateBs(a.created_at)}</td><td>${a.actor}</td><td>${a.action}</td><td>${a.entity_type}</td></tr>`).join("")}
            </tbody></table>`}</div>
      </section>
      <p class="note">Ovo je wireframe na stvarnim podacima za izbor smjera. Nijedna ruta ga ne uvozi.</p>
    </div>`,
    direction,
  );
}

const server = createServer(async (request, response) => {
  const match = request.url?.match(/^\/smjera\/(A|B)/);
  if (!match) {
    response.writeHead(302, { location: "/smjera/A" });
    response.end();
    return;
  }
  try {
    // Tijelo se gradi PRIJE zaglavlja: ako render pukne, greška ide kao 500, a ne kao
    // ERR_HTTP_HEADERS_SENT koja sakrije pravi uzrok.
    const data = await loadData();
    const body = page(data, match[1]);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(body);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    }
    response.end(`Greška: ${error.message}\n\nJe li seed pokrenut i DATABASE_URL postavljen?`);
  }
});

const port = Number(process.env.PORT ?? 3132);
server.listen(port, "0.0.0.0", () => {
  console.log(`Smjerovi: http://localhost:${port}/smjera/A  i  /smjera/B`);
});
