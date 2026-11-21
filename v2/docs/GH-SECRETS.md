# Minimalni spisak GitHub secrets — Gradix v2

Kratko: **za sada nijedan secret nije obavezan da bi Coolify radio.** Deploy ide iz
Coolifyja (git izvor), a sve što aplikaciji treba unosi se kao environment varijable
Coolify resource-a, ne u GitHub.

## 1. Za CI da prođe danas: 0 (nula) secrets

`.github/workflows/ci.yml` ne traži nijednu tajnu:

* Postgres je `services:` kontejner u jobu — kredencijali su fiksni i javni (`postgres/postgres`).
* `AUTH_SECRET` u CI-ju je placeholder od 39 znakova, samo da aplikacija starta.
* Testovi ne izlaze u internet, ne zovu `binaries.prisma.sh` kritično (korak
  `prisma generate` je dokaz koji smije pasti i to je zapisano u ADR 0002).

Ako je u Settings → Secrets and variables → **Variables** već nešto dodato za v1,
v2 to ne koristi.

## 2. Kad se doda deploy iz GitHub Actions (opciono, kasnije)

Samo ako odlučiš da `main` automatski deploya preko Coolify API-ja:

| Secret | Šta je | Odakle |
|---|---|---|
| `COOLIFY_WEBHOOK` | Deploy webhook URL resource-a `gradix-web` | Coolify → resource → Webhooks → Deploy URL |
| `COOLIFY_TOKEN` | API token, ako webhook traži `Authorization: Bearer` | Coolify → Keys & Tokens → API tokens (read/write na taj resource) |

To je sve. **Ne treba** `DATABASE_URL`, `AUTH_SECRET`, `POSTGRES_*`, `MINIO_*`, `REDIS_*`
u GitHubu — te vrijednosti žive samo u Coolifyju i u tvom `.env`, nikad u CI-ju.

## 3. Čega namjerno NEMA

| Ne uvodimo | Zašto |
|---|---|
| `DATABASE_URL` / `DATABASE_ADMIN_URL` kao GH secret | CI ima svoju ephemralnu bazu. Tajna baze u GitHubu bi značila da svaki PR može čitati produkcijske podatke. |
| `AUTH_SECRET` kao GH secret | Isti razlog; testovi koriste placeholder. |
| MinIO / Redis kredencijali | Ne koriste se u Fazi 1 (ADR 0006, STATUS.md). |
| Expo/EAS tokeni | Mobilni se za sada gradi lokalno; EAS dolazi u Fazi 2+ uz svoj ADR. |
| Docker Hub / GHCR login | Sliku gradi Coolify na svom serveru, ne GitHub. |

## 4. Redoslijed uvođenja (kad zatreba)

1. Sada: ništa. Coolify + ručni deploy.
2. Kad `main` postane stabilan: `COOLIFY_WEBHOOK` (+ `COOLIFY_TOKEN` ako webhook traži).
3. Kad mobilni dobije EAS build: Expo token, odvojen ADR.
4. Kad se uvede 2+ replike ili pozadinski poslovi: Redis ACL korisnik (u Coolifyju, ne u GitHubu).

## 5. Pravilo koje ostaje

Nijedna tajna ne ulazi u repo, ni u `.env.example`, ni u testove. `docs/COOLIFY.md` i ovaj
fajl sadrže **samo imena** varijabli i uputstva gdje se vrijednost unosi.
