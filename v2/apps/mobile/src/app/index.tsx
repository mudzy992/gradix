/**
 * Privremeni teren ekran: auth and profile remain available while R4 local persistence is gated.
 * R0 note submission is deliberately removed; SQLite outbox wiring follows its approved step.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { login, me, getAccessToken, type Me } from "../api/client";
import { radius, spacing, touchTarget, typography } from "../theme/tokens";
import { useTheme } from "../theme/use-theme";
import { jedanStil } from "../lib/styles";

type Phase = "loading" | "login" | "ready";

export default function IndexScreen() {
  // Tema: prati sistem, prekidač je u zaglavlju. Ista pravila kao na webu.
  const { theme, name, toggle } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [phase, setPhase] = useState<Phase>("loading");
  const [profile, setProfile] = useState<Me | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const token = await getAccessToken();
      if (!token) {
        setPhase("login");
        return;
      }
      try {
        setProfile(await me());
        setPhase("ready");
      } catch {
        setPhase("login");
      }
    })();
  }, []);

  async function signIn() {
    setBusy(true);
    setMessage(null);
    try {
      await login(email.trim(), password);
      setProfile(await me());
      setPhase("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Prijava nije uspjela.");
    } finally {
      setBusy(false);
    }
  }

  if (phase === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  // Prekidač teme: jedno dugme, ime nosi stanje koje SLIJEDI (kao na webu).
  const themeToggle = (
    <Pressable
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={name === "dark" ? "Pređi na svijetlu temu" : "Pređi na tamnu temu"}
      style={styles.themeButton}
      hitSlop={8}
    >
      <Text style={styles.themeButtonText}>{name === "dark" ? "Svijetla" : "Tamna"}</Text>
    </Pressable>
  );

  if (phase === "login") {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.topRow}>
          <Text style={styles.title}>Gradix</Text>
          {themeToggle}
        </View>
        <Text style={styles.subtitle}>Prijava za teren.</Text>
        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="username"
          accessibilityLabel="Email"
        />
        <Text style={styles.label}>Lozinka</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          accessibilityLabel="Lozinka"
        />
        {message && <Text style={styles.error}>{message}</Text>}
        <Pressable
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={signIn}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>{busy ? "Prijava…" : "Prijavi se"}</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.topRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>{profile?.company?.name ?? "Firma"}</Text>
          <Text style={styles.subtitle}>
            {profile?.user.firstName} {profile?.user.lastName}
          </Text>
        </View>
        {themeToggle}
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelLabel}>Radni unos</Text>
        <Text style={styles.panelHint}>
          R4 lokalni unos na telefonu slijedi nakon staging provjere i odobrenog SQLite outbox koraka.
          Stare R0 bilješke se više ne šalju.
        </Text>
      </View>

      {message && <Text style={styles.hint}>{message}</Text>}

      {/*
        Rokovi su odvojen ekran (R2b), samo čitanje. Link je ovdje, a ne u meniju: na terenu se
        dolazi zbog dva pitanja — „šta nisam poslao“ i „šta mi istječe“.
      */}
      {/*
        `asChild` NIJE upotrijebljen namjerno: expo-router 58 kroz `<Slot>` klonira dijete i baca
        grešku ako ono dobije NIZ stilova (`style={[a, b]}`), a `Pressable` ovdje ima dva stila.
        Zato stil ide kroz `jedanStil(...)` (jedan objekat, ne niz) — i to ne samo ovdje: pravilo
        provjerava `src/lib/styles.test.ts`, jer ga ni `tsc` ni lint ne vide.
      */}
      <Link href="/rokovi" asChild>
        <Pressable style={jedanStil(styles.button, styles.secondaryButton)} accessibilityRole="link">
          <Text style={[styles.buttonText, styles.secondaryText]}>Moji rokovi</Text>
        </Pressable>
      </Link>

      {/* R3: projekti na koje je osoba dodijeljena — isto samo čitanje, isti razlog. */}
      <Link href="/projekti" asChild>
        <Pressable style={jedanStil(styles.button, styles.secondaryButton)} accessibilityRole="link">
          <Text style={[styles.buttonText, styles.secondaryText]}>Moji projekti</Text>
        </Pressable>
      </Link>
    </ScrollView>
  );
}

/**
 * Stilovi se grade iz tema tokena — iste vrijednosti kao `globals.css` (test ih poredi).
 * `createStyles` se poziva u komponenti kroz `useMemo`, pa promjena teme mijenja cijeli ekran.
 */
function createStyles(t: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bg },
    container: {
      padding: spacing.xl,
      gap: spacing.sm,
      backgroundColor: t.bg,
      flexGrow: 1,
    },
    topRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    themeButton: {
      minHeight: 40,
      paddingHorizontal: spacing.md,
      justifyContent: "center",
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: t.line,
    },
    themeButtonText: { ...typography.label, color: t.muted },
    title: { ...typography.page, color: t.text },
    subtitle: { ...typography.body, color: t.muted, marginBottom: spacing.lg },
    label: { ...typography.label, color: t.text, marginTop: spacing.sm },
    // Pločica sa stanjem reda: zaobljena površina, mono broj.
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
    input: {
      borderWidth: 1,
      // Ivica polja je `--field` (prolazi 3:1 na pozadini u obje teme — test to mjeri).
      borderColor: t.field,
      borderRadius: radius.field,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      minHeight: touchTarget,
      ...typography.body,
      color: t.text,
      backgroundColor: t.panel,
    },
    button: {
      marginTop: spacing.lg,
      backgroundColor: t.primary,
      borderRadius: radius.card,
      paddingVertical: spacing.lg,
      minHeight: touchTarget,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { ...typography.button, color: t.onPrimary },
    secondaryButton: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: t.line,
      marginTop: spacing.md,
    },
    secondaryText: { color: t.text },
    error: {
      ...typography.body,
      marginTop: spacing.sm,
      padding: spacing.md,
      borderRadius: radius.field,
      backgroundColor: t.dangerSoft,
      color: t.danger,
    },
    hint: { marginTop: spacing.lg, ...typography.body, color: t.muted },
  });
}
