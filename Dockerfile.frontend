# syntax=docker/dockerfile:1
#
# Gradix — frontend (Vite 8 + React 19, serviran kroz nginx)
#
# Build context je direktorij `frontend/`:
#   docker build -f frontend/Dockerfile frontend
#
# Coolify (Application):
#   Base Directory      = /frontend
#   Dockerfile Location = /frontend/Dockerfile
#
# API pozivi su relativni (`/api`, `/socket.io`), a nginx ih prosljeđuje na
# `$BACKEND_URL` (default http://backend:3000). Zahvaljujući tome VITE_API_URL
# nije obavezan i frontend radi na bilo kojoj domeni (Coolify, lokalno, compose).

# ---------- 1) Build Vite aplikacije ----------
FROM node:22-alpine AS builder
WORKDIR /app

# Coolify prosljeđuje SVE env varijable aplikacije kao Docker build-arg-ove
# (uključujući NODE_ENV=production). Deklarisani ARG postaje env varijabla
# dostupna u RUN koracima, pa ga ovdje namjerno deklarišemo da ponašanje bude
# predvidivo (i da CI može reproducirati Coolify build).
ARG NODE_ENV=production

COPY package.json package-lock.json ./

# OBAVEZNO `--include=dev` + `NODE_ENV=development`:
# kada je NODE_ENV=production, npm preskače devDependencies (vite, typescript,
# tailwind, ...) → build pada sa "sh: vite: not found".
RUN NODE_ENV=development npm ci --include=dev --no-audit --no-fund

COPY . .

# Opciono: apsolutni URL backenda (npr. https://api.gradix.ba).
# Prazno = relativni pozivi + nginx proxy (preporučeno).
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL

RUN if [ -n "$VITE_API_URL" ]; then \
      echo "[gradix] ⚠ VITE_API_URL='$VITE_API_URL' se ugrađuje u bundle (apsolutni API URL)."; \
      echo "[gradix] ⚠ nginx CSP je connect-src 'self' ws: wss: — pozivi na DRUGI origin biće"; \
      echo "[gradix] ⚠ blokirani u browseru ('Refused to connect because it violates CSP')."; \
      echo "[gradix] ⚠ Ako baš želiš drugi origin: dodaj ga u connect-src (frontend/nginx) i u"; \
      echo "[gradix] ⚠ CORS_ORIGIN na backendu. Preporučeno: ostavi prazno = relativni /api."; \
    fi

RUN npm run build

# ---------- 2) Produkcijska slika (nginx) ----------
FROM nginx:alpine AS production

ENV BACKEND_URL=http://backend:3000

# `nginx:alpine` automatski pokreće envsubst nad /etc/nginx/templates/*.template
# i rezultat upisuje u /etc/nginx/conf.d/.
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1

STOPSIGNAL SIGQUIT
CMD ["nginx", "-g", "daemon off;"]
