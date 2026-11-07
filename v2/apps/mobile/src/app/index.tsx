/**
 * Ekran za teren (R0): prijava, jedan offline zapis, indikator stanja reda.
 *
 * Namjerno krupno i jednostavno: rukavice, sunce, jedan dodir za glavnu akciju.
 * Sve što ne radi ili nije implementirano — ne postoji na ekranu (A1.5).
 */
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { login, me, pushNotes, pullChanges, getAccessToken, type Me } from "../api/client";
import { openDb, insertNote, markFailed, markSent, pendingCount, pendingNotes, readWatermark, writeWatermark } from "../db/sqlite";
import { runSync } from "../sync/engine";
import { colors, radius, spacing, touchTarget, typography } from "../theme/tokens";

const DEVICE_ID = "gradix-device-r0";

type Phase = "loading" | "login" | "ready";

export default function IndexScreen() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [profile, setProfile] = useState<Me | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [text, setText] = useState("");
  const [pending, setPending] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshPending = useCallback(async () => {
    const db = await openDb();
    setPending(await pendingCount(db));
  }, []);

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
        await refreshPending();
      } catch {
        setPhase("login");
      }
    })();
  }, [refreshPending]);

  async function signIn() {
    setBusy(true);
    setMessage(null);
    try {
      await login(email.trim(), password);
      setProfile(await me());
      setPhase("ready");
      await refreshPending();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Prijava nije uspjela.");
    } finally {
      setBusy(false);
    }
  }

  async function addNote() {
    if (!text.trim()) return;
    setBusy(true);
    const db = await openDb();
    await insertNote(db, {
      localId: `${DEVICE_ID}-${Date.now()}`,
      text: text.trim(),
      clientAt: new Date().toISOString(),
    });
    setText("");
    await refreshPending();
    setMessage("Zapis je sačuvan na uređaju. Poslat će se kad bude veza.");
    setBusy(false);
  }

  async function sync() {
    setBusy(true);
    setMessage(null);
    const db = await openDb();
    const store = {
      pending: () => pendingNotes(db),
      markSent: (localId: string, serverId: string) => markSent(db, localId, serverId),
      markFailed: (localId: string) => markFailed(db, localId),
      readWatermark: () => readWatermark(db),
      writeWatermark: (value: string) => writeWatermark(db, value),
    };
    const outcome = await runSync(store, {
      push: (items) => pushNotes(DEVICE_ID, items),
      pull: (since) => pullChanges(since),
    });
    await refreshPending();
    setMessage(
      outcome.error
        ? `Nema veze. ${pending} zapisa čeka slanje.`
        : `Poslano: ${outcome.sent}. Čeka: ${await pendingCount(db)}.`,
    );
    setBusy(false);
  }

  if (phase === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (phase === "login") {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Gradix — teren</Text>
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
      <Text style={styles.title}>{profile?.company?.name ?? "Firma"}</Text>
      <Text style={styles.subtitle}>
        {profile?.user.firstName} {profile?.user.lastName} ·{" "}
        {pending === 0 ? "sve poslano" : `${pending} čeka slanje`}
      </Text>

      <Text style={styles.label}>Novi zapis s terena</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={text}
        onChangeText={setText}
        placeholder="npr. Iskop kanala, dionica 2, 40 m"
        multiline
        accessibilityLabel="Tekst zapisa"
      />

      <Pressable style={styles.button} onPress={addNote} disabled={busy} accessibilityRole="button">
        <Text style={styles.buttonText}>Sačuvaj na uređaju</Text>
      </Pressable>

      <Pressable
        style={[styles.button, styles.secondaryButton]}
        onPress={sync}
        disabled={busy}
        accessibilityRole="button"
      >
        <Text style={[styles.buttonText, styles.secondaryText]}>Pošalji sve</Text>
      </Pressable>

      {message && <Text style={styles.hint}>{message}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted },
  container: {
    padding: spacing.xl,
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    flexGrow: 1,
  },
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted, marginBottom: spacing.lg },
  label: { ...typography.label, color: colors.text, marginTop: spacing.sm },
  input: {
    borderWidth: 2,
    borderColor: colors.borderStrong, // 3,76:1 na bijelom — WCAG 1.4.11 traži 3:1 za ivicu polja
    borderRadius: radius.input,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: touchTarget,
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  multiline: { minHeight: 96, textAlignVertical: "top" },
  button: {
    marginTop: spacing.lg,
    backgroundColor: colors.brand,
    borderRadius: radius.card,
    paddingVertical: spacing.lg,
    minHeight: touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { ...typography.button, color: colors.textInverse },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.brand,
  },
  secondaryText: { color: colors.brand },
  error: {
    ...typography.body,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.input,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
  },
  hint: { marginTop: spacing.lg, ...typography.body, color: colors.textMuted },
});
