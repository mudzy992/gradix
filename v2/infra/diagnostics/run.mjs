#!/usr/bin/env node
/**
 * Best-effort, secret-safe Redis + S3/MinIO diagnostics for the running container.
 * No web route, external CLI, startup gate, or unbounded retry is used here.
 */
import { lookup } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { randomBytes } from "node:crypto";
import { connect as tlsConnect } from "node:tls";
import { createConnection as tcpConnect } from "node:net";
import { writeSync } from "node:fs";
import { performance } from "node:perf_hooks";

const TOTAL_BUDGET_MS = 9_300;
const startedAt = performance.now();
const state = {
  redis: { host: "", port: 0, tls: false, ca: undefined, socket: null, connected: false },
  s3: { config: null, client: null, presignClient: null, key: null, body: null, bucketReady: false, objectReady: false },
};

const lineSafe = (value) =>
  String(value ?? "")
    .replace(/[\r\n\t]/g, " ")
    .replace(/"/g, "'")
    .slice(0, 600);
const quote = (value) => `"${lineSafe(value)}"`;
const present = (value) => (value ? `present(length=${Buffer.byteLength(value, "utf8")})` : "absent");

function emit(phase, result) {
  const details = Object.entries(result.details ?? {})
    .map(([key, value]) => `${key}=${quote(value)}`)
    .join(" ");
  const line = `phase=${phase} status=${result.status} cause=${result.cause} action=${quote(result.action)}${details ? ` details=${quote(details)}` : ""}\n`;
  try {
    writeSync(1, line);
  } catch {
    // Diagnostics are best-effort even if stdout is unavailable during shutdown.
  }
}

function skip(phase, cause, action, details = {}) {
  emit(phase, { status: "SKIP", cause, action, details });
}

function errorCode(error) {
  return String(error?.code ?? error?.name ?? "unknown_error").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
}

function classifyNetworkError(error, protocol, caMissing = false) {
  const code = errorCode(error);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA") return "dns_not_found_or_unavailable";
  if (code === "ECONNREFUSED") return "tcp_connection_refused";
  if (code === "ETIMEDOUT" || code === "ABORT_ERR" || code === "TimeoutError") return "connection_timeout";
  if (protocol === "tls") {
    if (caMissing) return "ca_absent_in_container_likely_host_path_without_mount";
    if (/CERT|TLS|SSL|VERIFY|SELF_SIGNED|UNABLE_TO/i.test(code)) return "tls_verification_or_handshake_failed";
    return "tls_handshake_failed";
  }
  return "tcp_connection_failed";
}

function hostnameIsPrivate(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".svc")) {
    return true;
  }
  if (!isIP(host)) return !host.includes(".");
  if (isIP(host) === 4) {
    const octets = host.split(".").map(Number);
    return (
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    );
  }
  return host === "::1" || /^f[cd]/i.test(host) || /^fe[89ab]/i.test(host);
}

// REDIS_HOST is a hostname/IP only. Never echo an invalid value: operators occasionally paste
// redis://user:password@host here, which must not leak back into deployment logs.
function safeRedisHost(value) {
  const host = value?.trim() ?? "";
  if (!host || /[\s/@?#]/.test(host)) return "";
  if (isIP(host)) return host;
  return /^[A-Za-z0-9_.-]{1,253}$/.test(host) ? host : "";
}

function parseEndpoint(value, variableName) {
  if (!value) return { error: `${variableName}_missing` };
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "endpoint_scheme_invalid" };
    if (url.username || url.password || url.search || url.hash) return { error: "endpoint_must_not_contain_credentials_or_query" };
    return {
      url,
      hostname: url.hostname.replace(/^\[|\]$/g, ""),
      port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
      protocol: url.protocol,
    };
  } catch {
    return { error: "endpoint_invalid" };
  }
}

async function lookupWithTimeout(host, signal) {
  const lookupPromise = lookup(host, { all: true, verbatim: true });
  return raceAbort(lookupPromise, signal);
}

function raceAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(Object.assign(new Error("aborted"), { code: "ABORT_ERR" }));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(Object.assign(new Error("aborted"), { code: "ABORT_ERR" }));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function openSocket({ host, port, protocol, ca, signal }) {
  const addresses = await lookupWithTimeout(host, signal);
  if (!addresses.length) throw Object.assign(new Error("no address"), { code: "ENODATA", diagnosticDns: true });
  const address = addresses[0].address;
  const options = { host: address, port, ...(ca ? { ca } : {}) };
  let socket;
  if (protocol === "tls") {
    socket = tlsConnect({ ...options, rejectUnauthorized: true, ...(isIP(host) ? {} : { servername: host }) });
  } else {
    socket = tcpConnect(options);
  }
  socket.setNoDelay(true);
  socket.on("error", () => {}); // The active operation owns the error listener; never leak an unhandled socket error.
  await new Promise((resolve, reject) => {
    let settled = false;
    const event = protocol === "tls" ? "secureConnect" : "connect";
    const cleanup = () => {
      socket.off(event, onReady);
      socket.off("error", onError);
      socket.off("close", onClose);
      signal.removeEventListener("abort", onAbort);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onReady = () => finish();
    const onError = (error) => {
      if (protocol === "tls") {
        error.diagnosticCertificate = certificateDetails(socket);
        error.diagnosticVerification = socket.authorizationError || (socket.authorized ? "PASS" : "failed");
      }
      finish(error);
    };
    const onClose = () => finish(Object.assign(new Error("closed"), { code: "ECONNRESET" }));
    const onAbort = () => {
      socket.destroy();
      finish(Object.assign(new Error("aborted"), { code: "ABORT_ERR" }));
    };
    socket.once(event, onReady);
    socket.once("error", onError);
    socket.once("close", onClose);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  return { socket, addresses };
}

function certificateDetails(socket) {
  try {
    const certificate = socket.getPeerCertificate?.();
    if (!certificate || !Object.keys(certificate).length) return {};
    const subject = Object.entries(certificate.subject ?? {})
      .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(",") : value}`)
      .join(",");
    const expires = certificate.valid_to ? new Date(certificate.valid_to).toISOString() : "unknown";
    const expired = certificate.valid_to ? Date.parse(certificate.valid_to) <= Date.now() : false;
    return { tls_subject: subject || "unknown", cert_expires: expires, cert_expired: expired };
  } catch {
    return {};
  }
}

async function runPhase(phase, budgetMs, task) {
  const remainingMs = TOTAL_BUDGET_MS - (performance.now() - startedAt);
  if (remainingMs <= 0) {
    skip(phase, "total_runtime_budget_reached", "Review earlier diagnostics; this phase was skipped to keep startup bounded.");
    return;
  }
  const budget = Math.max(1, Math.min(budgetMs, remainingMs));
  const controller = new AbortController();
  let timedOut = false;
  let timeout;
  const timeoutPromise = new Promise((resolve) => {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolve({ status: "FAIL", cause: "phase_timeout", action: "Check that the endpoint is reachable on the configured port; this probe timed out." });
    }, budget);
    timeout.unref?.();
  });
  try {
    const result = await Promise.race([Promise.resolve().then(() => task(controller.signal)), timeoutPromise]);
    if (!timedOut) emit(phase, result ?? { status: "SKIP", cause: "no_result", action: "Review this diagnostic phase." });
  } catch (error) {
    const cause = error?.diagnosticCause ?? errorCode(error);
    emit(phase, {
      status: "FAIL",
      cause,
      action: error?.diagnosticAction ?? "Check endpoint, network, and credentials; no secret values are shown here.",
      details: error?.diagnosticDetails ?? {},
    });
  } finally {
    clearTimeout(timeout);
    if (!controller.signal.aborted) controller.abort();
  }
}

function redisReplyParser(buffer, offset = 0) {
  if (offset >= buffer.length) return null;
  const type = String.fromCharCode(buffer[offset]);
  const lineEnd = buffer.indexOf("\r\n", offset + 1);
  if (lineEnd < 0) return null;
  const line = buffer.toString("utf8", offset + 1, lineEnd);
  if (type === "+") return { value: line, next: lineEnd + 2 };
  if (type === "-") return { error: true, next: lineEnd + 2 };
  if (type === ":") return { value: Number(line), next: lineEnd + 2 };
  if (type === "$") {
    const length = Number(line);
    if (length === -1) return { value: null, next: lineEnd + 2 };
    const dataStart = lineEnd + 2;
    const dataEnd = dataStart + length;
    if (!Number.isInteger(length) || length < 0 || buffer.length < dataEnd + 2) return null;
    if (buffer[dataEnd] !== 13 || buffer[dataEnd + 1] !== 10) return null;
    return { value: buffer.toString("utf8", dataStart, dataEnd), next: dataEnd + 2 };
  }
  return null;
}

function encodeRedis(parts) {
  return `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join("")}`;
}

function redisCommand(socket, parts, signal) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let settled = false;
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
      signal.removeEventListener("abort", onAbort);
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const parsed = redisReplyParser(buffer);
      if (!parsed) return;
      if (parsed.error) finish(Object.assign(new Error("redis error reply"), { code: "REDIS_REPLY" }));
      else finish(null, parsed.value);
    };
    const onError = (error) => finish(error);
    const onClose = () => finish(Object.assign(new Error("redis socket closed"), { code: "ECONNRESET" }));
    const onAbort = () => {
      socket.destroy();
      finish(Object.assign(new Error("aborted"), { code: "ABORT_ERR" }));
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) return onAbort();
    socket.write(encodeRedis(parts));
  });
}

function sanitizeS3Error(error) {
  const status = Number(error?.$metadata?.httpStatusCode ?? 0);
  const code = String(error?.name ?? error?.Code ?? "");
  if (status === 404 || /NoSuchBucket|NotFound/i.test(code)) return { cause: "bucket_missing", status };
  if (status === 401 || status === 403 || /AccessDenied|InvalidAccessKey|SignatureDoesNotMatch|InvalidToken/i.test(code)) {
    return { cause: "credentials_or_bucket_policy_denied", status };
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|Timeout/i.test(code)) return { cause: "s3_network_unavailable", status };
  return { cause: "s3_request_failed", status };
}

function s3ClientOptions(endpoint, env) {
  return {
    endpoint,
    region: env.MINIO_REGION?.trim() || "us-east-1",
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: {
      accessKeyId: env.MINIO_ACCESS_KEY,
      secretAccessKey: env.MINIO_SECRET_KEY,
    },
  };
}

function browserObjectUrl(endpoint, bucket, key) {
  const url = new URL(endpoint);
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${encodeURIComponent(bucket)}/${encodedKey}`;
  url.search = "";
  url.hash = "";
  return url;
}

function corsOriginMatches(response, expectedOrigin) {
  const allowed = response.headers.get("access-control-allow-origin");
  return allowed === expectedOrigin || allowed === "*";
}

function hasHeaderToken(header, token) {
  return (header ?? "").split(",").map((value) => value.trim().toLowerCase()).includes(token.toLowerCase()) || (header ?? "").includes("*");
}

function parseWebOrigin(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) return "";
    return url.origin;
  } catch {
    return "";
  }
}

async function main() {
  const env = process.env;
  const redisHostInput = env.REDIS_HOST?.trim() ?? "";
  const redisHost = safeRedisHost(redisHostInput);
  const redisHostInvalid = Boolean(redisHostInput && !redisHost);
  const redisPort = Number(env.REDIS_PORT || 6380);
  const redisUser = env.REDIS_USER?.trim() ?? "";
  const redisPassword = env.REDIS_PASSWORD ?? "";
  const redisCaPath = env.REDIS_TLS_CA_FILE?.trim() ?? "";
  const redisPrefix = env.REDIS_PREFIX?.trim() ?? "";
  const redisTls = redisPort === 6380 || Boolean(redisCaPath);
  state.redis.host = redisHost;
  state.redis.port = redisPort;
  state.redis.tls = redisTls;

  let caReadable = "not_configured";
  if (redisCaPath) {
    try {
      state.redis.ca = readFileSync(redisCaPath);
      caReadable = state.redis.ca.length > 0 ? "yes" : "empty";
    } catch {
      caReadable = "no";
    }
  }
  const appBehavior = "application_redis_usage=none; login_rate_limit=postgres_login_attempt_functions; database_failure=login_fails_closed; redis_outage_policy=not_applicable";
  if (redisHostInvalid) {
    emit("redis.config", {
      status: "FAIL", cause: "redis_host_format_invalid",
      action: "Set REDIS_HOST to a hostname or IP only (no redis:// URL, credentials, path, or port); the supplied value is intentionally not logged.",
      details: {
        REDIS_HOST: present(redisHostInput), REDIS_PORT: present(env.REDIS_PORT), REDIS_USER: present(redisUser),
        REDIS_PASSWORD: present(redisPassword), REDIS_TLS_CA_FILE: redisCaPath ? `present(path_length=${Buffer.byteLength(redisCaPath)},readable=${caReadable})` : "absent",
        REDIS_PREFIX: redisPrefix || "absent", application: appBehavior,
      },
    });
  } else if (!redisHost) {
    if (redisCaPath && caReadable !== "yes") {
      emit("redis.config", {
        status: "FAIL", cause: "ca_absent_in_container_likely_host_path_without_mount",
        action: "Mount the host Redis CA into the app container and set REDIS_TLS_CA_FILE to the readable in-container path.",
        details: { REDIS_HOST: "absent", REDIS_TLS_CA_FILE: `present(path_length=${Buffer.byteLength(redisCaPath)},readable=no)`, application: appBehavior },
      });
    } else {
      skip("redis.config", "redis_host_not_configured", "Set REDIS_HOST only when Redis is intended to be available.", {
        REDIS_HOST: present(redisHost), REDIS_PORT: present(env.REDIS_PORT), REDIS_USER: present(redisUser),
        REDIS_PASSWORD: present(redisPassword), REDIS_TLS_CA_FILE: redisCaPath ? `present(path_length=${Buffer.byteLength(redisCaPath)},readable=${caReadable})` : "absent",
        REDIS_PREFIX: redisPrefix || "absent", application: appBehavior,
      });
    }
  } else if (!Number.isInteger(redisPort) || redisPort < 1 || redisPort > 65535) {
    emit("redis.config", { status: "FAIL", cause: "redis_port_invalid", action: "Set REDIS_PORT to a valid TCP port.", details: { application: appBehavior } });
  } else if (redisCaPath && caReadable !== "yes") {
    emit("redis.config", {
      status: "FAIL", cause: "ca_absent_in_container_likely_host_path_without_mount",
      action: "Bind-mount the host Redis CA into the app container at /etc/ssl/certs/redis/redis-ca.crt and set REDIS_TLS_CA_FILE to that container path.",
      details: {
        REDIS_HOST: `present(length=${Buffer.byteLength(redisHost)})`, REDIS_PORT: redisPort,
        REDIS_USER: present(redisUser), REDIS_PASSWORD: present(redisPassword),
        REDIS_TLS_CA_FILE: `present(path_length=${Buffer.byteLength(redisCaPath)},readable=no)`,
        REDIS_PREFIX: redisPrefix || "absent", application: appBehavior,
      },
    });
  } else {
    emit("redis.config", {
      status: "PASS", cause: "redis_config_present", action: "No configuration action required; Redis checks remain informational.",
      details: {
        REDIS_HOST: `present(length=${Buffer.byteLength(redisHost)})`, REDIS_PORT: redisPort,
        REDIS_USER: present(redisUser), REDIS_PASSWORD: present(redisPassword),
        REDIS_TLS_CA_FILE: redisCaPath ? `present(path_length=${Buffer.byteLength(redisCaPath)},readable=${caReadable})` : "absent(system trust store)",
        REDIS_PREFIX: redisPrefix || "absent", diag_key_prefix: `${redisPrefix}diag:`, application: appBehavior,
      },
    });
  }

  await runPhase("redis.connection", 1_350, async (signal) => {
    if (redisHostInvalid) return { status: "SKIP", cause: "redis_host_format_invalid", action: "Resolve redis.config; the supplied host value is intentionally not logged." };
    if (!redisHost) return { status: "SKIP", cause: "redis_host_not_configured", action: "Set REDIS_HOST to enable DNS, TCP, and TLS diagnostics." };
    let addresses;
    try {
      addresses = await lookupWithTimeout(redisHost, signal);
    } catch (error) {
      return {
        status: "FAIL", cause: errorCode(error) === "ENOTFOUND" ? "redis_dns_not_found_same_stack_network" : "redis_dns_unavailable",
        action: "Check that the app is on the Redis network and REDIS_HOST is the Redis service hostname, not localhost or a public URL.",
        details: { host: redisHost, dns: errorCode(error) },
      };
    }
    if (!addresses.length) return { status: "FAIL", cause: "redis_dns_no_addresses", action: "Check Redis DNS and same-network membership.", details: { host: redisHost } };
    try {
      const protocol = redisTls ? "tls" : "tcp";
      const { socket } = await openSocket({ host: redisHost, port: redisPort, protocol, ca: state.redis.ca, signal });
      state.redis.socket = socket;
      state.redis.connected = true;
      if (redisTls && !socket.authorized) {
        const details = certificateDetails(socket);
        socket.destroy();
        state.redis.socket = null;
        state.redis.connected = false;
        return {
          status: "FAIL", cause: state.redis.ca ? "redis_tls_certificate_verification_failed" : "redis_tls_ca_not_trusted",
          action: "Mount the correct Redis CA at /etc/ssl/certs/redis/redis-ca.crt and set REDIS_TLS_CA_FILE to that in-container path.",
          details: { dns: "PASS", tcp: "PASS", tls: "PASS", verification: socket.authorizationError || "failed", ...details },
        };
      }
      const certificate = redisTls ? certificateDetails(socket) : {};
      return {
        status: "PASS", cause: "redis_endpoint_reachable", action: "No network action required.",
        details: {
          host: redisHost, dns: `PASS(${addresses.length} address${addresses.length === 1 ? "" : "es"})`, tcp: "PASS",
          tls: redisTls ? "PASS" : "SKIP(plaintext port)", verification: redisTls ? "PASS" : "not_applicable",
          ...certificate,
        },
      };
    } catch (error) {
      const caMissing = Boolean(redisCaPath && !state.redis.ca);
      const cause = classifyNetworkError(error, redisTls ? "tls" : "tcp", caMissing);
      return {
        status: "FAIL", cause,
        action: cause.startsWith("ca_absent") || cause.includes("tls")
          ? "Check REDIS_TLS_CA_FILE, the host bind mount, the Redis TLS port, and certificate hostname/expiry."
          : "Check Redis container status, port, and shared network; diagnostics do not block startup.",
        details: {
          host: redisHost, dns: "PASS", tcp: errorCode(error) === "ECONNREFUSED" ? "FAIL" : "connected_or_attempted",
          tls: redisTls ? "FAIL" : "not_configured", verification: error?.diagnosticVerification || "not_established",
          error_code: errorCode(error), ...(error?.diagnosticCertificate ?? {}),
        },
      };
    }
  });

  await runPhase("redis.auth_rw", 1_800, async (signal) => {
    if (redisHostInvalid) return { status: "SKIP", cause: "redis_host_format_invalid", action: "Resolve redis.config before Redis authentication and key tests." };
    if (!redisHost) return { status: "SKIP", cause: "redis_host_not_configured", action: "Set REDIS_HOST to enable Redis authentication and key tests." };
    if (!state.redis.connected || !state.redis.socket) return { status: "SKIP", cause: "redis_connection_unavailable", action: "Resolve redis.connection first; startup remains non-blocking." };
    const socket = state.redis.socket;
    let stage = "auth";
    try {
      if (redisPassword) {
        const auth = redisUser ? ["AUTH", redisUser, redisPassword] : ["AUTH", redisPassword];
        const reply = await redisCommand(socket, auth, signal);
        if (reply !== "OK") throw Object.assign(new Error("unexpected auth reply"), { code: "REDIS_AUTH_REPLY" });
      }
      stage = "ping";
      const ping = await redisCommand(socket, ["PING"], signal);
      if (ping !== "PONG") throw Object.assign(new Error("unexpected ping reply"), { code: "REDIS_PING_REPLY" });
      const key = `${redisPrefix}diag:${randomBytes(12).toString("hex")}`;
      const value = randomBytes(16).toString("hex");
      state.redis.key = key;
      stage = "set";
      if (await redisCommand(socket, ["SET", key, value, "PX", "30000", "NX"], signal) !== "OK") {
        throw Object.assign(new Error("set not accepted"), { code: "REDIS_SET_REPLY" });
      }
      stage = "ttl";
      const ttl = Number(await redisCommand(socket, ["PTTL", key], signal));
      if (!Number.isFinite(ttl) || ttl <= 0 || ttl > 30_000) throw Object.assign(new Error("ttl invalid"), { code: "REDIS_TTL_REPLY" });
      stage = "get";
      const readBack = await redisCommand(socket, ["GET", key], signal);
      if (readBack !== value) throw Object.assign(new Error("value mismatch"), { code: "REDIS_GET_REPLY" });
      stage = "delete";
      const deleted = Number(await redisCommand(socket, ["DEL", key], signal));
      if (deleted !== 1) throw Object.assign(new Error("delete count invalid"), { code: "REDIS_DEL_REPLY" });
      state.redis.key = null;
      return {
        status: "PASS", cause: "redis_auth_ping_and_prefixed_rw_ok", action: "No Redis connectivity action required; the application currently does not use Redis.",
        details: { auth: redisPassword ? "PASS" : "SKIP(no password configured)", ping: "PASS", prefixed_set: "PASS", ttl_ms: ttl, get: "PASS", delete: "PASS", key_prefix: `${redisPrefix}diag:` },
      };
    } catch (error) {
      const authFailed = stage === "auth";
      if (state.redis.key) {
        await redisCommand(socket, ["DEL", state.redis.key], AbortSignal.timeout(150)).catch(() => undefined);
        state.redis.key = null;
      }
      socket.destroy();
      state.redis.socket = null;
      state.redis.connected = false;
      return {
        status: "FAIL", cause: authFailed ? "redis_auth_or_acl_failed" : stage === "ping" ? "redis_ping_failed" : `redis_${stage}_failed`,
        action: authFailed
          ? "Check REDIS_USER and REDIS_PASSWORD against the Redis ACL; values are never printed."
          : "Check Redis ACL permissions for PING, SET, PTTL, GET, and DEL on REDIS_PREFIX*.",
        details: { stage, error_code: errorCode(error), prefix: `${redisPrefix}diag:` },
      };
    }
  });

  const endpointText = env.MINIO_ENDPOINT?.trim() ?? "";
  const publicEndpointText = env.MINIO_PUBLIC_ENDPOINT?.trim() ?? "";
  const bucket = env.MINIO_BUCKET?.trim() || "gradix-stg";
  const region = env.MINIO_REGION?.trim() || "us-east-1";
  const accessKey = env.MINIO_ACCESS_KEY?.trim() ?? "";
  const secretKey = env.MINIO_SECRET_KEY ?? "";
  const corsOriginInput = env.MINIO_CORS_ALLOWED_ORIGIN?.trim() ?? "";
  const corsOrigin = parseWebOrigin(corsOriginInput);
  const endpoint = parseEndpoint(endpointText, "MINIO_ENDPOINT");
  const publicEndpoint = parseEndpoint(publicEndpointText, "MINIO_PUBLIC_ENDPOINT");
  state.s3.config = { endpoint, publicEndpoint, bucket, region, accessKey, secretKey, corsOrigin };
  const endpointHost = endpoint.url?.hostname?.replace(/^\[|\]$/g, "") ?? "unknown";
  if (!endpointText && !accessKey && !secretKey) {
    skip("s3.config", "s3_not_configured", "Set MINIO_ENDPOINT, MINIO_BUCKET, and the app access keys when object storage is needed.", {
      MINIO_ENDPOINT: "absent", MINIO_BUCKET: bucket, MINIO_ACCESS_KEY: present(accessKey), MINIO_SECRET_KEY: present(secretKey),
      MINIO_REGION: region, MINIO_PUBLIC_ENDPOINT: publicEndpointText ? "present" : "absent", attachment_prefix: "gx2/", diagnostic_prefix: "gradix:diag/",
    });
  } else if (endpoint.error) {
    emit("s3.config", { status: "FAIL", cause: endpoint.error, action: "Set MINIO_ENDPOINT to an http(s) endpoint without embedded credentials, query, or fragment.", details: { MINIO_BUCKET: bucket, MINIO_ACCESS_KEY: present(accessKey), MINIO_SECRET_KEY: present(secretKey) } });
  } else if (!accessKey || !secretKey) {
    emit("s3.config", { status: "FAIL", cause: "s3_app_credentials_incomplete", action: "Set MINIO_ACCESS_KEY and MINIO_SECRET_KEY in Coolify secrets; values are never printed.", details: { endpoint_host: endpointHost, MINIO_BUCKET: bucket, MINIO_ACCESS_KEY: present(accessKey), MINIO_SECRET_KEY: present(secretKey), MINIO_REGION: region } });
  } else {
    emit("s3.config", {
      status: "PASS", cause: "s3_config_present", action: "No internal endpoint action required; browser presigning is checked separately.",
      details: {
        endpoint_scheme: endpoint.url.protocol.replace(":", ""), endpoint_host: endpointHost, endpoint_port: endpoint.port,
        MINIO_BUCKET: bucket, MINIO_ACCESS_KEY: present(accessKey), MINIO_SECRET_KEY: present(secretKey), MINIO_REGION: region,
        MINIO_PUBLIC_ENDPOINT: publicEndpoint.url ? `${publicEndpoint.url.protocol.replace(":", "")}://${publicEndpoint.url.hostname}` : "absent",
        attachment_prefix: "gx2/", diagnostic_prefix: "gradix:diag/", MINIO_CORS_ALLOWED_ORIGIN: corsOrigin ? "present" : "absent",
      },
    });
  }

  await runPhase("s3.connection", 1_350, async (signal) => {
    if (endpoint.error) return { status: "SKIP", cause: "s3_endpoint_not_configured_or_invalid", action: "Resolve s3.config before testing MinIO DNS and TCP." };
    let addresses;
    try {
      addresses = await lookupWithTimeout(endpoint.hostname, signal);
    } catch (error) {
      return {
        status: "FAIL", cause: errorCode(error) === "ENOTFOUND" ? "s3_dns_not_found_same_stack_network" : "s3_dns_unavailable",
        action: "For this Compose stack use MINIO_ENDPOINT=http://minio:9000 and keep web and minio on the same default network.",
        details: { endpoint_host: endpoint.hostname, dns: errorCode(error) },
      };
    }
    if (!addresses.length) return { status: "FAIL", cause: "s3_dns_no_addresses", action: "Check MinIO service DNS and same-stack network membership.", details: { endpoint_host: endpoint.hostname } };
    try {
      const protocol = endpoint.protocol === "https:" ? "tls" : "tcp";
      const { socket } = await openSocket({ host: endpoint.hostname, port: endpoint.port, protocol, signal });
      const cert = protocol === "tls" ? certificateDetails(socket) : {};
      socket.destroy();
      return {
        status: "PASS", cause: "s3_endpoint_reachable", action: "No internal endpoint action required.",
        details: { endpoint_host: endpoint.hostname, dns: `PASS(${addresses.length} address${addresses.length === 1 ? "" : "es"})`, tcp: "PASS", tls: protocol === "tls" ? "PASS" : "SKIP(http endpoint)", verification: protocol === "tls" ? "PASS" : "not_applicable", ...cert },
      };
    } catch (error) {
      const protocol = endpoint.protocol === "https:" ? "tls" : "tcp";
      const cause = classifyNetworkError(error, protocol);
      return {
        status: "FAIL", cause: `s3_${cause}`,
        action: protocol === "tls" ? "Check the MinIO HTTPS certificate and public/private CA trust." : "Check MinIO service health, port 9000, and shared Compose network.",
        details: {
          endpoint_host: endpoint.hostname, dns: "PASS", tcp: errorCode(error) === "ECONNREFUSED" ? "FAIL" : "connected_or_attempted",
          tls: protocol === "tls" ? "FAIL" : "not_configured", verification: error?.diagnosticVerification || "not_established",
          error_code: errorCode(error), ...(error?.diagnosticCertificate ?? {}),
        },
      };
    }
  });

  await runPhase("s3.bucket_object", 1_900, async (signal) => {
    if (endpoint.error || !accessKey || !secretKey) return { status: "SKIP", cause: "s3_config_incomplete", action: "Set the app endpoint and access keys before checking the bucket." };
    try {
      const [{ S3Client, HeadBucketCommand, PutObjectCommand, GetObjectCommand }] = await Promise.all([
        import("@aws-sdk/client-s3"),
      ]);
      const client = new S3Client(s3ClientOptions(endpointText, env));
      state.s3.client = client;
      await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: signal });
      state.s3.bucketReady = true;
      const key = `gradix:diag/${randomBytes(12).toString("hex")}.png`;
      const body = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQX8AAAAASUVORK5CYII=", "base64");
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "image/png" }), { abortSignal: signal });
      state.s3.key = key;
      state.s3.body = body;
      const get = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal });
      const downloaded = Buffer.from(await get.Body.transformToByteArray());
      if (!downloaded.equals(body) || get.ContentType !== "image/png") {
        throw Object.assign(new Error("object verification mismatch"), { name: "ObjectIntegrityMismatch" });
      }
      state.s3.objectReady = true;
      return { status: "PASS", cause: "credentials_bucket_and_object_rw_ok", action: "No S3/MinIO credential or bucket action required.", details: { head_bucket: "PASS(bucket exists and credentials accepted)", put: "PASS", get: "PASS(content and type verified)", delete: "pending browser phase cleanup", bucket: bucket, diagnostic_prefix: "gradix:diag/" } };
    } catch (error) {
      const classified = sanitizeS3Error(error);
      return {
        status: "FAIL", cause: classified.cause,
        action: classified.cause === "bucket_missing"
          ? `Create bucket ${bucket} on the isolated staging MinIO service; diagnostics never auto-create buckets.`
          : classified.cause === "credentials_or_bucket_policy_denied"
            ? "Check the Coolify MinIO app keys and bucket-scoped policy; do not paste secret values into logs."
            : "Check MinIO DNS, service health, access policy, and endpoint; the application still starts.",
        details: { head_bucket: classified.status ? `HTTP ${classified.status}` : "failed", error_code: errorCode(error), bucket },
      };
    }
  });

  await runPhase("s3.browser_cors", 2_250, async (signal) => {
    const config = state.s3.config;
    const key = state.s3.key;
    let result = { status: "SKIP", cause: "bucket_object_test_unavailable", action: "Resolve s3.bucket_object before direct attachment checks." };
    if (state.s3.bucketReady && key && state.s3.client) {
      try {
        if (!publicEndpoint.url) {
          result = {
            status: "FAIL", cause: publicEndpoint.error === "MINIO_PUBLIC_ENDPOINT_missing" ? "browser_endpoint_missing" : publicEndpoint.error,
            action: "Set MINIO_PUBLIC_ENDPOINT to the Coolify-routed HTTPS hostname reachable by browsers; never use the internal minio hostname.",
            details: { bucket: config.bucket, diagnostic_prefix: "gradix:diag/" },
          };
        } else {
          const publicHost = publicEndpoint.hostname;
          const browserReachable = !hostnameIsPrivate(publicHost) && publicEndpoint.url.protocol === "https:";
          if (!browserReachable) {
            result = {
              status: "FAIL", cause: "browser_endpoint_internal_or_not_https",
              action: "Route MinIO through Coolify on a browser-reachable HTTPS hostname and set MINIO_PUBLIC_ENDPOINT to that URL.",
              details: { presigned_host: publicHost, browser_host: "internal_or_http", diagnostic_prefix: "gradix:diag/" },
            };
          } else if (!config.corsOrigin) {
            result = {
              status: "FAIL", cause: "cors_origin_not_configured_or_invalid",
              action: "Set MINIO_CORS_ALLOWED_ORIGIN to the web app's exact HTTPS origin (origin only, no path) and apply it to the bucket.",
              details: { presigned_host: publicHost, browser_host: "public_https", diagnostic_prefix: "gradix:diag/" },
            };
          } else {
            const [{ S3Client, GetObjectCommand, PutObjectCommand }, { getSignedUrl }] = await Promise.all([
              import("@aws-sdk/client-s3"),
              import("@aws-sdk/s3-request-presigner"),
            ]);
            const publicClient = new S3Client(s3ClientOptions(publicEndpointText, env));
            state.s3.presignClient = publicClient;
            const origin = config.corsOrigin;
            const publicObjectUrl = browserObjectUrl(publicEndpointText, config.bucket, key);
            const signedPutUrl = await getSignedUrl(
              publicClient,
              new PutObjectCommand({ Bucket: config.bucket, Key: key, ContentType: "image/png" }),
              { expiresIn: 60 },
            );
            const signedPut = new URL(signedPutUrl);
            if (signedPut.hostname !== publicHost) throw Object.assign(new Error("presigned host mismatch"), { name: "PresignedHostMismatch" });

            const preflight = await fetch(publicObjectUrl, {
              method: "OPTIONS",
              headers: { Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" },
              signal,
            });
            const corsMethods = preflight.headers.get("access-control-allow-methods");
            const corsHeaders = preflight.headers.get("access-control-allow-headers");
            const corsPutPass = preflight.ok && corsOriginMatches(preflight, origin) &&
              hasHeaderToken(corsMethods, "PUT") && hasHeaderToken(corsHeaders, "content-type");

            const putResponse = await fetch(signedPutUrl, {
              method: "PUT",
              headers: { Origin: origin, "Content-Type": "image/png" },
              body: state.s3.body,
              signal,
            });
            const putPass = putResponse.ok && corsOriginMatches(putResponse, origin);

            const signedGetUrl = await getSignedUrl(
              publicClient,
              new GetObjectCommand({
                Bucket: config.bucket,
                Key: key,
                ResponseContentDisposition: 'inline; filename="gradix-diagnostic.png"',
                ResponseContentType: "image/png",
              }),
              { expiresIn: 60 },
            );
            const signedGet = new URL(signedGetUrl);
            if (signedGet.hostname !== publicHost) throw Object.assign(new Error("presigned host mismatch"), { name: "PresignedHostMismatch" });
            const response = await fetch(signedGetUrl, { headers: { Origin: origin }, signal });
            const disposition = response.headers.get("content-disposition") ?? "";
            const contentType = response.headers.get("content-type") ?? "";
            const expose = response.headers.get("access-control-expose-headers") ?? "";
            const responseBody = Buffer.from(await response.arrayBuffer());
            const getPass = response.status === 200 && responseBody.equals(state.s3.body) && corsOriginMatches(response, origin);
            const headersPass = /inline/i.test(disposition) && contentType.toLowerCase().startsWith("image/png") &&
              hasHeaderToken(expose, "content-disposition") && hasHeaderToken(expose, "content-type");
            const allPass = corsPutPass && putPass && getPass && headersPass;
            result = {
              status: allPass ? "PASS" : "FAIL",
              cause: allPass ? "browser_presigned_put_get_cors_and_inline_headers_ok" :
                !corsPutPass ? "cors_put_preflight_failed" : !putPass ? "presigned_put_failed" : !getPass ? "presigned_get_or_cors_failed" : "inline_display_headers_missing",
              action: allPass ? "No browser endpoint action required." :
                !corsPutPass ? "Apply bucket CORS for the exact web origin, PUT, and Content-Type request header." :
                  !putPass ? "Check the Coolify MinIO public route and PUT-signing app policy; the direct upload probe failed." :
                    !getPass ? "Check public GET routing, CORS origin matching, and the app's bucket-scoped GetObject policy." :
                      "Keep Content-Disposition inline and expose Content-Disposition and Content-Type in MinIO CORS.",
              details: {
                presigned_host: publicHost, browser_host: "public_https",
                cors_put_preflight: corsPutPass ? "PASS" : `FAIL(${preflight.status})`,
                cors_origin_match: corsOriginMatches(preflight, origin), presigned_put: putResponse.status,
                presigned_put_cors: putPass ? "PASS" : "FAIL", presigned_get: response.status,
                presigned_get_cors: corsOriginMatches(response, origin) ? "PASS" : "FAIL",
                response_type: contentType.split(";")[0] || "absent",
                content_disposition: /inline/i.test(disposition) ? "inline" : "missing_or_attachment",
                exposed_display_headers: headersPass ? "PASS" : "FAIL", diagnostic_prefix: "gradix:diag/",
              },
            };
          }
        }
      } catch (error) {
        const classified = sanitizeS3Error(error);
        result = {
          status: "FAIL", cause: error?.name === "PresignedHostMismatch" ? "presigned_host_mismatch" : classified.cause,
          action: "Check MINIO_PUBLIC_ENDPOINT routing, TLS, bucket CORS, and inline display headers; never log a presigned URL.",
          details: { public_host: publicEndpoint.hostname || "unknown", error_code: errorCode(error), diagnostic_prefix: "gradix:diag/" },
        };
      } finally {
        try {
          const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
          await state.s3.client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }), { abortSignal: AbortSignal.timeout(350) });
          state.s3.key = null;
        } catch {
          // Expiry is not available for S3 objects; a failed cleanup is visible in the final line.
          result.details = { ...(result.details ?? {}), cleanup: "FAIL(retry delete or remove gradix:diag/ objects)" };
          if (result.status === "PASS") {
            result.status = "FAIL";
            result.cause = "diagnostic_object_cleanup_failed";
            result.action = "Remove the small object under gradix:diag/; check DeleteObject permission for the app key.";
          }
        }
      }
    }
    return result;
  });

  if (state.redis.socket && !state.redis.socket.destroyed) state.redis.socket.destroy();
  state.s3.client?.destroy?.();
  state.s3.presignClient?.destroy?.();
}

try {
  await main();
} catch {
  emit("diagnostics.internal", { status: "FAIL", cause: "unexpected_diagnostic_error", action: "Review the named phase; this tool never blocks startup or prints secrets." });
} finally {
  if (state.redis.socket && !state.redis.socket.destroyed) state.redis.socket.destroy();
  state.s3.client?.destroy?.();
  state.s3.presignClient?.destroy?.();
}
