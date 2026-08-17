import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Crypto from 'expo-crypto';
import { Screen } from '@/components/screen';
import { Field } from '@/components/field';
import { PrimaryButton } from '@/components/primary-button';
import { PickerList } from '@/components/picker-list';
import { errorMessage } from '@/lib/errors';
import { readOrCreateDeviceId } from '@/lib/secure';
import { enqueue } from '@/sync/queue';
import { isOnline } from '@/sync/net';
import { loadCatalog, refreshCatalog, runSync, type Catalog } from '@/sync/engine';
import { api } from '@/lib/api';
import { darkPalette, palette } from '@/lib/theme';
import { useColorScheme } from '@/components/useColorScheme';

export default function FuelScreen() {
  const { t } = useTranslation();
  const colors = useColorScheme() === 'dark' ? darkPalette : palette;
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [machineId, setMachineId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [liters, setLiters] = useState('');
  const [unitPrice, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const row = (await loadCatalog()) ?? (await refreshCatalog());
      setCatalog(row);
      setMachineId(row?.machines[0]?.id ?? '');
      setProjectId(row?.projects[0]?.id ?? '');
    })();
  }, []);
  const handleSave = async () => {
    try {
      const payload = { machineId, projectId, liters, unitPrice };
      if (await isOnline()) {
        await api('/fuel', { method: 'POST', body: payload });
      } else {
        await enqueue({
          type: 'FUEL',
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
      <Stack.Screen options={{ headerShown: true, title: t('fuel.title') }} />
      <Text style={{ fontSize: 22, fontWeight: '700', color: colors.primary }}>{t('fuel.title')}</Text>
      <PickerList label={t('trips.truck')} items={(catalog?.machines ?? []).map((row) => ({ id: row.id, label: row.name }))} value={machineId} onChange={setMachineId} color={colors.primary} muted={colors.muted} card={colors.card} />
      <PickerList label={t('trips.project')} items={(catalog?.projects ?? []).map((row) => ({ id: row.id, label: row.name }))} value={projectId} onChange={setProjectId} color={colors.primary} muted={colors.muted} card={colors.card} />
      <Field label={t('fuel.liters')} value={liters} onChangeText={setLiters} keyboardType="numeric" />
      <Field label={t('fuel.price')} value={unitPrice} onChangeText={setPrice} keyboardType="numeric" />
      <PrimaryButton label={t('fuel.save')} onPress={() => void handleSave()} />
      {error ? <Text style={{ color: colors.danger, fontSize: 16 }}>{error}</Text> : null}
    </Screen>
  );
}
