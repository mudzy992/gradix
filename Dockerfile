# Dockerfile za Gradix Backend (Coolify / PostgreSQL / TLS)
# Adaptirano sa MySQL/MariaDB na PostgreSQL

FROM node:22-alpine AS builder
WORKDIR /app

# Kopiraj package fajlove i instaliraj sve zavisnosti (uključujući dev za build)
COPY package*.json ./
RUN npm ci --include=dev

# Kopiraj Prisma shemu i generiraj klijenta (prije builda da se izbjegnu problemi)
COPY prisma.config.ts ./
COPY prisma ./prisma/
RUN npx prisma generate

# Kopiraj sav source kod
COPY . .
RUN npm run build

# Produkcijska slika — samo buildani artifakti i produkcijske zavisnosti
FROM node:22-alpine AS production
WORKDIR /app

# Postavi NODE_ENV
ENV NODE_ENV=production
ENV PORT=3000

# Instaliraj samo produkcijske node_modules (za runtime)
COPY package*.json ./
RUN npm ci --omit=dev --prefer-offline --no-audit

# Kopiraj buildane JS fajlove i Prisma klijent
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/generated ./generated

# Postavi prava za TLS CA cert (mapiran iz Coolify hosta)
RUN mkdir -p /etc/ssl/certs && chmod 755 /etc/ssl/certs

# Expose port za Coolify / proxy
EXPOSE 3000

# Pokretanje aplikacije sa Prisma migrate deploy (opcionalno — za produkciju obično se migracije pokreću odvojeno)
# Ovdje koristimo start:prod iz package.json, ali dodajemo migrate deploy prije starta
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
