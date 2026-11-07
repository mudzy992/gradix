> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# Screens — web + mobile

Status: **locked** (web Faza 3 shell; ostale rute Faza 5+). Stavka vidljiva ako unija permisija to da. Liste i dalje scoped.

Faza 3 **implementira samo:** `/login` `/forgot` `/reset` `/dashboard` `/settings` `/users` `/companies`.  
Faza 5 **uključuje** ostale web rute ispod (direct URL više ne redirecta na dashboard). Bell deep link od Faze 5.

## Web (panel, auth)

- `/login` `/forgot` `/reset` javno za panel
- `/dashboard` — auth; Faza 3 placeholder; Faza 5 `GET /api/dashboard` + kartice po [data-scope](../data-scope/MATRIX.md) (WORKER bez budget). PM/SS/ADMIN: presence “na terenu”.
- `/settings` — `settings.write` (nema read-only ekrana)
- `/users` — `users.write`
- `/companies` — `platform.companies`
- `/projects` — `projects.read` (DRIVER koristi picker, ne ovu rutu). Tab Količine ako `quantities.read`.
- `/tasks` — `tasks.read` ili `tasks.dispatch`
- `/fleet`, `/fleet/map` — `fleet.read` / `fleet.map`
- `/logistics` — `trips.read`
- `/diary` — `diary.read`
- `/tenders` — `tenders.read`
- `/documents` — `documents.read`
- `/fuel` — `fuel.reports` ili `fuel.write`
- `/reports` — `reports.read` (fiksni slugovi, [reports](../reports/MATRIX.md))
- `/hse` — `hse.read` (web lista; create i na Sheet ako web-only SS)
- `/payroll` — `payroll.read` (Faza 9)
- `/erp` — `erp.read` (Faza 10)

## Javni one-page (Faza 8)

- `/p/:slug` — bez auth; DTO whitelist: naziv, grad/opština, status, jedna slika. Bez budžeta, GPS, radnika, dokumenata.

## Mobile tabovi (max 5)

Unija, redoslijed: Home, Zadaci, Ture, Dnevnik, Profil.

- Home: uvijek za auth
- Zadaci: `tasks.timer` ili `tasks.read`
- Ture: `trips.write` ili `trips.read`
- Dnevnik: `diary.write`
- Profil: uvijek (gorivo ako `fuel.write`; HSE dugme ako `hse.write` **i online**)

Ako unija zatraži >5, Profil apsorbuje višak (gorivo već tamo). Ne dodavati 6. tab.
