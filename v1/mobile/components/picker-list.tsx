import { Pressable, Text, View } from 'react-native';
import { minTap } from '@/lib/theme';

type Item = { id: string; label: string };

type Props = {
  label: string;
  items: Item[];
  value: string;
  onChange: (id: string) => void;
  color: string;
  muted: string;
  card: string;
};

export function PickerList({ label, items, value, onChange, color, muted, card }: Props) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: muted, fontSize: 14 }}>{label}</Text>
      {items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          onPress={() => onChange(item.id)}
          style={{
            minHeight: minTap,
            borderRadius: 10,
            justifyContent: 'center',
            paddingHorizontal: 12,
            backgroundColor: value === item.id ? color : card,
          }}
        >
          <Text style={{ color: value === item.id ? '#fff' : color, fontSize: 16 }}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
