/**
 * U5 — mobilni katalog: ISTI inventar i redoslijed sekcija kao web /katalog
 * (apps/web/src/components/ui/catalog.tsx), samo mobilne komponente (src/ui).
 * Iza dev prekidača: u produkcijskoj gradnji pokazuje samo poruku. Nije u navigaciji.
 */
import { useState } from "react";
import { ScrollView, View } from "react-native";
import {
  Accordion, Avatar, Badge, Banner, BigActionButton, Breadcrumbs, Button, CardView,
  EmptyState, ImageTile, ListItem, Segmented, Skeleton, StatusChip, Stepper, Text,
  TextField, TextLink, Tile, ToastBanner, UploadTile,
} from "../ui";

export default function KatalogScreen() {
  const [pick, setPick] = useState("svi");
  const [seg, setSeg] = useState("a");
  if (!__DEV__) {
    return (
      <View style={{ padding: 20, gap: 12 }}>
        <Text variant="page">Katalog</Text>
        <Text variant="muted">Dostupno samo u razvojnoj gradnji.</Text>
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
      <Text variant="page">Katalog komponenti</Text>
      <Text variant="muted">Isti inventar kao web katalog (/katalog): tokeni, kontrole, dugmad, poruke, liste, stanja.</Text>

      <Text variant="label">Tokeni i tipografija</Text>
      <CardView>
        <Text variant="page">Naslov (page)</Text>
        <Text>Tijelo teksta (body).</Text>
        <Text variant="muted">Tihi tekst (muted) — objašnjenja i meta podaci.</Text>
        <Text variant="caption">Caption/oznaka (label)</Text>
      </CardView>

      <Text variant="label">Kontrole</Text>
      <CardView>
        <TextField label="Tekstualno polje" placeholder="Placeholder iz tokena" />
        <TextField label="Email" placeholder="ime@firma.test" keyboardType="email-address" autoCapitalize="none" />
        <TextField label="Lozinka" secureTextEntry />
        <TextField label="Datum (GGGG-MM-DD)" placeholder="2026-11-07" />
        <Segmented label="Segmented (jedan izbor)" value={seg} onChange={setSeg} options={[{ value: "a", label: "Prva" }, { value: "b", label: "Druga" }]} />
        <Segmented label="Filter" value={pick} onChange={setPick} options={[{ value: "svi", label: "Svi" }, { value: "aktivni", label: "Aktivni" }, { value: "neaktivni", label: "Neaktivni" }]} />
      </CardView>

      <Text variant="label">Dugmad i akcije</Text>
      <CardView>
        <Button label="Primarno dugme (≥56 dp)" onPress={() => undefined} />
        <Button label="Sekundarno dugme" variant="secondary" onPress={() => undefined} />
        <Button label="Onemogućeno" disabled onPress={() => undefined} />
        <Button label="Zauzeto (busy)" busy onPress={() => undefined} />
        <BigActionButton label="BigActionButton — glavna terenska akcija" hint="Jedna velika akcija po ekranu" onPress={() => undefined} />
        <Tile title="Tile — velika dodirna ploča" hint="Npr. izbor projekta ili mašine" onPress={() => undefined} />
      </CardView>

      <Text variant="label">Poruke i stanja</Text>
      <Banner>Banner: sistemska poruka (bez veze / sinhronizacija / van opsega).</Banner>
      <CardView>
        <ListItem title="Stavka liste (ListItem)" meta="meta podatak" right="Ishod" />
        <ListItem title="Druga stavka" right="Čeka slanje" />
        <StatusChip label="StatusChip — upozorenje" tone="warn" />
        <StatusChip label="StatusChip — mirno" />
      </CardView>
      <Skeleton rows={3} />
      <EmptyState text="EmptyState: nema zapisa — objasni zašto i šta dalje." />

      <Text variant="label">Layout, navigacija, koraci</Text>
      <CardView>
        <Breadcrumbs items={["Moj dan", "Unos", "Potvrda"]} />
        <Stepper steps={["Podaci", "Vrijeme", "Potvrda"]} current={1} />
        <TextLink label="TextLink — veza u tekstu" onPress={() => undefined} />
      </CardView>

      <Text variant="label">Kartice, avatar, badge</Text>
      <CardView>
        <ListItem title="Amina Karić" meta="Zidar · Ekipa 1" right="Badge →" />
        <Avatar name="Amina Karić" size={48} />
        <Badge label="3" />
        <Badge label="5" tone="danger" />
        <Badge label="12" tone="quiet" />
      </CardView>

      <Text variant="label">Upload, slika, accordion, toast</Text>
      <UploadTile label="Dodaj fotografiju" hint="Kamera ili galerija — meta ≥56 dp" onPress={() => undefined} />
      <ImageTile uri="https://placehold.co/640x360/png" caption="ImageTile: slika + potpis" />
      <Accordion title="Accordion — detalji unosa">
        <Text>Sekundarne informacije unosa: napomena, istorija slanja, ishodi.</Text>
      </Accordion>
      <ToastBanner text="ToastBanner: zapis je sačuvan na telefonu." />
      <ToastBanner text="ToastBanner greška: slanje nije uspjelo, zapis ostaje." tone="error" />
    </ScrollView>
  );
}
