import { SignUpForm } from "@/components/reactnativereusables/auth/sign-up-form";
import * as React from "react";
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';


const SignUpScreen = () => {
  // Marges de la barre d'etat et de la barre de navigation : sans elles le haut du formulaire passait dessous.
  const insets = useSafeAreaInsets();
  const colors = useColorScheme() === 'dark' ? Colors.dark : Colors.light;
  return (
    <View style={{ flex: 1, backgroundColor: colors.authBg }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 16,
        }}
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        <View style={{ width: '100%', maxWidth: 400 }}>
          <SignUpForm />
        </View>
      </ScrollView>
    </View>
  );
}

export default SignUpScreen;