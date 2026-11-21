import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/screen';
import { PrimaryButton } from '@/components/primary-button';
import { logoutRequest } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { tabFlags } from '@/lib/permissions';
import { useThemeStore } from '@/lib/theme-store';
import { i18n } from '@/i18n';
import { useOnline } from '@/hooks/use-online';
import { darkPalette, minTap, palette } from '@/lib/theme';
import { useColorScheme } from '@/components/useColorScheme';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const online = useOnline();
  const user = useAuthStore((state) => state.user);
  const flags = tabFlags(user?.permissions);
  const pref = useThemeStore((state) => state.pref);
  const setPref = useThemeStore((state) => state.setPref);
  const colors = useColorScheme() === 'dark' ? darkPalette : palette;
  return (
    <Screen scroll>
      <Text style={{ fontSize: 24, fontWeight: '700', color: colors.primary }}>{t('profile.title')}</Text>
      <Text style={{ fontSize: 16, color: colors.text }}>{user?.firstName} {user?.lastName}</Text>
      <Text style={{ color: colors.muted, fontSize: 16 }}>{user?.email}</Text>
      <Text style={{ color: colors.text, fontSize: 16 }}>{t('profile.theme')}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['light', 'dark', 'system'] as const).map((item) => (
          <Pressable
            key={item}
            accessibilityRole="button"
            onPress={() => void setPref(item)}
            style={{ minHeight: minTap, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 8, backgroundColor: pref === item ? colors.primary : colors.card }}
          >
            <Text style={{ color: pref === item ? '#fff' : colors.text }}>{t(`theme.${item}`)}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable accessibilityRole="button" onPress={() => void i18n.changeLanguage(i18n.language === 'bs' ? 'en' : 'bs')} style={{ minHeight: minTap, justifyContent: 'center' }}>
        <Text style={{ color: colors.accent, fontSize: 16 }}>{t('profile.language')}: {i18n.language}</Text>
      </Pressable>
      {flags.fuel ? <PrimaryButton label={t('profile.fuel')} onPress={() => router.push('/fuel')} /> : null}
      {flags.hse ? (
        <PrimaryButton
          label={t('profile.hse')}
          disabled={!online}
          onPress={() => (online ? router.push('/hse') : undefined)}
        />
      ) : null}
      <PrimaryButton
        label={t('profile.logout')}
        danger
        onPress={() => void logoutRequest().then(() => router.replace('/login'))}
      />
    </Screen>
  );
}
