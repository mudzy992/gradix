/**
 * Odjava za terenske ekrane (A3, 2026-11-07; A2 premještena iz src/teren da se prekine
 * ciklus ui/index → teren/SignOutButton → ui/index): dostupna SVAKOJ roli, ne samo šefu, i ne
 * samo na početnom ekranu. Ista pravila kao na početnom ekranu: eksplicitna potvrda,
 * broj neposlanih redova u objašnjenju, keš se briše — outbox redovi se nikad ne brišu.
 */
import { useState } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import { getLogoutSummary, logoutMobile } from "../api/session-lifecycle";
import { openDb } from "../db/sqlite";
import { Button } from "./button";

export function logoutExplanation(summary: { pendingCount: number; legacyR0Count: number }): string {
  return summary.pendingCount + summary.legacyR0Count > 0
    ? `R4 outbox redovi: ${summary.pendingCount}. Stari R0 zapisi koji nemaju vezan nalog: ${summary.legacyR0Count}. Odjava briše privatni keš i cursor, ali čuva R4 redove i konfliktne payload-e; R0 zapisi se ne šalju drugim protokolom.`
    : "Odjava će obrisati lokalni keš i sync cursor. Neposlani redovi i konfliktni payload-i se nikad ne brišu automatski.";
}

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function requestSignOut() {
    const db = await openDb();
    const summary = await getLogoutSummary(db);
    Alert.alert("Potvrdi odjavu", logoutExplanation(summary), [
      { text: "Ostani prijavljen", style: "cancel" },
      {
        text: "Odjavi se",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setBusy(true);
            try {
              await logoutMobile(db, true);
            } catch {
              // Lokalna odjava je već obavljena u logoutMobile toku; i pri grešci server
              // opoziva korisnik završava na prijavi, ne na terenskom ekranu.
            } finally {
              setBusy(false);
              router.replace("/");
            }
          })();
        },
      },
    ]);
  }

  return (
    <Button
      label={busy ? "Odjava…" : "Odjavi se"}
      variant="secondary"
      onPress={() => void requestSignOut()}
      disabled={busy}
      accessibilityLabel="Odjavi se"
    />
  );
}
