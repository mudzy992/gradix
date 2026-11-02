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

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Opciono: apsolutni URL backenda (npr. https://api.gradix.ba).
# Prazno = relativni pozivi + nginx proxy (preporučeno).
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL

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
