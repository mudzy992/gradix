import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Crypto from 'expo-crypto';
import { Screen } from '@/components/screen';
import { Field } from '@/components/field';
import { PrimaryButton } from '@/components/primary-button';
import { errorMessage } from '@/lib/errors';
import { readOrCreateDeviceId } from '@/lib/secure';
import { enqueue } from '@/sync/queue';
import { isOnline } from '@/sync/net';
import { loadCatalog, runSync, type Catalog } from '@/sync/engine';
import { api } from '@/lib/api';
import { darkPalette, palette } from '@/lib/theme';
import { useColorScheme } from '@/components/useColorScheme';

export default function DiaryScreen() {
  const { t } = useTranslation();
  const colors = useColorScheme() === 'dark' ? darkPalette : palette;
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [projectId, setProjectId] = useState('');
  const [weather, setWeather] = useState('');
  const [work, setWork] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void loadCatalog().then((row) => {
      setCatalog(row);
      if (row?.projects[0]) {
        setProjectId(row.projects[0].id);
      }
    });
  }, []);
  const handleSave = async () => {
    try {
      const date = new Date().toISOString().slice(0, 10);
      const payload = { projectId, date, weather, workDescription: work };
      if (await isOnline()) {
        await api('/diary', { method: 'POST', body: payload });
      } else {
        await enqueue({
          type: 'DIARY',
          localId: Crypto.randomUUID(),
          deviceId: await readOrCreateDeviceId(),
          payload,
        });
      }
      await runSync();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Screen scroll>
      <Text style={{ fontSize: 24, fontWeight: '700', color: colors.primary }}>{t('diary.title')}</Text>
      <Text style={{ color: colors.muted, fontSize: 16 }}>
        {catalog?.projects.find((row) => row.id === projectId)?.name ?? t('trips.project')}
      </Text>
      <Field label={t('diary.weather')} value={weather} onChangeText={setWeather} />
      <Field label={t('diary.work')} value={work} onChangeText={setWork} />
      <PrimaryButton label={t('diary.save')} onPress={() => void handleSave()} />
      {error ? <Text style={{ color: colors.danger, fontSize: 16 }}>{error}</Text> : null}
    </Screen>
  );
}
