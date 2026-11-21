import { useEffect, useState } from 'react';
import { Appearance } from 'react-native';
import { readThemePref } from '@/lib/secure';

export function useAppScheme(): 'light' | 'dark' {
  const [pref, setPref] = useState<'light' | 'dark' | 'system'>('system');
  const [system, setSystem] = useState<'light' | 'dark'>(
    Appearance.getColorScheme() === 'dark' ? 'dark' : 'light',
  );
  useEffect(() => {
    void readThemePref().then(setPref);
    const sub = Appearance.addChangeListener((event) => {
      setSystem(event.colorScheme === 'dark' ? 'dark' : 'light');
    });
    return () => sub.remove();
  }, []);
  return pref === 'system' ? system : pref;
}
