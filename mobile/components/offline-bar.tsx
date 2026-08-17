import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useOnline } from '@/hooks/use-online';
import { darkPalette, palette } from '@/lib/theme';
import { useColorScheme } from '@/components/useColorScheme';

export function OfflineBar() {
  const { t } = useTranslation();
  const online = useOnline();
  const scheme = useColorScheme();
  const colors = scheme === 'dark' ? darkPalette : palette;
  if (online) {
    return null;
  }
  return (
    <View style={{ backgroundColor: colors.accent, paddingVertical: 8, paddingHorizontal: 16 }}>
      <Text style={{ color: '#fff', fontSize: 16 }}>{t('offline.banner')}</Text>
    </View>
  );
}
