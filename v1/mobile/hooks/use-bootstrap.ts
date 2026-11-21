import { useEffect } from 'react';
import { api, refreshSession } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import type { MeUser } from '@/lib/api-types';
import { readRefreshToken } from '@/lib/secure';
import { useThemeStore } from '@/lib/theme-store';
import { i18n } from '@/i18n';

export function useBootstrap() {
  const setReady = useAuthStore((state) => state.setReady);
  useEffect(() => {
    void (async () => {
      try {
        await useThemeStore.getState().hydrate();
        const refresh = await readRefreshToken();
        if (refresh) {
          const ok = await refreshSession();
          if (ok) {
            const me = await api<MeUser>('/me');
            useAuthStore.getState().setUser(me);
            await i18n.changeLanguage(me.locale);
          }
        }
      } catch {
        useAuthStore.getState().clear();
      } finally {
        setReady(true);
      }
    })();
  }, [setReady]);
}
