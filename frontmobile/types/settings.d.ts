export type ThemeType = 'light' | 'dark';

export interface SettingsState {
    isLoaded: boolean;
    theme: ThemeType;
    notificationsEnabled: boolean;
    faceIdEnabled: boolean;
    language: string;
    setTheme: (theme: ThemeType) => Promise<void>;
    setNotificationsEnabled: (enabled: boolean) => Promise<void>;
    setFaceIdEnabled: (enabled: boolean) => Promise<void>;
    setLanguage: (language: string) => Promise<void>;
    loadSettings: (systemTheme: ThemeType) => Promise<void>;
    clearSettings: () => Promise<void>;
}
