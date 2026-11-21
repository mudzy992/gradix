import { create } from 'zustand';
import { readThemePref, writeThemePref } from '@/lib/secure';

type Pref = 'light' | 'dark' | 'system';

type ThemeState = {
  pref: Pref;
  setPref: (pref: Pref) => Promise<void>;
  hydrate: () => Promise<void>;
};

export const useThemeStore = create<ThemeState>((set) => ({
  pref: 'system',
  setPref: async (pref) => {
    await writeThemePref(pref);
    set({ pref });
  },
  hydrate: async () => {
    set({ pref: await readThemePref() });
  },
}));
