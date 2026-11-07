import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/screen';
import { PrimaryButton } from '@/components/primary-button';
import { api, apiList } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { tabFlags } from '@/lib/permissions';
import { useAuthStore } from '@/lib/auth-store';
import { startTimer } from '@/lib/timer-actions';
import { darkPalette, minTap, palette } from '@/lib/theme';
import { useColorScheme } from '@/components/useColorScheme';

type Task = { id: string; title: string; status: string };

export default function TasksScreen() {
  const { t } = useTranslation();
  const flags = tabFlags(useAuthStore((state) => state.user?.permissions));
  const colors = useColorScheme() === 'dark' ? darkPalette : palette;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    try {
      const list = await apiList<Task[]>('/tasks?limit=50');
      setTasks(list.data);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const handleStart = async (taskId: string) => {
    try {
      await startTimer(taskId);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const handleComplete = async (taskId: string) => {
    try {
      await api(`/tasks/${taskId}/complete`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Screen scroll>
      <Text style={{ fontSize: 24, fontWeight: '700', color: colors.primary }}>{t('tasks.title')}</Text>
      {tasks.length === 0 ? <Text style={{ color: colors.muted, fontSize: 16 }}>{t('tasks.empty')}</Text> : null}
      {tasks.map((task) => (
        <View key={task.id} style={{ backgroundColor: colors.card, padding: 12, borderRadius: 12, gap: 8 }}>
          <Text style={{ fontSize: 16, color: colors.text }}>{task.title}</Text>
          <Text style={{ color: colors.muted }}>{task.status}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void handleStart(task.id)}
            style={{ minHeight: minTap, justifyContent: 'center' }}
          >
            <Text style={{ color: colors.accent, fontSize: 16 }}>{t('home.start')}</Text>
          </Pressable>
          {flags.complete ? (
            <PrimaryButton label={t('tasks.complete')} onPress={() => void handleComplete(task.id)} />
          ) : null}
        </View>
      ))}
      {error ? <Text style={{ color: colors.danger, fontSize: 16 }}>{error}</Text> : null}
    </Screen>
  );
}
