import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";

/**
 * Jedan stil za dijete `<Link asChild>`.
 *
 * ekspo-router 58 klonira dijete linka kroz `<Slot>`, a `<Slot>` u razvoju BACA grešku ako to
 * dijete dobije NIZ stilova (`style={[a, b]}`) — na telefonu je to crveni ekran, a `tsc`, lint i
 * web build ga ne vide. Zato stil za takvo dijete uvijek prolazi kroz ovu funkciju.
 *
 * Ne koristi se svuda: običan `Pressable`/`Text` normalno prima niz stilova. Samo pod `asChild`.
 */
export function jedanStil(...stilovi: StyleProp<ViewStyle>[]): ViewStyle {
  return (StyleSheet.flatten(stilovi) ?? {}) as ViewStyle;
}
