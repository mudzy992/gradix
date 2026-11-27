/**
 * „Moj obračun“ (F6, spec 07 §4) — radnik: svoji sati po danu za mjesec.
 *
 * Tri odluke ekrana:
 *   1. **Sati uvijek, iznosi tek kad period odobri računovodstvo.** Dok je period `OPEN` ili
 *      `CALCULATED`, ekran pokazuje sate i dan; linije sa iznosima se NE prikazuju i piše zašto.
 *      Sakriti razlog bi izgledalo kao greška u aplikaciji.
 *   2. **Zbroj po vrstama je isti kao u obračunu** (redovni, prekovremeni, noćni, nedjelja,
 *      praznik). Radnik provjerava broj koji će vidjeti na isplati, ne „ukupno sati“.
 *   3. **Mjesec se bira, ne pretpostavlja.** Radnik u januaru provjerava decembar; ekran zato
 *      ima izbor mjeseca, a ne „tekući mjesec“ kao jedinu istinu.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { router } from "expo-router";
import { myPayroll } from "../api/client";
import type { MyPayrollResponse } from "@gradix/contracts";
import { View } from "react-native";
import { AlertBox, Banner, Button, CardView, ListItem, Screen, Text } from "../ui";

const MONTHS = [
  "januar", "februar", "mart", "april", "maj", "jun",
  "jul", "avgust", "septembar", "oktobar", "novembar", "decembar",
];

const STATUS_LABEL: Record<string, string> = {
  OPEN: "otvoren",
  CALCULATED: "izračunat",
  APPROVED: "odobren",
  LOCKED: "zaključan",
};

const DAY_KIND_LABEL: Record<string, string> = {
  WORK: "rad",
  SICK: "bolovanje",
  VACATION: "godišnji",
  PAID_LEAVE: "plaćeni dopust",
  UNPAID_LEAVE: "neplaćeni dopust",
  NO_SHOW: "neopravdano",
  HOLIDAY: "praznik",
};

/** Sat sa do 3 decimale i zarezom — isti zapis kao na webu i na platnom spisku. */
export function formatHours(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded).replace(".", ",");
}

export function formatCents(cents: number | null): string {
  if (cents === null) return "—";
  const sign = cents < 0 ? "−" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)},${String(absolute % 100).padStart(2, "0")} KM`;
}

/** Kategorije koje radnik provjerava; nula se ispisuje samo ako je ukupno nula. */
export function categoryRows(categories: MyPayrollResponse["totals"]["categories"]): Array<{ key: string; label: string; hours: number }> {
  const rows = [
    { key: "REGULAR", label: "Redovni", hours: categories.REGULAR },
    { key: "OVERTIME", label: "Prekovremeni", hours: categories.OVERTIME },
    { key: "NIGHT", label: "Noćni", hours: categories.NIGHT },
    { key: "SUNDAY", label: "Nedjelja", hours: categories.SUNDAY },
    { key: "HOLIDAY", label: "Praznik", hours: categories.HOLIDAY },
  ];
  return rows.filter((row) => row.hours > 0);
}

export default function MojObracunScreen() {
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MyPayrollResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await myPayroll({ year, month }));
    } catch {
      setError("Obračun nije učitan. Provjeri vezu i pokušaj ponovo.");
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const shift = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth() + 1);
  };

  const categories = data ? categoryRows(data.totals.categories) : [];

  return (
    <Screen
      title={`Moj obračun — ${MONTHS[month - 1]} ${year}`}
      subtitle="Tvoji sati po danu. Iznose vidiš kad računovodstvo odobri obračun."
      loading={loading}
      error={error}
      empty={null}
      onRetry={() => void load()}
      onBack={() => router.back()}
    >
      <CardView>
        <Text variant="label">Mjesec</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button label="← Prethodni" variant="secondary" onPress={() => shift(-1)} />
          <Button label="Sljedeći →" variant="secondary" onPress={() => shift(1)} />
        </View>
      </CardView>

      {data ? (
        <CardView>
          <Text variant="label">Ukupno sati</Text>
          <Text variant="page">{formatHours(data.totals.total_hours)} h</Text>
          {categories.map((row) => (
            <ListItem key={row.key} title={row.label} right={`${formatHours(row.hours)} h`} />
          ))}
          <Text variant="muted">
            Stanje perioda: {STATUS_LABEL[data.period.status] ?? data.period.status}
          </Text>
        </CardView>
      ) : null}

      {data && data.lines === null ? (
        <Banner>{data.lines_available_reason ?? "Iznosi još nisu objavljeni."}</Banner>
      ) : null}

      {data && data.lines !== null && data.lines.length > 0 ? (
        <CardView>
          <Text variant="label">Obračun</Text>
          {data.lines.map((line) => (
            <ListItem
              key={line.id}
              title={line.component_name}
              meta={
                line.hours > 0
                  ? `${formatHours(line.hours)} h`
                  : line.days > 0
                    ? `${formatHours(line.days)} d`
                    : "—"
              }
              right={formatCents(line.amount_cents)}
            />
          ))}
        </CardView>
      ) : null}

      <CardView>
        <Text variant="label">Dani</Text>
        {data && data.days.length === 0 ? (
          <AlertBox>Ovaj mjesec nemaš nijedan dan u evidenciji.</AlertBox>
        ) : null}
        {(data?.days ?? []).map((day) => (
          <ListItem
            key={day.work_date}
            title={`${day.work_date} · ${DAY_KIND_LABEL[day.day_kind] ?? day.day_kind}`}
            meta={day.status === "LOCKED" ? "zaključan dan" : undefined}
            right={`${formatHours(day.total_hours)} h`}
          />
        ))}
      </CardView>

    </Screen>
  );
}
