import { Text, TextInput, View } from 'react-native';
import { bodySize, darkPalette, minTap, palette } from '@/lib/theme';
import { useColorScheme } from '@/components/useColorScheme';

type Props = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  secure?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad';
};

export function Field({ label, value, onChangeText, secure, keyboardType }: Props) {
  const scheme = useColorScheme();
  const colors = scheme === 'dark' ? darkPalette : palette;
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.muted, fontSize: 14 }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secure}
        keyboardType={keyboardType}
        autoCapitalize="none"
        style={{
          minHeight: minTap,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          paddingHorizontal: 12,
          fontSize: bodySize,
          color: colors.text,
          backgroundColor: colors.card,
        }}
      />
    </View>
  );
}
