-- R1a ispravka: poruka „Sačekajte minutu" nije bila tačna.
--
-- Klizni prozor od 60 s znači da se promašaj izbacuje TEK 60 s poslije SVOG vremena. Ko pet
-- puta promaši u pet sekundi i dalje čeka skoro cijeli prozor od zadnjeg promašaja; ko je
-- promašio prije 50 s, čeka 10 s. Brojač to zna, ali ruta nije imala kako da to kaže i
-- prikazivala je fiksnu minutu.
--
-- Ispravka ne mijenja politiku (5 promašaja / 60 s), samo dodaje funkciju koja vraća KOLIKO
-- još sekundi prozor drži korisnika. Aplikacija i dalje nema SELECT na tabelu.

CREATE OR REPLACE FUNCTION login_attempt_retry_after(p_email_hash TEXT, p_window_seconds INTEGER)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- 0 = prozor je slobodan; inače broj sekundi do trenutka kad najstariji promašaj ispadne.
  SELECT GREATEST(
    0,
    CEIL(EXTRACT(EPOCH FROM (
      MIN(at) + make_interval(secs => p_window_seconds) - now()
    )))::int
  )
  FROM login_attempts
  WHERE email_hash = p_email_hash
    AND at > now() - make_interval(secs => p_window_seconds);
$$;

-- Prava se dodaju u bootstrap/grants.sql (jedno mjesto za prava).

INSERT INTO schema_migrations (name) VALUES ('20261108120000_r1a_ratelimit_retry') ON CONFLICT DO NOTHING;
