# CI / deploy — matrica

Status: **locked**. Faza 7.5. **Nema auto-deploy u v1.**

## CI (GitHub Actions, PR + main)

1. Backend: lint + `test` + build
2. Frontend: lint + build
3. (Opciono kad postoji) mobile `tsc` — ne EAS build u CI v1

Fail PR-a ako test padne. Nema job-a `deploy`, `ssh`, `kubectl`, `eas submit`.

## Artefakti ručno

- `docker-compose.yml` (dev) + `docker-compose.prod.yml` (dokumentovan; apply ručno)
- Migracije: `prisma migrate deploy` ručno na serveru
- EAS iOS/Android: ručno kad owner zatraži (nije close Faze 7)

## Secrets

CI koristi samo test DB / dummy env. Ne committati `.env`. Production secrets nisu u repo.

## Van v1

CD na VPS, preview environments, auto EAS, nightly e2e na emulatoru (Playwright na web **jest** u 7.5 smoke, ne full prod).

## Error / policy

Nema API koda. Kršenje = freeze izmjena.
