/**
 * Moji rokovi (R2b) — SAMO ČITANJE, po planu (§6).
 *
 * Zašto čitanje, a ne unos: R2 nema radne sate ni ture, pa terenski čovjek nema šta da upiše
 * osim onoga što ured već unosi. Pisanje na terenu dolazi u R4/R5 sa offline redom.
 *
 * Offline: zadnji preuzet spisak ostaje na uređaju. Ekran zato UVIJEK prvo pokaže lokalnu
 * kopiju (i kad nema veze), pa je osvježi kad veza postoji — nikad prazan ekran zbog mreže.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { myObligations } from "../api/client";
import { openDb, readObligations, saveObligations, type LocalObligation } from "../db/sqlite";
import { radius, spacing, typography } from "../theme/tokens";
import { useTheme } from "../theme/use-theme";

const STATE_LABEL: Record<string, string> = {
  expired: "Isteklo",
  expiring: "Uskoro istječe",
  valid: "Važeće",
  no_expiry: "Bez roka",
};

/** „od prije 2 sata“ — vrijeme preuzimanja se vidi, da se ne pomisli da je spisak svjež. */
function sinceLabel(fetchedAt: string | null): string {
  if (!fetchedAt) return "još nije preuzeto";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(fetchedAt).getTime()) / 60_000));
  if (minutes < 1) return "osvježeno upravo sad";
  if (minutes < 60) return `od prije ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "od prije 1 sat" : `od prije ${hours} sata`;
}

function daysLabel(row: LocalObligation): string {
  if (row.daysLeft === null) return "bez roka";
  if (row.daysLeft === 0) return "istječe danas";
  if (row.daysLeft > 0) return row.daysLeft === 1 ? "za 1 dan" : `za ${row.daysLeft} dana`;
  const ago = Math.abs(row.daysLeft);
  return ago === 1 ? "prije 1 dan" : `prije ${ago} dana`;
}

export default function ObligationsScreen() {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Moji rokovi</Text>
      <Text style={styles.subtitle}>{sinceLabel(fetchedAt)}</Text>

      {message && <Text style={styles.hint}>{message}</Text>}

      {rows.length === 0 ? (
        <View style={styles.panel}>
          <Text style={styles.panelLabel}>Nema rokova</Text>
          <Text style={styles.panelHint}>
            Ovdje su obaveze gdje si odgovoran ili je radnik vezan za tvoj nalog. Osvježi za novi spisak.
          </Text>
        </View>
      ) : (
        rows.map((row) => (
          <View key={row.id} style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.cardTitle}>{row.typeLabel}</Text>
              {/* Stanje je tekst, ne samo boja — čita se i na suncu i u čitaču ekrana. */}
              <Text style={[styles.badge, row.state === "expired" && styles.badgeHot]}>
                {STATE_LABEL[row.state] ?? row.state}
              </Text>
            </View>
            <Text style={styles.cardTarget}>{row.target}</Text>
            <Text style={styles.cardMono}>
              {row.expiresAt ?? "bez roka"} · {daysLabel(row)}
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
        accessibilityLabel="Osvježi spisak rokova"
      >
        <Text style={styles.bigText}>{busy ? "Osvježavam…" : "Osvježi"}</Text>
      </Pressable>

      <Text style={styles.footnote}>
        Rokovi se ovdje samo gledaju. Unos, obnova i prilozi su u uredu.
      </Text>
    </ScrollView>
  );
}

function createStyles(t: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bg },
    container: { padding: spacing.xl, gap: spacing.md, backgroundColor: t.bg, flexGrow: 1 },
    title: { ...typography.page, color: t.text },
    subtitle: { ...typography.body, color: t.muted, marginBottom: spacing.sm },
    panel: {
      padding: spacing.lg,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: t.line,
      backgroundColor: t.panel,
      gap: 2,
    },
    panelLabel: { ...typography.label, color: t.muted },
    panelHint: { ...typography.body, color: t.muted },
    card: {
      padding: spacing.lg,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: t.line,
      backgroundColor: t.panel,
      gap: spacing.xs,
    },
    // Razmak unutar reda kartice ide preko `marginTop` na tekstu, ne preko `gap`: stariji
    // React Native na Androidu ne podržava `gap` u svakom kontejneru (a izgleda kao da radi).
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
    badgeHot: { color: t.danger, borderColor: t.danger },
    cardTarget: { ...typography.body, color: t.text, marginTop: spacing.xs },
    cardMono: { ...typography.mono, color: t.muted, marginTop: spacing.xs },
    big: {
      marginTop: spacing.md,
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
