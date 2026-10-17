import { Tabs } from 'expo-router';
import React from 'react';
import { Platform, View } from 'react-native';
import {NativeTabs} from 'expo-router/unstable-native-tabs';
import { Colors } from '@/constants/theme';
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSettingsStore } from '@/store/settings.store';

export default function TabLayout() {
  const insets = useSafeAreaInsets();

    const theme = useSettingsStore((state) => state.theme);
    const colors = Colors[theme ?? 'light'];

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.tint}
      tintColor={colors.tint}
      labelStyle={{ fontSize: 12, fontWeight: '600' }}
      >
      <NativeTabs.Trigger name="index"> 
        <NativeTabs.Trigger.Label>Accueil</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house.fill" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="CertificateFormScreen">
        <NativeTabs.Trigger.Label>Demande</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="doc.text.fill" />
      </NativeTabs.Trigger>

      
      <NativeTabs.Trigger name="VerificationScreen">
        <NativeTabs.Trigger.Label>Verification</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="checkmark.seal.fill" />
      </NativeTabs.Trigger>



      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profil</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.fill" />
      </NativeTabs.Trigger>

      {/* <Tabs.Screen
        name="PaymentScreen"
        options={{
          title: 'Payment',
          tabBarIcon: ({ color }: { color: string }) => <IconSymbol size={28} name="creditcard.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="QRScannerScreen"
        options={{
          title: 'Scanner',
          tabBarIcon: ({ color }: { color: string }) => <IconSymbol size={28} name="qrcode" color={color} />,
        }}
      /> 
      <Tabs.Screen
        name="VerificationScreen"
        options={{
          title: 'Verify',
          tabBarIcon: ({ color }: { color: string }) => <IconSymbol size={28} name="checkmark.seal.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ color }: { color: string }) => <IconSymbol size={28} name="person.fill" color={color} />,
        }}
      />
      {/* <Tabs.Screen
        name="PDFViewerScreen"
        options={{
          title: 'Certificate',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="doc.text.fill" color={color} />,
        }}
      /> */}
    </NativeTabs>
  );
}
