/**
 * Moji rokovi (R2b) — SAMO ČITANJE, po planu (§6).
 *
 * Zašto čitanje, a ne unos: R2 nema radne sate ni ture, pa terenski čovjek nema šta da upiše
 * osim onoga što ured već unosi. Pisanje na terenu dolazi u R4/R5 sa offline redom.
 *
 * Offline: zadnji preuzet spisak ostaje na uređaju. Ekran zato UVIJEK prvo pokaže lokalnu
 * kopiju (i kad nema veze), pa je osvježi kad veza postoji — nikad prazan ekran zbog mreže.
 */
import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import { myObligations } from "../api/client";
import { openDb, readObligations, saveObligations, type LocalObligation } from "../db/sqlite";
import { Button, CardView, Screen, StatusChip, Text } from "../ui";

/**
 * Nazivi stanja — isti tekst kao na webu i u domeni.
 *
 * `missing` se ne pojavljuje u ovoj listi (radnik vidi samo SVOJE redove, a „nedostaje“ je
 * pojam ureda), ali `rejected` i `pending_review` se pojavljuju i MORAJU biti prevedeni: bez
 * toga bi radnik vidio `rejected` na ekranu i pomislio da je greška u aplikaciji.
 */
const STATE_LABEL: Record<string, string> = {
  missing: "Nedostaje",
  expired: "Isteklo",
  rejected: "Odbijeno",
  pending_review: "Čeka provjeru",
  expiring: "Uskoro istječe",
  review_due: "Provjera dospjela",
  valid: "Važeće",
  no_expiry: "Bez roka",
  superseded: "Zamijenjeno",
};

/**
 * Koja stanja traže radnju: isteklo i odbijeno BLOKIRAJU rad (spec 02 §15), pa idu crveno.
 * `expiring` i `review_due` su upozorenja; `pending_review` je posao ureda, a ne radnika.
 */
function stateTone(state: string): "plain" | "warn" | "danger" {
  if (state === "expired" || state === "rejected") return "danger";
  if (state === "expiring" || state === "review_due") return "warn";
  return "plain";
}

/** „od prije 2 sata“ — vrijeme preuzimanja se vidi, da se ne pomisli da je spisak svjež. */
function sinceLabel(fetchedAt: string | null): string {
  if (!fetchedAt) return "još nije preuzeto";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(fetchedAt).getTime()) / 60_000));
  if (minutes < 1) return "osvježeno upravo sad";
  if (minutes < 60) return `od prije ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "od prije 1 sat" : `od prije ${hours} sata`;
}

/** `2026-11-27` → `27. 11. 2026.` — isti zapis kao na webu (`formatDate`). */
function domaciDatum(iso: string): string {
  const [godina, mjesec, dan] = iso.slice(0, 10).split("-");
  if (!godina || !mjesec || !dan) return iso;
  return `${Number(dan)}. ${Number(mjesec)}. ${godina}.`;
}

function daysLabel(row: LocalObligation): string {
  if (row.daysLeft === null) return "bez roka";
  if (row.daysLeft === 0) return "istječe danas";
  if (row.daysLeft > 0) return row.daysLeft === 1 ? "za 1 dan" : `za ${row.daysLeft} dana`;
  const ago = Math.abs(row.daysLeft);
  return ago === 1 ? "prije 1 dan" : `prije ${ago} dana`;
}

export default function ObligationsScreen() {
  const [rows, setRows] = useState<LocalObligation[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadLocal = useCallback(async () => {
    const db = await openDb();
    const local = await readObligations(db);
    setRows(local.rows);
    setFetchedAt(local.fetchedAt);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadLocal();
  }, [loadLocal]);

  async function refresh() {
    setBusy(true);
    setMessage(null);
    try {
      const remote = await myObligations();
      const mapped: LocalObligation[] = remote.obligations.map((row) => ({
        id: row.id,
        typeLabel: row.typeLabel,
        // Na telefonu je bitno ŠTA istječe: osoba ili mašina, ne id.
        target: row.workerName ?? (row.machineCode ? `${row.machineCode} · ${row.machineName ?? ""}` : "Cijela firma"),
        expiresAt: row.expiresAt,
        state: row.state,
        daysLeft: row.daysLeft,
      }));
      const db = await openDb();
      const now = new Date().toISOString();
      await saveObligations(db, mapped, now);
      setRows(mapped);
      setFetchedAt(now);
      setMessage(mapped.length === 0 ? "Nema rokova koji su na tebi." : null);
    } catch {
      // Bez veze se NE briše spisak: ono što je preuzeto ostaje vidljivo.
      setMessage("Nema veze. Prikazujem zadnje preuzeto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Moji rokovi"
      subtitle={sinceLabel(fetchedAt)}
      loading={loading}
      error={null}
      empty={rows.length === 0 ? "Nema rokova. Ovdje se vide obaveze gdje si odgovoran ili je radnik vezan za tvoj nalog. Osvježi za novi spisak." : null}
      onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))}
    >
      {message ? <Text variant="muted">{message}</Text> : null}
      {rows.map((row) => (
        <CardView key={row.id}>
          <Text variant="label">{row.typeLabel}</Text>
          <StatusChip label={STATE_LABEL[row.state] ?? row.state} tone={stateTone(row.state)} />
          <Text>{row.target}</Text>
          <Text variant="caption">
            {row.expiresAt ? domaciDatum(row.expiresAt) : "bez roka"} · {daysLabel(row)}
          </Text>
        </CardView>
      ))}
      <Button label={busy ? "Osvježavam…" : "Osvježi"} busy={busy} onPress={refresh} accessibilityLabel="Osvježi spisak rokova" />
      <Text variant="muted">Rokovi se ovdje samo gledaju. Unos, obnova i prilozi su u uredu.</Text>
    </Screen>
  );
}
