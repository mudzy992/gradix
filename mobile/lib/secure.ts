import * as SecureStore from 'expo-secure-store';

const REFRESH_KEY = 'gradix.refresh';
const DEVICE_KEY = 'gradix.deviceId';
const THEME_KEY = 'gradix.theme';

export async function readRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_KEY);
  } catch {
    return null;
  }
}

export async function writeRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_KEY, token);
}

export async function clearRefreshToken(): Promise<void> {
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

export async function readOrCreateDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_KEY);
  if (existing) {
    return existing;
  }
  const created = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await SecureStore.setItemAsync(DEVICE_KEY, created);
  return created;
}

export async function readThemePref(): Promise<'light' | 'dark' | 'system'> {
  let value: string | null = null;
  try {
    value = await SecureStore.getItemAsync(THEME_KEY);
  } catch {
    return 'system';
  }
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value;
  }
  return 'system';
}

export async function writeThemePref(value: 'light' | 'dark' | 'system'): Promise<void> {
  await SecureStore.setItemAsync(THEME_KEY, value);
}
