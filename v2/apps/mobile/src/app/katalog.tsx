/**
 * U5 — mobilni katalog iza dev prekidača: u produkcijskoj gradnji ekran ne postoji
 * kao sadržaj (pokazuje samo poruku). Nije u mobilnoj navigaciji (mobile-nav).
 */
import { View } from "react-native";
import { Banner, BigActionButton, Button, CardView, EmptyState, ListItem, Segmented, Skeleton, StatusChip, Text, TextField, Tile, useUiStyles } from "../ui";
import { useState } from "react";

export default function KatalogScreen() {
  const { styles } = useUiStyles();
  const [pick, setPick] = useState("a");
  if (!__DEV__) {
    return (
      <View style={styles.container}>
        <Text variant="page">Katalog</Text>
        <Text variant="muted">Dostupno samo u razvojnoj gradnji.</Text>
      </View>
    );
  }
  return (
    <View style={styles.container}>
      <Text variant="page">Katalog komponenti</Text>
      <Banner>Banner: sistemska poruka (offline/sync).</Banner>
      <CardView>
        <TextField label="Polje" placeholder="Placeholder iz tokena" />
        <Segmented label="Izbor" value={pick} onChange={setPick} options={[{ value: "a", label: "Prva" }, { value: "b", label: "Druga" }]} />
        <Button label="Primarno dugme" onPress={() => undefined} />
        <Button label="Sekundarno" variant="secondary" onPress={() => undefined} />
        <BigActionButton label="Velika akcija (≥56 dp)" onPress={() => undefined} />
      </CardView>
      <CardView>
        <ListItem title="Stavka liste" meta="meta" right="Ishod" />
        <StatusChip label="StatusChip" tone="warn" />
      </CardView>
      <Tile title="Pločica (Tile)" hint="Dodirna meta ≥56 dp" onPress={() => undefined} />
      <Skeleton rows={2} />
      <EmptyState text="Prazno stanje: nema zapisa." />
    </View>
  );
}
