import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

import { useSettingsStore } from '@/store/settings.store';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
export function useColorScheme() {
  const [hasHydrated, setHasHydrated] = useState(false);
  const theme = useSettingsStore((state) => state.theme);
  const isLoaded = useSettingsStore((state) => state.isLoaded);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const systemTheme = useRNColorScheme();

  if (hasHydrated) {
    if (!isLoaded) {
      return systemTheme ?? 'light';
    }

    return theme ?? systemTheme ?? 'light';
  }

  return 'light';
}
