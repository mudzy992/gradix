/**
 * Ručni unos dana — rezerva, ne glavni put (spec 03 §1.1.3).
 *
 * Postoji zato što telefon može ostati bez baterije, a dan se ipak mora upisati. Namjerno je
 * SAKRIVEN iza „Unesi ručno“: kad je forma na vrhu, radnik uvijek bira nju, a timer nikad ne
 * zaživi — a timer je ono što daje podatke o trajanju bez nagađanja.
 *
 * Unos i dalje ide kroz isti `POST /api/workdays/timer` (`start` + `finish`), pa ne postoji
 * drugi put do baze koji bi mogao zaobići zaokruživanje i provjere.
 */
import { useState } from "react";
import { View } from "react-native";
import { workdayTimer } from "../api/client";
import { AlertBox, Button, CardView, Text, TextField } from "../ui";

function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function ManualEntry({ onSaved }: { onSaved: () => void }) {
  const [workDate, setWorkDate] = useState(todayIso());
  const [started, setStarted] = useState("07:00");
  const [ended, setEnded] = useState("15:00");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(workDate)
    && /^\d{2}:\d{2}$/.test(started)
    && /^\d{2}:\d{2}$/.test(ended);

  async function save() {
    if (!valid) {
      setMessage("Provjeri datum (GGGG-MM-DD) i vremena (HH:MM).");
      return;
    }
    if (ended <= started) {
      setMessage("Kraj mora biti poslije početka.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const localId = `manual_${workDate}_${started}_${Date.now()}`;
      await workdayTimer({
        action: "start",
        localId,
        at: `${workDate}T${started}:00`,
        tzOffsetMinutes: -new Date().getTimezoneOffset(),
      });
      await workdayTimer({
        action: "finish",
        at: `${workDate}T${ended}:00`,
        tzOffsetMinutes: -new Date().getTimezoneOffset(),
      });
      setMessage("Upisano. Ured vidi ručni unos kao i svaki drugi segment.");
      onSaved();
    } catch {
      setMessage("Nije prošlo. Provjeri vezu i pokušaj ponovo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <CardView>
      <Text variant="label">Ručni unos</Text>
      <AlertBox>
        Koristi samo kad timer nije radio (baterija, kvar telefona). Vrijeme se pamti kao tvoj
        unos, ne kao mjerenje.
      </AlertBox>
      <TextField label="Datum (GGGG-MM-DD)" value={workDate} onChangeText={setWorkDate} accessibilityLabel="Datum rada" />
      <TextField label="Početak (HH:MM)" value={started} onChangeText={setStarted} accessibilityLabel="Početak rada" />
      <TextField label="Kraj (HH:MM)" value={ended} onChangeText={setEnded} accessibilityLabel="Kraj rada" />
      <View style={{ gap: 12 }}>
        <Button label="Upiši dan" busy={busy} onPress={() => void save()} />
      </View>
      {message ? <Text variant="muted">{message}</Text> : null}
    </CardView>
  );
}
