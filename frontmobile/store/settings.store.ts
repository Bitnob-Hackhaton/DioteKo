import { useColorScheme } from 'react-native';
import { create } from 'zustand';

import { SettingsState, ThemeType } from '@/types/settings';
import { getItemStorage, removeItemStorage, setItemStorage } from '@/utils/AsyncStorage';

export const useSettingsStore = create<SettingsState>((set) => ({
  isLoaded: false,
  theme: 'light',
  notificationsEnabled: true,
  faceIdEnabled: false,
  language: 'en',

  setTheme: async (theme) => {
    set({ theme });
    await setItemStorage('theme', theme);
  },

  setNotificationsEnabled: async (enabled) => {
    set({ notificationsEnabled: enabled });
    await setItemStorage('notificationsEnabled', enabled);
  },

  setFaceIdEnabled: async (enabled) => {
    set({ faceIdEnabled: enabled });
    await setItemStorage('faceIdEnabled', enabled);
  },

  setLanguage: async (language) => {
    set({ language });
    await setItemStorage('language', language);
  },

  loadSettings: async (systemTheme: ThemeType) => {
    const storedTheme = await getItemStorage<ThemeType>('theme');
    const notificationsEnabled = await getItemStorage<boolean>('notificationsEnabled');
    const faceIdEnabled = await getItemStorage<boolean>('faceIdEnabled');
    const language = await getItemStorage<string>('language');

    set({
      isLoaded: true,
      theme: storedTheme ?? systemTheme,
      notificationsEnabled: notificationsEnabled ?? true,
      faceIdEnabled: faceIdEnabled ?? false,
      language: language ?? 'en',
    });
  },

  clearSettings: async () => {
    await removeItemStorage('theme');
    await removeItemStorage('notificationsEnabled');
    await removeItemStorage('faceIdEnabled');
    await removeItemStorage('language');

    set({
      isLoaded: true,
      theme: 'light',
      notificationsEnabled: true,
      faceIdEnabled: false,
      language: 'en',
    });
  },
}));

export const useSystemTheme = (): ThemeType => {
  const colorScheme = useColorScheme();
  return colorScheme === 'dark' ? 'dark' : 'light';
};
