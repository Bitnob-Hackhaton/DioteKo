import { useColorScheme as useNativeColorScheme } from 'react-native';

import { useSettingsStore } from '@/store/settings.store';

export function useColorScheme() {
  const theme = useSettingsStore((state) => state.theme);
  const isLoaded = useSettingsStore((state) => state.isLoaded);
  const systemTheme = useNativeColorScheme();

  if (!isLoaded) {
    return systemTheme ?? 'light';
  }

  return theme ?? systemTheme ?? 'light';
}
