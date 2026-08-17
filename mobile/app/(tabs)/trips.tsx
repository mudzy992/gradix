import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/screen';
import { PrimaryButton } from '@/components/primary-button';
import { darkPalette, palette } from '@/lib/theme';
import { useColorScheme } from '@/components/useColorScheme';

export default function TripsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useColorScheme() === 'dark' ? darkPalette : palette;
  return (
    <Screen>
      <Text style={{ fontSize: 24, fontWeight: '700', color: colors.primary }}>{t('trips.title')}</Text>
      <PrimaryButton label={t('trips.record')} onPress={() => router.push('/trip/new')} />
    </Screen>
  );
}
