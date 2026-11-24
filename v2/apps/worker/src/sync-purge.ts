/**
 * `sync.purge` — brisanje tijela sukoba po retenciji (spec 03 §1.6.30).
 *
 * Sukob čuva `received_payload` (šta je telefon poslao) dok god je `OPEN`, jer bez toga ured ne
 * može da razriješi. Kad se razriješi, tijelo više nije potrebno — ostaje odluka, razlog i
 * vremena, a sadržaj zahtjeva se briše u roku koji firma traži.
 *
 * Tri pravila:
 *  1. **Briše se samo `payload`, ne red.** Red je dokaz da je sukob postojao i da je razriješen;
 *     brisanje reda bi izbrisalo i odgovor na pitanje „ko je i kada odlučio“.
 *  2. **`OPEN` sukob se nikad ne čisti**, ma koliko star bio. Neprocijenjen sukob je otvoren
 *     problem, a ne star podatak — brisanjem bi ured izgubio ono što tek treba da vidi.
 *  3. **`payload_purged_at` postavlja BAZA, ne posao.** Triger `sync_conflicts_history_guard`
 *     ima jedan namjenski prolaz: kad `received_payload` ide u `NULL`, a `payload_purge_after` je
 *     istekao, baza sama upiše `payload_purged_at` i očisti `resolution_payload`. Posao zato šalje
 *     samo `received_payload = NULL` — ako bi pisao i `payload_purged_at`, guard bi ga odbio kao
 *     neovlaštenu izmjenu zapisane odluke.
 *
 * Posao je idempotentan: drugi prolaz nalazi 0 kandidata i to je uspjeh.
 */
import type { Pool } from "pg";

export type SyncPurgeOutcome = {
  /** Koliko je redova imalo istekao rok i tijelo. */
  candidates: number;
  /** Koliko je stvarno očišćeno. */
  purged: number;
  /** Redovi čije je tijelo već očišćeno — normalno stanje, ne greška. */
  alreadyClean: number;
};

/**
 * Podrazumjevana retencija je 90 dana od razrješenja.
 *
 * Zašto od razrješenja, a ne od nastanka: sukob koji je stajao 60 dana nerazriješen i juče
 * razriješen mora ostati čitljiv još 90 dana, jer je tek juče postao dokaz odluke.
 */
export const DEFAULT_SYNC_PAYLOAD_RETENTION_DAYS = 90;

export async function purgeSyncPayloads(
  pool: Pool,
  options: {
    logger: { info: (message: string, details?: Record<string, unknown>) => void; warn: (message: string, details?: Record<string, unknown>) => void };
    retentionDays?: number;
    now?: Date;
  },
): Promise<SyncPurgeOutcome> {
  const retentionDays = options.retentionDays ?? DEFAULT_SYNC_PAYLOAD_RETENTION_DAYS;
  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    // Loša postavka ne smije tiho obrisati sve: radije ne radi ništa i prijavi.
    options.logger.warn("sync.purge: neispravna retencija — posao preskočen", { retentionDays });
    return { candidates: 0, purged: 0, alreadyClean: 0 };
  }
  // `retentionDays` ostaje parametar zbog pozivaoca koji ga prosljeđuje, ali rok čita BAZA iz
  // `payload_purge_after` (upisan pri razrješenju). Jedina istina o roku je tamo.
  const before = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM sync_conflicts c
      WHERE c.status = 'RESOLVED'
        AND c.received_payload IS NOT NULL
        AND c.payload_purged_at IS NULL
        AND c.payload_purge_after <= clock_timestamp()`,
    [],
  );
  const candidates = Number(before.rows[0]?.n ?? 0);

  if (candidates === 0) {
    options.logger.info("sync.purge: nema tijela za brisanje", { retentionDays });
    return { candidates: 0, purged: 0, alreadyClean: 0 };
  }

  /*
   * `UPDATE` umjesto `DELETE`: tijelo odlazi, red i odluka ostaju. Uslov `status = 'RESOLVED'`
   * je i ovdje, ne samo u brojanju — između dva upita sukob može biti ponovo otvoren, a tada
   * tijelo mora ostati.
   *
   * `payload_purged_at` se NE piše: namjenski prolaz guarda to radi sam, i samo pod uslovom da je
   * rok istekao. Da ga pišemo ovdje, guard bi posao odbio kao izmjenu zapisane odluke.
   */
  const purged = await pool.query(
    `UPDATE sync_conflicts
        SET received_payload = NULL
      WHERE status = 'RESOLVED'
        AND received_payload IS NOT NULL
        AND payload_purged_at IS NULL
        AND payload_purge_after <= clock_timestamp()`,
  );

  const result: SyncPurgeOutcome = {
    candidates,
    purged: purged.rowCount ?? 0,
    alreadyClean: candidates - (purged.rowCount ?? 0),
  };
  options.logger.info("sync.purge: tijela sukoba očišćena", { ...result, retentionDays });
  return result;
}
