import React from 'react';
import { View, Text, Image, StyleSheet, StyleProp, ViewStyle, ImageStyle, TextStyle } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface AvatarProps {
  user: {
    name?: string;
    displayName?: string;
    picture?: string;
    avatar?: string;
  } | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

export const Avatar = ({ user, size = 48, style }: AvatarProps) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  const fullName = user?.displayName ?? user?.name;
  const initials = fullName
    ? fullName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) 
    : 'US';

  const containerStyle: StyleProp<ViewStyle> = [
    {
      width: size,
      height: size,
      borderRadius: size / 2,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    style,
  ];

  if (user?.picture || user?.avatar) {
    return (
      <View style={containerStyle}>
        <Image 
          source={{ uri: user.picture || user.avatar }} 
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
        />
      </View>
    );
  }

  return (
    <View style={[containerStyle, { backgroundColor: colors['brand.primary'] }]}>
      <Text style={{ 
        color: '#FFFFFF', 
        fontSize: size * 0.4, 
        fontWeight: 'bold' 
      }}>
        {initials}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({});
