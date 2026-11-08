/**
 * Moji projekti (R3) — SAMO ČITANJE, isti obrazac kao „Moji rokovi“.
 *
 * Zašto čitanje: dodjela ljudi i mašina je posao ureda, a na terenu se samo gleda na kojem je
 * projekat čovjek i dokle traje. Upis s terena dolazi u R4 (radni dan bira projekat).
 *
 * Offline: zadnji preuzet spisak ostaje na uređaju i prikazuje se i bez veze — ekran NIKAD nije
 * prazan zbog mreže. Uz spisak ide „od prije X“ da se ne pomisli da je svjež.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { router } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { myProjects } from "../api/client";
import { openDb, readProjects, saveProjects, type LocalProject } from "../db/sqlite";
import { radius, spacing, touchTarget, typography } from "../theme/tokens";
import { useTheme } from "../theme/use-theme";

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
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/*
        Zaglavlje je u cijeloj aplikaciji isključeno (`_layout.tsx`), pa ekran koji nije početni
        mora sam imati put nazad — inače na iOS-u nema kako da se vrati.
      */}
      <Pressable
        style={styles.back}
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        accessibilityRole="button"
        accessibilityLabel="Nazad na početni ekran"
      >
        <Text style={styles.backText}>‹ Nazad</Text>
      </Pressable>

      <Text style={styles.title}>Moji projekti</Text>
      <Text style={styles.subtitle}>{sinceLabel(fetchedAt)}</Text>

      {message && <Text style={styles.hint}>{message}</Text>}

      {rows.length === 0 ? (
        <View style={styles.panel}>
          <Text style={styles.panelLabel}>Nema projekata</Text>
          <Text style={styles.panelHint}>
            Ovdje se vide projekti na koje si dodijeljen. Ako neki nedostaje, javi uredu.
          </Text>
        </View>
      ) : (
        rows.map((row) => (
          <View key={row.id} style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.cardTitle}>{row.name}</Text>
              {/* Stanje je tekst, ne samo boja — čita se na suncu i u čitaču ekrana. */}
              <Text style={[styles.badge, row.status !== "ACTIVE" && styles.badgeQuiet]}>
                {STATUS_LABEL[row.status] ?? row.status}
              </Text>
            </View>
            <Text style={styles.cardTarget}>{row.sitePlace ?? "lokacija nije upisana"}</Text>
            <Text style={styles.cardMono}>
              {row.code} ·{" "}
              {row.endsOn ? `do ${domaciDatum(row.endsOn)}` : row.startsOn ? `od ${domaciDatum(row.startsOn)}` : "bez perioda"}
            </Text>
          </View>
        ))
      )}

      {/* Jedna velika primarna akcija — mete ≥ 56 dp, radi rukavicama. */}
      <Pressable
        style={[styles.big, busy && styles.disabled]}
        onPress={refresh}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Osvježi spisak projekata"
      >
        <Text style={styles.bigText}>{busy ? "Osvježavam…" : "Osvježi"}</Text>
      </Pressable>

      <Text style={styles.footnote}>Projekti se ovdje samo gledaju. Dodjele radi ured.</Text>
    </ScrollView>
  );
}

function createStyles(t: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bg },
    container: { padding: spacing.xl, backgroundColor: t.bg, flexGrow: 1 },
    back: { minHeight: touchTarget, justifyContent: "center", alignSelf: "flex-start", paddingRight: spacing.md },
    backText: { ...typography.button, color: t.muted },
    title: { ...typography.page, color: t.text },
    subtitle: { ...typography.body, color: t.muted, marginBottom: spacing.sm },
    panel: {
      padding: spacing.lg,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: t.line,
      backgroundColor: t.panel,
      gap: 2,
      marginTop: spacing.md,
    },
    panelLabel: { ...typography.label, color: t.muted },
    panelHint: { ...typography.body, color: t.muted },
    card: {
      padding: spacing.lg,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: t.line,
      backgroundColor: t.panel,
      marginTop: spacing.md,
    },
    // Razmak unutar reda ide preko `marginTop` na tekstu, ne preko `gap`: stariji React Native na
    // Androidu ne podržava `gap` u svakom kontejneru (a izgleda kao da radi).
    cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    cardTitle: { ...typography.section, color: t.text, flex: 1, paddingRight: spacing.sm },
    badge: {
      ...typography.label,
      color: t.text,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
    },
    badgeQuiet: { color: t.muted },
    cardTarget: { ...typography.body, color: t.text, marginTop: spacing.xs },
    cardMono: { ...typography.mono, color: t.muted, marginTop: spacing.xs },
    big: {
      marginTop: spacing.lg,
      backgroundColor: t.primary,
      borderRadius: radius.tile,
      paddingVertical: spacing.lg,
      minHeight: 60,
      alignItems: "center",
      justifyContent: "center",
    },
    bigText: { ...typography.button, fontSize: 17, color: t.onPrimary },
    disabled: { opacity: 0.6 },
    hint: { ...typography.body, color: t.muted, marginBottom: spacing.sm },
    footnote: { marginTop: spacing.lg, ...typography.body, color: t.muted },
  });
}
