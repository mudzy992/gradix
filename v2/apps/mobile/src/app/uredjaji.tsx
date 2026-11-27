/**
 * Moji uređaji (F1, spec 01 §1.6.28) — odjava na daljinu sa terena.
 *
 * Zašto ovaj ekran postoji na telefonu: čovjek koji izgubi telefon ne može doći do ureda.
 * Zato je popis uređaja dostupan i ovdje, sa istim API-jem kao web — telefon ne dobija
 * poseban spisak, samo svoj.
 *
 * Tri stvari koje ekran namjerno radi:
 *   - **tekući uređaj se ne može odjaviti** (server bi odbio, ali dugme se ni ne prikazuje —
 *     nema smisla nuditi radnju koja uvijek padne);
 *   - **„odjavi ostale“ traži potvrdu** — to izbacuje ljude i sa gradilišta;
 *   - **greška se vidi kao greška**, nikad kao prazan spisak (prazno = tvrdnja da nema uređaja).
 */
import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import { mySessions, revokeMySession, revokeOtherSessions } from "../api/client";
import { Button, CardView, Screen, StatusChip, Text } from "../ui";

type Device = {
  id: string;
  deviceLabel: string;
  lastSeenAt: string;
  createdAt: string;
  isCurrent: boolean;
};

/** „23. 11. 2026. 14:05“ — isti zapis kao na webu. */
function domaciDatum(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const dan = String(date.getDate()).padStart(2, "0");
  const mjesec = String(date.getMonth() + 1).padStart(2, "0");
  const sat = String(date.getHours()).padStart(2, "0");
  const minuta = String(date.getMinutes()).padStart(2, "0");
  return `${dan}. ${mjesec}. ${date.getFullYear()}. ${sat}:${minuta}`;
}

export default function SessionScreen() {
  const [rows, setRows] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mySessions();
      setRows(data.sessions);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Spisak uređaja nije dostupan.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string, label: string) {
    setBusy(true);
    setMessage(null);
    try {
      await revokeMySession(id);
      setMessage(`Uređaj „${label}“ je odjavljen.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Odjava nije prošla.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeOthers() {
    setBusy(true);
    setMessage(null);
    try {
      const revoked = await revokeOtherSessions();
      setMessage(revoked === 0 ? "Nema drugih uređaja." : `Odjavljeno uređaja: ${revoked}.`);
      setConfirming(false);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Odjava ostalih nije prošla.");
    } finally {
      setBusy(false);
    }
  }

  const others = rows.filter((row) => !row.isCurrent);

  return (
    <Screen
      title="Moji uređaji"
      subtitle="Ovdje se vidi gdje je nalog prijavljen; odjava važi odmah."
      loading={loading}
      error={error}
      empty={rows.length === 0 ? "Ovo je neočekivano — nema nijedne aktivne sesije. Osvježi." : null}
      onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))}
    >
      {message ? <Text variant="muted">{message}</Text> : null}
      {rows.map((row) => (
        <CardView key={row.id}>
          <Text variant="label">{row.deviceLabel}</Text>
          {row.isCurrent ? <StatusChip label="Ovaj uređaj" tone="plain" /> : null}
          <Text variant="caption">Zadnja aktivnost: {domaciDatum(row.lastSeenAt)}</Text>
          <Text variant="caption">Prijava: {domaciDatum(row.createdAt)}</Text>
          {row.isCurrent ? null : (
            <Button
              label="Odjavi uređaj"
              busy={busy}
              onPress={() => void revoke(row.id, row.deviceLabel)}
              accessibilityLabel={`Odjavi uređaj ${row.deviceLabel}`}
            />
          )}
        </CardView>
      ))}
      {others.length > 0 ? (
        confirming ? (
          <CardView>
            <Text variant="label">Odjaviti sve ostale uređaje?</Text>
            <Text variant="caption">Ostali uređaji moraju ponovo da se prijave. Ovaj ostaje prijavljen.</Text>
            <Button label="Da, odjavi ostale" busy={busy} onPress={() => void revokeOthers()} accessibilityLabel="Potvrdi odjavu ostalih uređaja" />
            <Button label="Odustani" busy={false} onPress={() => setConfirming(false)} accessibilityLabel="Odustani od odjave" />
          </CardView>
        ) : (
          <Button
            label="Odjavi sve ostale uređaje"
            busy={busy}
            onPress={() => setConfirming(true)}
            accessibilityLabel="Odjavi sve ostale uređaje"
          />
        )
      ) : null}
      <Button label={busy ? "Radim…" : "Osvježi"} busy={busy} onPress={() => void load()} accessibilityLabel="Osvježi spisak uređaja" />
      <Text variant="muted">Ako je telefon izgubljen, odjavi ga ovdje ili iz ureda — sesija se ne može produžiti.</Text>
    </Screen>
  );
}
