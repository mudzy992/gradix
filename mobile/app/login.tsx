import { useState } from 'react';
import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/screen';
import { Field } from '@/components/field';
import { PrimaryButton } from '@/components/primary-button';
import { loginRequest } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { i18n } from '@/i18n';
import { palette } from '@/lib/theme';

export default function LoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const handleSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      const user = await loginRequest(identifier.trim(), password);
      await i18n.changeLanguage(user.locale);
      if (user.mustChangePassword) {
        router.replace('/change-password');
        return;
      }
      router.replace('/(tabs)');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <Screen scroll>
      <Text style={{ fontSize: 28, fontWeight: '700', color: palette.primary }}>{t('app.name')}</Text>
      <Field label={t('auth.emailOrPhone')} value={identifier} onChangeText={setIdentifier} />
      <Field label={t('auth.password')} value={password} onChangeText={setPassword} secure />
      {error ? <Text style={{ color: palette.danger, fontSize: 16 }}>{error}</Text> : null}
      <PrimaryButton label={t('auth.submit')} onPress={() => void handleSubmit()} loading={loading} />
    </Screen>
  );
}
