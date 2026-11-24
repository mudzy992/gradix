/**
 * Poslovi Faze 0 — SAMO `ping.health` i `notifications.deliver`.
 *
 * Ostala četiri posla iz spec 12 §13 (`reminders.scan`, `budget.thresholds`,
 * `attachments.purge`, `sync.purge`) dolaze sa svojim modulima, jer traže tabele koje još
 * ne postoje. Registracija imena poslova je ipak sada: kad modul doda posao, mijenja se
 * `JOB_NAMES`, ne infrastruktura.
 *
 * Pravilo za svaki posao: **idempotentan** (spec 12 §14). Pad i ponovni prolaz ne smiju
 * napraviti duplu poruku ni dupli trošak.
 */

export const JOB_NAMES = {
  pingHealth: "ping.health",
  notificationsDeliver: "notifications.deliver",
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

export type JobLogger = {
  info: (message: string, details?: Record<string, unknown>) => void;
  warn: (message: string, details?: Record<string, unknown>) => void;
  error: (message: string, details?: Record<string, unknown>) => void;
};

/**
 * `ping.health` — kanarinac. Ako ovaj posao ne prođe, red je pokvaren i niko to ne zna;
 * zato `/api/health` čita njegov zadnji uspjeh, a ne samo „proces je živ“.
 */
export function pingHealth(logger: JobLogger) {
  return async (): Promise<{ ok: true; at: string }> => {
    const at = new Date().toISOString();
    logger.info("ping.health", { at });
    return { ok: true, at };
  };
}
