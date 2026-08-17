import { useState } from 'react';
import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/screen';
import { Field } from '@/components/field';
import { PrimaryButton } from '@/components/primary-button';
import { api, logoutRequest } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { palette } from '@/lib/theme';

export default function ChangePasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const handleSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      await logoutRequest();
      router.replace('/login');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <Screen scroll>
      <Text style={{ fontSize: 22, fontWeight: '700', color: palette.primary }}>{t('auth.mustChange')}</Text>
      <Field label={t('auth.currentPassword')} value={currentPassword} onChangeText={setCurrent} secure />
      <Field label={t('auth.newPassword')} value={newPassword} onChangeText={setNew} secure />
      <Text style={{ color: palette.muted, fontSize: 16 }}>{t('auth.minPassword')}</Text>
      {error ? <Text style={{ color: palette.danger, fontSize: 16 }}>{error}</Text> : null}
      <PrimaryButton label={t('auth.changePassword')} onPress={() => void handleSubmit()} loading={loading} />
    </Screen>
  );
}
