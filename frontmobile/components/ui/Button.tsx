import React from 'react';
import { ActivityIndicator, TouchableOpacity, Text, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  style?: ViewStyle;
  textStyle?: TextStyle;
  // `loading` : action en cours (spinner, plus de double appui). `disabled` : bouton inactif.
  loading?: boolean;
  disabled?: boolean;
}

export const Button = ({
  title,
  onPress,
  variant = 'primary',
  style,
  textStyle,
  loading = false,
  disabled = false,
}: ButtonProps) => {
  const inactive = disabled || loading;
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const buttonStyles = [
    styles.button,
    {
      backgroundColor: variant === 'primary' ? colors['brand.primary'] : colors['surface.default'],
    },
    inactive && styles.inactive,
    style,
  ];

  const textStyles = [
    styles.text,
    {
      color: variant === 'primary' ? colors['brand.primary.on'] : colors['text.primary'],
    },
    textStyle,
  ];

  return (
    <TouchableOpacity
      style={buttonStyles}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors['brand.primary.on'] : colors['text.primary']} />
      ) : (
        <Text style={textStyles}>{title}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  text: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  inactive: {
    opacity: 0.6,
  },
});
