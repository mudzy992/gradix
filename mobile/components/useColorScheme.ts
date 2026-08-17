import { useColorScheme as useSystemScheme } from 'react-native';
import { useThemeStore } from '@/lib/theme-store';

export function useColorScheme(): 'light' | 'dark' {
  const pref = useThemeStore((state) => state.pref);
  const system = useSystemScheme();
  if (pref === 'system') {
    return system === 'dark' ? 'dark' : 'light';
  }
  return pref;
}
