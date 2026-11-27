-- Faza 3 — ispravka poslije prvog CI prolaza: `href` obavještenja mora biti WEB ekran.
--
-- Zašto migracija, a ne samo kod: razrješenje sukoba je pisalo `href = '/moj-dan'`, a `/moj-dan`
-- postoji samo u mobilnoj aplikaciji. Web inbox renderuje `href` kao `<Link>`, Next ga prefetchuje,
-- pa je svaki red sa tom putanjom pravio 404 u konzoli i oborio WORKER smoke (`attachConsoleGuard`
-- prijavljuje svaki 404). Popravka u kodu (`src/server/notification-hrefs.ts`) zaustavlja NOVE
-- redove; redovi već upisani u bazi bi i dalje bili 404, pa se prepisuju ovdje.
--
-- Zašto `/pregled`: to je jedini web ekran koji svaka rola otvara (nema `redirect('/nemate-pristup')`).
-- Ekran „Moj dan“ ostaje mobilni; web verzija istog ekrana dolazi u Fazi 4, i tada se ovaj backfill
-- NE vraća — novi redovi idu kroz `NOTIFICATION_HREFS`.
--
-- Ne diramo `title`/`body`: sadržaj poruke je tačan, mijenja se samo odredište linka.

BEGIN;

UPDATE public.notifications
   SET href = '/pregled'
 WHERE href = '/moj-dan'
   AND kind = 'workday.conflict_resolved';

INSERT INTO public.schema_migrations (name)
VALUES ('20261124150000_f3_2_notification_href')
ON CONFLICT DO NOTHING;

COMMIT;
