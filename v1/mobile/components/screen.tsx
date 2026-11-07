import { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { darkPalette, palette } from '@/lib/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { OfflineBar } from '@/components/offline-bar';

type Props = { children: ReactNode; scroll?: boolean };

export function Screen({ children, scroll }: Props) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const colors = scheme === 'dark' ? darkPalette : palette;
  const body = (
    <View style={{ padding: 16, gap: 12, paddingBottom: 32 }}>{children}</View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <OfflineBar />
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled">{body}</ScrollView> : body}
    </View>
  );
}
