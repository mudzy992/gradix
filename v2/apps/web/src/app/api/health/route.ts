/**
 * Liveness: ne dira bazu (v1 D-037 — pad baze ne smije praviti restart-loop).
 * Ravan JSON bez envelope-a: ovo čita orchestrator, ne aplikacija.
 */
export const dynamic = "force-dynamic";

const startedAt = Date.now();

export function GET(): Response {
  return Response.json({ status: "ok", uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) });
}
