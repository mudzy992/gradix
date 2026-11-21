import 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useBootstrap } from '@/hooks/use-bootstrap';
import { useAuthStore } from '@/lib/auth-store';
import { useColorScheme } from '@/components/useColorScheme';
import { palette, darkPalette } from '@/lib/theme';
import '@/i18n';

export { ErrorBoundary } from 'expo-router';

const queryClient = new QueryClient();

export default function RootLayout() {
  useBootstrap();
  const ready = useAuthStore((state) => state.ready);
  const scheme = useColorScheme();
  const colors = scheme === 'dark' ? darkPalette : palette;
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
      {ready ? null : (
        <View
          style={[styles.boot, { backgroundColor: colors.background }]}
          pointerEvents="auto"
        >
          <ActivityIndicator color={colors.primary} />
        </View>
      )}
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  boot: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
});
