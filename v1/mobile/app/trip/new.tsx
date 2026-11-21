import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
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

export default function NewTripScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useColorScheme() === 'dark' ? darkPalette : palette;
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [projectId, setProjectId] = useState('');
  const [machineId, setMachineId] = useState('');
  const [materialId, setMaterialId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [originText, setOrigin] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const row = (await loadCatalog()) ?? (await refreshCatalog());
      setCatalog(row);
      setProjectId(row?.projects[0]?.id ?? '');
      setMachineId(row?.machines.find((item) => item.type === 'TRUCK')?.id ?? '');
      setMaterialId(row?.materials[0]?.id ?? '');
    })();
  }, []);
  const handleSave = async () => {
    try {
      const payload = { projectId, machineId, materialId, quantity, originText };
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (await isOnline()) {
        await api('/trips', { method: 'POST', body: payload });
      } else {
        await enqueue({
          type: 'TRIP',
          localId: Crypto.randomUUID(),
          deviceId: await readOrCreateDeviceId(),
          payload,
        });
      }
      await runSync();
      router.back();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Screen scroll>
      <Stack.Screen options={{ headerShown: true, title: t('trips.record') }} />
      <PickerList label={t('trips.project')} items={(catalog?.projects ?? []).map((row) => ({ id: row.id, label: row.name }))} value={projectId} onChange={setProjectId} color={colors.primary} muted={colors.muted} card={colors.card} />
      <PickerList label={t('trips.truck')} items={(catalog?.machines ?? []).filter((row) => row.type === 'TRUCK').map((row) => ({ id: row.id, label: row.name }))} value={machineId} onChange={setMachineId} color={colors.primary} muted={colors.muted} card={colors.card} />
      <PickerList label={t('trips.material')} items={(catalog?.materials ?? []).map((row) => ({ id: row.id, label: row.name }))} value={materialId} onChange={setMaterialId} color={colors.primary} muted={colors.muted} card={colors.card} />
      <Field label={t('trips.quantity')} value={quantity} onChangeText={setQuantity} keyboardType="numeric" />
      <Field label={t('trips.origin')} value={originText} onChangeText={setOrigin} />
      <PrimaryButton label={t('trips.record')} onPress={() => void handleSave()} />
      {error ? <Text style={{ color: colors.danger, fontSize: 16 }}>{error}</Text> : null}
    </Screen>
  );
}
