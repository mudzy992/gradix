/**
 * Poslovi — imena i registracija na jednom mjestu.
 *
 * Faza 0: `ping.health`, `notifications.deliver`.
 * Faza 2: `reminders.scan` (dnevni prolaz kroz rokove) i `attachments.purge` (retencija).
 *
 * Ostali (`budget.thresholds`, `sync.purge`) dolaze sa svojim modulima, jer traže tabele koje
 * još ne postoje.
 *
 * Pravilo za svaki posao: **idempotentan** (spec 12 §14). Pad i ponovni prolaz ne smiju
 * napraviti duplu poruku ni dupli trošak.
 */

export const JOB_NAMES = {
  pingHealth: "ping.health",
  notificationsDeliver: "notifications.deliver",
  /** F2: podsjetnici na rokove, 06:00 u zoni firme. */
  remindersScan: "reminders.scan",
  /** F2: brisanje priloga po retenciji (24 mj. osjetljivi / 10 g. ostali). */
  attachmentsPurge: "attachments.purge",
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
