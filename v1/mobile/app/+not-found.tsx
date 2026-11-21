import { Link, Stack } from 'expo-router';
import { Text, View } from 'react-native';
import { palette } from '@/lib/theme';

export default function NotFoundScreen() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: palette.background }}>
      <Stack.Screen options={{ title: 'Oops' }} />
      <Text style={{ fontSize: 20, color: palette.text }}>This screen doesn't exist.</Text>
      <Link href="/" style={{ marginTop: 16, minHeight: 48, justifyContent: 'center' }}>
        <Text style={{ color: palette.accent, fontSize: 16 }}>Home</Text>
      </Link>
    </View>
  );
}
