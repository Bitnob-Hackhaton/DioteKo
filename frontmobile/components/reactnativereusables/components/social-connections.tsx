
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  signInWithGoogle,
  type GoogleSession,
} from '@/services/appwriteAuth';
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Text, View } from 'react-native';
import Toast from 'react-native-toast-message';
import { Button } from './ui/button';

type SocialConnectionsProps = {
  onGoogleSuccess?: (session: GoogleSession) => void;
};

const SOCIAL_CONNECTION_STRATEGIES = [
  {
    type: 'oauth_apple',
    label: 'Apple',
    source: { uri: 'https://img.clerk.com/static/apple.png?width=160' },
    useTint: true,
  },
  {
    type: 'oauth_google',
    label: 'Google',
    source: { uri: 'https://img.clerk.com/static/google.png?width=160' },
    useTint: false,
  },
  /*{
    type: 'oauth_github',
    label: 'GitHub',
    source: { uri: 'https://img.clerk.com/static/github.png?width=160' },
    useTint: true,
  },*/
];


export function SocialConnections({ onGoogleSuccess }: SocialConnectionsProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [isLoading, setIsLoading] = useState(false);

  const handleConnectionPress = async (strategyType: string, strategyLabel: string) => {
    if (strategyType !== 'oauth_google') {
      Toast.show({
        type: 'error',
        text1: `${strategyLabel} n'est pas encore integre`,
      });
      return;
    }

    try {
      setIsLoading(true);
      console.log('[Google] login button pressed');

      const session = await signInWithGoogle();
      console.log('[Google] login success');
      onGoogleSuccess?.(session);
      Toast.show({
        type: 'success',
        text1: 'Connexion Google reussie',
      });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Connexion Google echouee';
      const message = /status\s*\d{3}|request failed|server|serveur/i.test(rawMessage)
        ? 'Serveur indisponible. Reessaie plus tard.'
        : rawMessage;
      if (__DEV__) console.warn('[Google] login failure:', rawMessage);

      const isBackendError =
        rawMessage.toLowerCase().includes('timeout')
        || /status\s*\d{3}|request failed|server|serveur/i.test(rawMessage);

      if (isBackendError) {
        Alert.alert(
          'Probleme backend',
          'Le backend est indisponible ou ne repond pas. Reessaie plus tard.'
        );
      }

      Toast.show({
        type: 'error',
        text1: message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center' }}>
        {SOCIAL_CONNECTION_STRATEGIES.map((strategy) => {
          // For Apple and GitHub, use white icon in dark mode, black in light
          const tintColor = strategy.useTint
            ? colorScheme === 'dark' ? 'white' : 'black'
            : undefined;
          return (
            <Button
              key={strategy.type}
              variant="outline"
              size="sm"
              disabled={isLoading}
              style={{ flex: 1, minWidth: 90, maxWidth: 120, marginHorizontal: 4, backgroundColor: colors.fieldBg, borderColor: colors.fieldBorder, borderWidth: 1 }}
              accessibilityLabel={`Sign in with ${strategy.label}`}
              onPress={() => handleConnectionPress(strategy.type, strategy.label)}>
              {isLoading && strategy.type === 'oauth_google' ? (
                <ActivityIndicator size="small" color={colors.text} style={{ marginRight: 6 }} />
              ) : (
                <Image
                  style={{ width: 18, height: 18, marginRight: 6, tintColor }}
                  source={strategy.source}
                  resizeMode="contain"
                />
              )}
              <Text style={{ color: colors.text, fontWeight: '500', fontSize: 14 }}>
                {strategy.label}
              </Text>
            </Button>
          );
        })}
      </View>
      
    </>
  );
}