/**
 * U5 — mobilni katalog: ISTI inventar kao web /katalog, samo mobilne komponente.
 * Nije javno (Dio 2): u produkcijskoj gradnji ruta prikazuje samo poruku, a tijelo
 * kataloga (src/katalog-body.tsx) učitava se lijeno i samo u razvoju (__DEV__), pa
 * produkcijski paket katalog ne izvršava niti ga ruta nudi.
 */
import { Suspense, lazy } from "react";
import { View } from "react-native";
import { Text } from "../ui";

const KatalogBody = lazy(() => import("../katalog-body"));

export default function KatalogScreen() {
  if (!__DEV__) {
    return (
      <View style={{ padding: 20, gap: 12 }}>
        <Text variant="page">Katalog</Text>
        <Text variant="muted">Dostupno samo u razvojnoj gradnji.</Text>
      </View>
    );
  }
  return (
    <Suspense fallback={null}>
      <KatalogBody />
    </Suspense>
  );
}
