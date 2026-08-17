import { Redirect, Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/lib/auth-store';
import { tabFlags } from '@/lib/permissions';
import { useColorScheme } from '@/components/useColorScheme';
import { darkPalette, palette } from '@/lib/theme';

export default function TabLayout() {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const flags = tabFlags(user?.permissions);
  const scheme = useColorScheme();
  const colors = scheme === 'dark' ? darkPalette : palette;
  if (user?.mustChangePassword) {
    return <Redirect href="/change-password" />;
  }
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 12 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home') }} />
      <Tabs.Screen name="tasks" options={{ title: t('tabs.tasks'), href: flags.tasks ? undefined : null }} />
      <Tabs.Screen name="trips" options={{ title: t('tabs.trips'), href: flags.trips ? undefined : null }} />
      <Tabs.Screen name="diary" options={{ title: t('tabs.diary'), href: flags.diary ? undefined : null }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile') }} />
    </Tabs>
  );
}
