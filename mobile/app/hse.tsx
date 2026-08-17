import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/screen';
import { Field } from '@/components/field';
import { PrimaryButton } from '@/components/primary-button';
import { PickerList } from '@/components/picker-list';
import { errorMessage } from '@/lib/errors';
import { api } from '@/lib/api';
import { useOnline } from '@/hooks/use-online';
import { loadCatalog, type Catalog } from '@/sync/engine';
import { darkPalette, palette } from '@/lib/theme';
import { useColorScheme } from '@/components/useColorScheme';

export default function HseScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const online = useOnline();
  const colors = useColorScheme() === 'dark' ? darkPalette : palette;
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [projectId, setProjectId] = useState('');
  const [severity, setSeverity] = useState('LOW');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!online) {
      setError(t('errors.HSE_OFFLINE'));
      return;
    }
    void loadCatalog().then((row) => {
      setCatalog(row);
      setProjectId(row?.projects[0]?.id ?? '');
    });
  }, [online, t]);
  const handleSave = async () => {
    if (!online) {
      setError(t('errors.HSE_OFFLINE'));
      return;
    }
    try {
      await api('/incidents', { method: 'POST', body: { projectId, severity, description } });
      router.back();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Screen scroll>
      <Stack.Screen options={{ headerShown: true, title: t('hse.title') }} />
      <Text style={{ fontSize: 22, fontWeight: '700', color: colors.primary }}>{t('hse.title')}</Text>
      {!online ? <Text style={{ color: colors.danger, fontSize: 16 }}>{t('hse.offline')}</Text> : null}
      <PickerList
        label={t('trips.project')}
        items={(catalog?.projects ?? []).map((row) => ({ id: row.id, label: row.name }))}
        value={projectId}
        onChange={setProjectId}
        color={colors.primary}
        muted={colors.muted}
        card={colors.card}
      />
      <PickerList
        label={t('hse.severity')}
        items={['LOW', 'MEDIUM', 'HIGH'].map((id) => ({ id, label: id }))}
        value={severity}
        onChange={setSeverity}
        color={colors.primary}
        muted={colors.muted}
        card={colors.card}
      />
      <Field label={t('hse.description')} value={description} onChangeText={setDescription} />
      <PrimaryButton label={t('hse.save')} disabled={!online} onPress={() => void handleSave()} />
      {error ? <Text style={{ color: colors.danger, fontSize: 16 }}>{error}</Text> : null}
    </Screen>
  );
}
