/**
 * Privremeni teren ekran: auth and profile remain available while R4 local persistence is gated.
 * R0 note submission is deliberately removed; SQLite outbox wiring follows its approved step.
 */
import { useEffect, useState } from "react";
import { Link } from "expo-router";
import { ActivityIndicator, Alert, ScrollView, View } from "react-native";
import { login, me, getAccessToken, type Me } from "../api/client";
import { getLogoutSummary, logoutMobile, REVOKED_SESSION_MESSAGE } from "../api/session-lifecycle";
import { activateLocalAccount, clearLocalAccountData } from "../db/r4-outbox";
import { openDb } from "../db/sqlite";
import { useTheme } from "../theme/use-theme";
import { Button, Text, TextField, useUiStyles } from "../ui";
import { mobileNavForProfile } from "../lib/mobile-nav";
import { logoutExplanation } from "../teren/SignOutButton";

type Phase = "loading" | "login" | "ready";

export default function IndexScreen() {
  // Tema: prati sistem, prekidač je u zaglavlju. Ista pravila kao na webu.
  const { theme, name, toggle } = useTheme();
  const { styles } = useUiStyles();

  const [phase, setPhase] = useState<Phase>("loading");
  const [profile, setProfile] = useState<Me | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      let db: Awaited<ReturnType<typeof openDb>> | null = null;
      try {
        db = await openDb();
        const token = await getAccessToken();
        if (!token) {
          // No authenticated account may see a server-derived cache left by a previous session.
          await clearLocalAccountData(db);
          if (mounted) setPhase("login");
          return;
        }
        const current = await me();
        if (current.company?.id) {
          await activateLocalAccount(db, { companyId: current.company.id, userId: current.user.id });
        }
        if (mounted) {
          setProfile(current);
          setPhase("ready");
        }
      } catch (error) {
        // A revoked session clears tokens in the auth client; purge private caches on the next
        // online check, but preserve every outbox row for its original account.
        const tokenCleared = db ? !(await getAccessToken()) : false;
        if (db && tokenCleared) await clearLocalAccountData(db);
        if (mounted) {
          setMessage(tokenCleared ? REVOKED_SESSION_MESSAGE : error instanceof Error ? error.message : "Baza na telefonu se nije mogla otvoriti.");
          setPhase("login");
        }
      }
    })();
    return () => { mounted = false; };
  }, []);

  async function signIn() {
    setBusy(true);
    setMessage(null);
    try {
      await login(email.trim(), password);
      const current = await me();
      if (!current.company?.id) throw new Error("Nalog nije vezan za aktivnu firmu.");
      const db = await openDb();
      const switched = await activateLocalAccount(db, {
        companyId: current.company.id,
        userId: current.user.id,
      });
      setProfile(current);
      setPhase("ready");
      if (switched.pendingForOtherAccounts > 0) {
        setMessage(`Na uređaju je ${switched.pendingForOtherAccounts} neposlanih redova drugog naloga; ovaj nalog ih ne može poslati.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Prijava nije uspjela.");
    } finally {
      setBusy(false);
    }
  }

  async function finishSignOut(db: Awaited<ReturnType<typeof openDb>>) {
    setBusy(true);
    try {
      const outcome = await logoutMobile(db, true);
      setMessage(outcome.serverRevoked
        ? "Odjavljeni ste. Keš je obrisan; neposlani redovi su sačuvani za isti nalog."
        : "Lokalno ste odjavljeni i keš je obrisan. Server sesija nije mogla biti opozvana bez mreže; kontaktiraj ured za opoziv ili MDM wipe.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Lokalni podaci nisu mogli biti očišćeni.");
    } finally {
      setProfile(null);
      setPhase("login");
      setBusy(false);
    }
  }

  async function requestSignOut() {
    const db = await openDb();
    const summary = await getLogoutSummary(db);
    const explanation = logoutExplanation(summary);
    Alert.alert("Potvrdi odjavu", explanation, [
      { text: "Ostani prijavljen", style: "cancel" },
      { text: "Odjavi se", style: "destructive", onPress: () => { void finishSignOut(db); } },
    ]);
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
    <Button variant="secondary" label={name === "dark" ? "Svijetla" : "Tamna"} onPress={toggle}
      accessibilityLabel={name === "dark" ? "Pređi na svijetlu temu" : "Pređi na tamnu temu"} />
  );

  if (phase === "login") {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.topRow}>
          <Text variant="page">Gradix</Text>
          {themeToggle}
        </View>
        <Text variant="muted">Prijava za teren.</Text>
        <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none"
          keyboardType="email-address" autoComplete="username" accessibilityLabel="Email" />
        <TextField label="Lozinka" value={password} onChangeText={setPassword} secureTextEntry
          autoComplete="current-password" accessibilityLabel="Lozinka" />
        {message && <Text>{message}</Text>}
        <Button label="Prijavi se" busy={busy} onPress={signIn} />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.topRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="page">{profile?.company?.name ?? "Firma"}</Text>
          <Text variant="muted">
            {profile?.user.firstName} {profile?.user.lastName}
          </Text>
        </View>
        {themeToggle}
      </View>

      {/* Stavke dolaze iz lib/mobile-nav (jedina definicija po roli). `asChild` + jedan
          stil kroz jedanStil(...) je obavezno: niz stilova kroz Slot baca grešku. */}
      {mobileNavForProfile({ roles: profile?.user.roles ?? [], workerId: profile?.workerId ?? null, foremanScope: profile?.foremanScope ?? false }).map((entry) => (
        <Link key={entry.href} href={entry.href} asChild>
          <Button variant="secondary" label={entry.label} accessibilityRole="link" />
        </Link>
      ))}

      <Button variant="secondary" label="Odjavi se" onPress={requestSignOut} disabled={busy} />
    </ScrollView>
  );
}

