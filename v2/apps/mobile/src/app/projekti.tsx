/**
 * Moji projekti (R3) — SAMO ČITANJE, isti obrazac kao „Moji rokovi“.
 *
 * Zašto čitanje: dodjela ljudi i mašina je posao ureda, a na terenu se samo gleda na kojem je
 * projekat čovjek i dokle traje. Upis s terena dolazi u R4 (radni dan bira projekat).
 *
 * Offline: zadnji preuzet spisak ostaje na uređaju i prikazuje se i bez veze — ekran NIKAD nije
 * prazan zbog mreže. Uz spisak ide „od prije X“ da se ne pomisli da je svjež.
 */
import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import { myProjects } from "../api/client";
import { openDb, readProjects, saveProjects, type LocalProject } from "../db/sqlite";
import { Button, CardView, Screen, StatusChip, Text } from "../ui";

const STATUS_LABEL: Record<string, string> = {
  PLANNED: "U planu",
  ACTIVE: "Aktivan",
  PAUSED: "Pauziran",
  FINISHED: "Završen",
  CANCELLED: "Otkazan",
};

/** `od prije 2 sata` — isto pravilo kao na ekranu rokova, da se dva ekrana ne razdvajaju. */
function sinceLabel(fetchedAt: string | null): string {
  if (!fetchedAt) return "još nije preuzeto";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(fetchedAt).getTime()) / 60_000));
  if (minutes < 1) return "osvježeno upravo sad";
  if (minutes < 60) return `od prije ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "od prije 1 sat" : `od prije ${hours} sata`;
}

/** `2026-11-27` → `27. 11. 2026.` — isti zapis kao na webu. */
function domaciDatum(iso: string): string {
  const [godina, mjesec, dan] = iso.slice(0, 10).split("-");
  if (!godina || !mjesec || !dan) return iso;
  return `${Number(dan)}. ${Number(mjesec)}. ${godina}.`;
}

export default function ProjectsScreen() {
  const [rows, setRows] = useState<LocalProject[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadLocal = useCallback(async () => {
    const db = await openDb();
    const local = await readProjects(db);
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
      const remote = await myProjects();
      const mapped: LocalProject[] = remote.projects.map((project) => ({
        id: project.id,
        code: project.code,
        name: project.name,
        status: project.status,
        sitePlace: project.sitePlace,
        startsOn: project.startsOn,
        endsOn: project.endsOn,
      }));
      const db = await openDb();
      const now = new Date().toISOString();
      await saveProjects(db, mapped, now);
      setRows(mapped);
      setFetchedAt(now);
      setMessage(mapped.length === 0 ? "Nisi dodijeljen nijednom projektu." : null);
    } catch {
      // Bez veze se NE briše spisak: ono što je preuzeto ostaje vidljivo.
      setMessage("Nema veze. Prikazujem zadnje preuzeto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Moji projekti"
      subtitle={sinceLabel(fetchedAt)}
      loading={loading}
      error={null}
      empty={rows.length === 0 ? "Nema projekata. Ovdje se vide projekti na koje si dodijeljen. Ako neki nedostaje, javi uredu." : null}
      onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))}
    >
      {message ? <Text variant="muted">{message}</Text> : null}
      {rows.map((row) => (
        <CardView key={row.id}>
          <Text variant="label">{row.name}</Text>
          <StatusChip label={STATUS_LABEL[row.status] ?? row.status} tone={row.status === "ACTIVE" ? "plain" : "warn"} />
          <Text>{row.sitePlace ?? "lokacija nije upisana"}</Text>
          <Text variant="caption">
            {row.code} · {row.endsOn ? `do ${domaciDatum(row.endsOn)}` : row.startsOn ? `od ${domaciDatum(row.startsOn)}` : "bez perioda"}
          </Text>
        </CardView>
      ))}
      <Button label={busy ? "Osvježavam…" : "Osvježi"} busy={busy} onPress={refresh} accessibilityLabel="Osvježi spisak projekata" />
      <Text variant="muted">Projekti se ovdje samo gledaju. Dodjele radi ured.</Text>
    </Screen>
  );
}
