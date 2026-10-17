import { DarkTheme, DefaultTheme, SplashScreen, Stack, ThemeProvider, useRouter, useSegments } from "expo-router";
import "./global.css"

import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useColorScheme } from '@/hooks/use-color-scheme';
import React, { useEffect } from 'react';

import { useFonts } from 'expo-font';

import { AppProvider } from '@/Provider/AppContext';
import { GlobalProvider, useGlobalContext } from '@/lib/global-provider';
import Toast from 'react-native-toast-message';
import { View, Text, StyleSheet } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useSettingsStore, useSystemTheme } from '@/store/settings.store';

const styles = StyleSheet.create({
  toastWrapper: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  toastContainer: {
    backgroundColor: '#333',
    borderRadius: 25,
    minHeight: 50,
    maxWidth: '100%',
    paddingVertical: 8,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  toastTextBlock: {
    flexShrink: 1,
    marginLeft: 10,
  },
  toastText: {
    fontSize: 16,
    color: '#FFF',
    fontWeight: '600',
  },
  toastSubText: {
    fontSize: 13,
    color: '#DDD',
    marginTop: 2,
  },
});



export const unstable_settings = {
  anchor: '(tabs)',
};



type PillToastProps = {
  icon: 'checkmark.circle.fill' | 'xmark.circle.fill' | 'info.circle.fill';
  color: string;
  text1?: string;
  text2?: string;
};

// Meme rendu pour tous les types de toast (success / error / info) : seul l'icone change.
const PillToast = ({ icon, color, text1, text2 }: PillToastProps) => (
  <View style={styles.toastWrapper}>
    <View style={styles.toastContainer}>
      <IconSymbol name={icon} size={20} color={color} />
      <View style={styles.toastTextBlock}>
        <Text style={styles.toastText} numberOfLines={2}>{text1}</Text>
        {text2 ? <Text style={styles.toastSubText} numberOfLines={2}>{text2}</Text> : null}
      </View>
    </View>
  </View>
);

const toastConfig = {
  success: (props: any) => <PillToast icon="checkmark.circle.fill" color="#4CAF50" text1={props.text1} text2={props.text2} />,
  error: (props: any) => <PillToast icon="xmark.circle.fill" color="#F44336" text1={props.text1} text2={props.text2} />,
  info: (props: any) => <PillToast icon="info.circle.fill" color="#2196F3" text1={props.text1} text2={props.text2} />,
};

SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { isLoggedIn, loading } = useGlobalContext();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isLoggedIn && !inAuthGroup) {
      // Redirect to the sign-in page if not logged in
      router.replace('/(auth)/sign-in');
    } else if (isLoggedIn && inAuthGroup) {
      // Redirect away from the sign-in page if logged in
      router.replace('/(tabs)');
    }
  }, [isLoggedIn, loading, segments, router]);

  if (loading) {
    return null; // Or a splash screen / loading indicator
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal', headerBackTitle: 'Retour' }}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="admin" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const systemTheme = useSystemTheme();
  const isLoaded = useSettingsStore((state) => state.isLoaded);
  const loadSettings = useSettingsStore((state) => state.loadSettings);

  const [fontsLoaded, error] = useFonts({
    "Poppins-Black": require("@/assets/fonts/Poppins-Black.ttf"),
    "Poppins-Bold": require("@/assets/fonts/Poppins-Bold.ttf"),
    "Poppins-ExtraBold": require("@/assets/fonts/Poppins-ExtraBold.ttf"),
    "Poppins-Light": require("@/assets/fonts/Poppins-Light.ttf"),
    "Poppins-Medium": require("@/assets/fonts/Poppins-Medium.ttf"),
    "Poppins-Regular": require("@/assets/fonts/Poppins-Regular.ttf"),
    "Poppins-SemiBold": require("@/assets/fonts/Poppins-SemiBold.ttf"),
    "Poppins-Thin": require("@/assets/fonts/Poppins-Thin.ttf"),
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (fontsLoaded && !isLoaded) {
      loadSettings(systemTheme);
    }
  }, [fontsLoaded, isLoaded, loadSettings, systemTheme]);

  useEffect(() => {
    if (fontsLoaded && isLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, isLoaded]);

  if (!fontsLoaded || !isLoaded) return null;

  return (
    <GlobalProvider>
      <AppProvider>
        <RootLayoutNav />
        <Toast config={toastConfig} />
      </AppProvider>
    </GlobalProvider>
  );
}
