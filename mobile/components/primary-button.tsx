import { ActivityIndicator, Pressable, Text } from 'react-native';
import { minTap, palette } from '@/lib/theme';

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
};

export function PrimaryButton({ label, onPress, disabled, loading, danger }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled || loading}
      style={{
        minHeight: minTap,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: danger ? palette.danger : palette.primary,
        opacity: disabled ? 0.5 : 1,
        paddingHorizontal: 16,
      }}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>{label}</Text>
      )}
    </Pressable>
  );
}
