import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/screen';
import { PrimaryButton } from '@/components/primary-button';
import { api, apiList } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { tabFlags } from '@/lib/permissions';
import { useAuthStore } from '@/lib/auth-store';
import { useOnline } from '@/hooks/use-online';
import { pendingCount } from '@/sync/queue';
import { isCatalogStale, runSync } from '@/sync/engine';
import { darkPalette, palette } from '@/lib/theme';
import { useColorScheme } from '@/components/useColorScheme';

type TimerMe = { session: { id: string; pausedAt: string | null } | null; elapsedMinutes: number };

export default function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const online = useOnline();
  const flags = tabFlags(useAuthStore((state) => state.user?.permissions));
  const colors = useColorScheme() === 'dark' ? darkPalette : palette;
  const [timer, setTimer] = useState<TimerMe | null>(null);
  const [unread, setUnread] = useState(0);
  const [pending, setPending] = useState(0);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    try {
      if (online) {
        await runSync();
        setTimer(await api<TimerMe>('/timer/me'));
        const list = await apiList<unknown[]>('/notifications?unread=true&limit=1');
        setUnread(list.total);
      }
      setPending(await pendingCount());
      setStale(await isCatalogStale());
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  useEffect(() => {
    void load();
  }, [online]);
  const pauseOrResume = async () => {
    try {
      await api(timer?.session?.pausedAt ? '/timer/resume' : '/timer/pause', { method: 'POST' });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Screen scroll>
      <Text style={{ fontSize: 24, fontWeight: '700', color: colors.primary }}>{t('tabs.home')}</Text>
      {stale ? <Text style={{ color: colors.accent, fontSize: 16 }}>{t('home.catalogStale')}</Text> : null}
      <Text style={{ color: colors.muted, fontSize: 16 }}>{t('home.pending')}: {pending}</Text>
      <Text style={{ color: colors.muted, fontSize: 16 }}>{t('home.unread')}: {unread}</Text>
      <View style={{ backgroundColor: colors.card, padding: 16, borderRadius: 12, gap: 8 }}>
        <Text style={{ fontSize: 18, color: colors.text }}>{t('home.timer')}</Text>
        <Text style={{ fontSize: 16, color: colors.text }}>{timer?.elapsedMinutes ?? 0} min</Text>
        {timer?.session ? (
          <View style={{ gap: 8 }}>
            <PrimaryButton label={timer.session.pausedAt ? t('home.resume') : t('home.pause')} onPress={() => void pauseOrResume()} />
            <PrimaryButton
              label={t('home.stop')}
              onPress={() => void api('/timer/stop', { method: 'POST' }).then(load).catch((err) => setError(errorMessage(err)))}
            />
          </View>
        ) : (
          <Text style={{ color: colors.muted, fontSize: 16 }}>{t('tasks.title')}</Text>
        )}
      </View>
      {flags.hse ? (
        <PrimaryButton
          label={t('home.hse')}
          disabled={!online}
          onPress={() => (online ? router.push('/hse') : setError(t('errors.HSE_OFFLINE')))}
        />
      ) : null}
      {error ? <Text style={{ color: colors.danger, fontSize: 16 }}>{error}</Text> : null}
    </Screen>
  );
}
