# syntax=docker/dockerfile:1
#
# Gradix — backend (NestJS 11 + Prisma 7 + PostgreSQL)
#
# Build context je direktorij `backend/`:
#   docker build -f backend/Dockerfile backend
#
# Coolify (Application):
#   Base Directory      = /backend
#   Dockerfile Location = /backend/Dockerfile
#
# Coolify (Docker Compose): koristite priloženi `docker-compose.yml`.

# ---------- 1) Zavisnosti (kešira se dok se ne promijeni package-lock.json) ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Coolify u build ubacuje NODE_ENV=production; npm tada preskoči devDependencies.
# Zato je `--include=dev` obavezan (potrebni su nest cli, prisma, ts-jest, ...).
RUN NODE_ENV=development npm ci --include=dev --no-audit --no-fund

# ---------- 2) Build (Prisma client + nest build) ----------
FROM node:22-alpine AS builder
WORKDIR /app
ENV NODE_ENV=development
# `prisma generate` čita DATABASE_URL iz prisma.config.ts, ali NE otvara konekciju.
# Placeholder osigurava da generate radi u build fazi (bez baze).
ENV DATABASE_URL="postgresql://gradix:gradix@localhost:5432/gradix?schema=public"

# Prisma (musl varijanta) traži openssl u alpine slici.
RUN apk add --no-cache openssl ca-certificates

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json prisma.config.ts nest-cli.json tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
# Generisani klijent se emituje u ./generated (vidi prisma/schema/foundation.prisma)
RUN npx prisma generate && mkdir -p /root/.cache/prisma

COPY src ./src
# `tsconfig.build.json` uključuje i `prisma/`, pa se seed kompajlira u
# `dist/prisma/seed.js`. Guard ispod ruši build ako neka od ulaznih tačaka
# nedostaje — bolje pasti u buildu nego na seed-u u produkciji.
RUN npm run build \
    && test -f dist/src/main.js \
    && test -f dist/prisma/seed.js

# ---------- 3) Produkcijska slika ----------
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

RUN apk add --no-cache openssl ca-certificates

# Samo produkcijske zavisnosti (`prisma` CLI i `dotenv` su produkcijske
# zavisnosti jer entrypoint pokreće `prisma migrate deploy`).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Buildani artefakti (dist/src/main.js je ulazna tačka — vidi "start:prod")
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Keš Prisma engine-a iz build faze — da `migrate deploy` ne mora da ih
# preuzima sa interneta pri svakom pokretanju kontejnera.
COPY --from=builder /root/.cache/prisma /root/.cache/prisma

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Seed (demo podaci) je dio slike: `dist/prisma/seed.js` (kompajliran iz
# `prisma/seed.ts`, bez `tsx` i bez dev zavisnosti).
#   docker compose run --rm backend node dist/prisma/seed.js
# ili iz Coolify terminala nad backend kontejnerom:
#   node dist/prisma/seed.js
# Detalji: DEPLOYMENT_COOLIFY.md §5.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/src/main.js"]
