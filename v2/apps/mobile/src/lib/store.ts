/**
 * Tanak sloj za trajno skladište na uređaju.
 *
 * Zašto ne direktno `expo-secure-store`: isti kod se izvršava i u `expo export -p web`
 * (dokazivanje ekrana bez telefona), a `expo-secure-store` tamo **nema implementaciju** —
 * `getValueWithKeyAsync is not a function`. Uz to, `SecureStore.setItemAsync` odbija
 * ključeve sa crticom (`gx-theme` je neispravan ključ), pa je web grana ujedno i ispravka.
 *
 * Na iOS/Android ostaje Keychain/Keystore preko `expo-secure-store`; na webu `localStorage`
 * (isto kao web aplikacija, ključ `gx-theme`). Tokeni se nikad ne stavljaju u `localStorage`
 * na uređaju — tamo uvijek idu kroz `expo-secure-store`.
 */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const isWeb = Platform.OS === "web";

/** `SecureStore` traži `[A-Za-z0-9._-]`, ali bez crtice na početku; `:` je siguran razdvajač. */
function nativeKey(key: string): string {
  return key.replace(/-/g, "_");
}

function webStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // privatni režim bez skladišta — poziv pada na `null`, ne ruši ekran
  }
}

export async function readStore(key: string): Promise<string | null> {
  try {
    if (isWeb) return webStorage()?.getItem(key) ?? null;
    return await SecureStore.getItemAsync(nativeKey(key));
  } catch {
    return null;
  }
}

export async function writeStore(key: string, value: string): Promise<void> {
  try {
    if (isWeb) webStorage()?.setItem(key, value);
    else await SecureStore.setItemAsync(nativeKey(key), value);
  } catch {
    // Skladište nije kritično za rad ekrana: zapis ostaje u redu i bez njega.
  }
}

export async function deleteStore(key: string): Promise<void> {
  try {
    if (isWeb) webStorage()?.removeItem(key);
    else await SecureStore.deleteItemAsync(nativeKey(key));
  } catch {
    // vidi `writeStore`
  }
}
