import * as Haptics from 'expo-haptics';
import { PlatformPressable } from 'expo-router/react-navigation';
import type { ComponentProps } from 'react';

// Expo Router SDK 56+ no longer allows importing '@react-navigation/*' directly, and
// BottomTabBarButtonProps is not exposed on a public path: these are the props of the
// PlatformPressable it is built on.
type HapticTabProps = ComponentProps<typeof PlatformPressable>;

export function HapticTab(props: HapticTabProps) {
  return (
    <PlatformPressable
      {...props}
      onPressIn={(ev) => {
        if (process.env.EXPO_OS === 'ios') {
          // Add a soft haptic feedback when pressing down on the tabs.
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        props.onPressIn?.(ev);
      }}
    />
  );
}
