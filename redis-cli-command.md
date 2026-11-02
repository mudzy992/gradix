# Redis CLI — ručno kreiranje korisnika, prefixa i prava (Coolify / TLS)

> **NAPOMENA:** Gradix v1 **ne koristi Redis** (`Nema Redis/BullMQ` u `PLAN_FREEZE.md`). Ova linija je pripremljena za buduće faze (`Redis geo`, `BullMQ` kada `cron` ne staže) i za Coolify kompatibilnost.

---

## 1. Osnovna `redis-cli` komanda sa TLS (`--cacert`) za Coolify

```bash
redis-cli \
  -p 6379 \
  --tls \
  --cacert /data/coolify/ssl/redis-core/redis-ca.crt \
  --user default \
  --pass "${REDIS_PASSWORD:-gradixwork}" \
  -c \
  "PING"
```

---

## 2. Kreiranje ACL korisnika (`gradix-worker`) sa pravima i prefixom

Ova komanda kreira korisnika `gradix-worker`, postavlja lozinku (`gradixwork` — zamijeniti stvarnom!), ograničava ključeve na prefix `gradix:queue:*`, daje `+@all` prava osim opasnih (`-@dangerous`), i omogućava `publish`/`subscribe` (potrebno za BullMQ / Socket.IO pub-sub).

```bash
redis-cli \
  -p 6379 \
  --tls \
  --cacert /data/coolify/ssl/redis-core/redis-ca.crt \
  -c \
  "ACL SETUSER gradix-worker on >gradixwork ~gradix:queue:* +@all -@dangerous +publish +subscribe +select +ping +info +client +config"
```

---

## 3. Postavljanje prefixa (`gradix:queue:`) i osnovnih `CONFIG` parametara za BullMQ / radnika

Ako koristiš BullMQ, `prefix` se obično postavlja u aplikaciji (`new Queue('name', { connection: { prefix: 'gradix:queue:' } })`). Ali za ručno postavljanje (`CONFIG SET`) ili provjeru:

```bash
# Provjeri trenutni prefix / konfiguraciju
redis-cli \
  -p 6379 \
  --tls \
  --cacert /data/coolify/ssl/redis-core/redis-ca.crt \
  --user gradix-worker \
  --pass "gradixwork" \
  -c \
  "CONFIG GET *"

# Postavi maksimalno vrijeme zadržavanja za queue radnike (opcionalno — BullMQ koristi `defaultJobOptions` u kodu)
redis-cli \
  -p 6379 \
  --tls \
  --cacert /data/coolify/ssl/redis-core/redis-ca.crt \
  --user gradix-worker \
  --pass "gradixwork" \
  -c \
  "SET gradix:queue:default-delay 0"
```

---

## 4. Kompletna `redis-cli` linija za ručno kreiranje sve potrebne konfiguracije (korisnik + prefix + prava + worker)

Ovo je **konzolidovana komanda** koju možeš pokrenuti ručno (npr. preko `docker exec` ili direktno na hostu) nakon što Coolify podigne `redis` servis:

```bash
# === Kreiraj korisnika gradix-worker ===
redis-cli \
  -p 6379 \
  --tls \
  --cacert /data/coolify/ssl/redis-core/redis-ca.crt \
  -c \
  "ACL SETUSER gradix-worker on >gradixwork ~gradix:queue:* +@all -@dangerous +publish +subscribe +select +ping +info +client +config +acl"

# === Dodaj prefix za BullMQ (ako aplikacija koristi `REDIS_PREFIX`) ===
redis-cli \
  -p 6379 \
  --tls \
  --cacert /data/coolify/ssl/redis-core/redis-ca.crt \
  --user gradix-worker \
  --pass "gradixwork" \
  -c \
  "SET gradix:queue:prefix 'gradix:queue:'"

# === Provjeri da li korisnik ima prava i da li prefix radi ===
redis-cli \
  -p 6379 \
  --tls \
  --cacert /data/coolify/ssl/redis-core/redis-ca.crt \
  --user gradix-worker \
  --pass "gradixwork" \
  -c \
  "AUTH gradix-worker gradixwork" \
  "PING" \
  "KEYS gradix:queue:*"
```

---

## 5. Kako povezati sa aplikacijom (primjer `.env.coolify` za budući BullMQ)

Ako u budućoj fazi dodate BullMQ (`bullmq` paket) ili `ioredis` sa TLS:

```typescript
// Primjer: BullMQ Queue sa TLS i prefixom
import { Queue } from 'bullmq';

const connection = {
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || 'gradixwork',
  tls: {
    ca: fs.readFileSync(process.env.REDIS_TLS_CA_FILE || '/etc/ssl/redis/redis-ca.crt'),
  },
};

export const timerQueue = new Queue('timer', {
  connection,
  prefix: process.env.REDIS_PREFIX || 'gradix:queue:',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  },
});

export const timerWorker = new Worker('timer', async (job) => {
  // Logika za obradu queue zadataka (npr. auto-close timer nakon 12h)
}, { connection, prefix: process.env.REDIS_PREFIX || 'gradix:queue:' });
```

---

## 6. Napomena o TLS certifikatima za Redis (Coolify)

`docker-compose.yml` već mapira:
```yaml
volumes:
  - /data/coolify/ssl/redis-core/redis-ca.crt:/etc/ssl/redis/redis-ca.crt:ro
```

Ako Coolify generiše i Redis `crt` / `key` fajlove (za server), dodajte i:
```yaml
  - redis_tls_certs:/etc/ssl/redis
```

I u `redis` komandi:
```yaml
command: >
  sh -c "redis-server --tls-port 6379 --port 0 --tls-cert-file /etc/ssl/redis/redis.crt --tls-key-file /etc/ssl/redis/redis.key --tls-ca-cert-file /etc/ssl/redis/redis-ca.crt ..."
```

Ovo je uključeno u `docker-compose.yml` (`redis` servis).
