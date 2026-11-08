import { ActivityIndicator, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { fontAssets } from "../theme/fonts";
import { useTheme } from "../theme/use-theme";

/**
 * Fontovi: Manrope (500/600/700/800) i IBM Plex Mono (500), isti fajlovi kao na webu.
 * Ne prikazujemo sadržaj dok se ne učitaju — inače bi prvi kadar bio u sistemskom fontu.
 */
export default function RootLayout() {
  const { theme, name } = useTheme();
  const [loaded] = useFonts(fontAssets);

  if (!loaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.bg }}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <>
      {/* Status bar prati temu: svijetle ikone na tamnoj podlozi i obrnuto. */}
      <StatusBar style={name === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
