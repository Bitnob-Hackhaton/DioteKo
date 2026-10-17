
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { TextInput } from 'react-native';

function Input({ className, style, ...props }: React.ComponentProps<typeof TextInput> & { id?: string; className?: string; ref?: React.Ref<TextInput> }) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  return (
    <TextInput
      style={[
        {
          backgroundColor: colors.fieldBg,
          color: colors.text,
          borderColor: colors.fieldBorder,
          borderWidth: 1,
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 12,
          fontSize: 16,
        },
        style,
      ]}
      placeholderTextColor={colors['text.muted']}
      {...props}
    />
  );
}

export { Input };

