import { Redirect } from 'expo-router';
import { useAuthStore } from '@/lib/auth-store';

export default function Index() {
  const ready = useAuthStore((state) => state.ready);
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.accessToken);
  if (!ready) {
    return null;
  }
  if (!token || !user) {
    return <Redirect href="/login" />;
  }
  if (user.mustChangePassword) {
    return <Redirect href="/change-password" />;
  }
  return <Redirect href="/(tabs)" />;
}
