import { useRouter } from 'expo-router';
import * as React from 'react';
import { View } from 'react-native';
import { SocialConnections } from '../components/social-connections';
import { Button } from '../components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Separator } from '../components/ui/separator';
import { Text } from '../components/ui/text';
 

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useGlobalContext } from '@/lib/global-provider';
import { useAppContext } from '@/Provider/AppContext';

export function SignInForm() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();
  const { setUserData } = useAppContext();
  const { refetch } = useGlobalContext();

  function onSubmit() {
    // TODO: Submit form and navigate to protected screen if successful
  }

  return (
    <View style={{ gap: 24 }}>
      <Card style={{ borderWidth: 1, borderColor: colors.authCardBorder, borderRadius: 16, shadowOpacity: 0.08, shadowRadius: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, elevation: 2, backgroundColor: colors.authCard, padding: 20 }}>
        <CardHeader>
          <CardTitle style={{ textAlign: 'center', fontSize: 22, lineHeight: 30, fontWeight: '700', color: colors.text }}>Sign in to your app</CardTitle>
          <CardDescription style={{ textAlign: 'center', color: colors['text.muted'], marginTop: 4 }}>
            Welcome back! Please sign in to continue
          </CardDescription>
        </CardHeader>
        <CardContent style={{ gap: 20 }}>
          <View style={{ gap: 16 }}>
            <View style={{ gap: 6 }}>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                placeholder="m@example.com"
                keyboardType="email-address"
                autoComplete="email"
                autoCapitalize="none"
                returnKeyType="next"
                submitBehavior="submit"
              />
            </View>
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Label htmlFor="password">Password</Label>
                <Button
                  variant="link"
                  size="sm"
                  style={{ marginLeft: 'auto', height: 18, paddingHorizontal: 4, paddingVertical: 0 }}
                  onPress={() => {
                    // TODO: Navigate to forgot password screen
                  }}>
                  <Text style={{ fontWeight: '400', lineHeight: 18, color: colors['brand.primary'] }}>Forgot your password?</Text>
                </Button>
              </View>
              <Input
                id="password"
                secureTextEntry
                returnKeyType="send"
                onSubmitEditing={onSubmit}
              />
            </View>
            <Button style={{ width: '100%', marginTop: 4, backgroundColor: colors['brand.primary'] }} onPress={onSubmit}>
              <Text style={{ color: colors['brand.primary.on'], fontWeight: '600' }}>Continue</Text>
            </Button>
          </View>
          <Text style={{ textAlign: 'center', fontSize: 14, color: colors['text.muted'], marginTop: 8 }}>
            Don&apos;t have an account?{' '}
            <Text
              style={{ fontSize: 14, textDecorationLine: 'underline', textDecorationStyle: 'solid', color: colors['brand.primary'] }}
              onPress={() => {
                router.replace('/(auth)/sign-up');
              }}
            >
              Sign up
            </Text>
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 8 }}>
            <Separator style={{ flex: 1 }} />
            <Text style={{ color: colors['text.muted'], paddingHorizontal: 12, fontSize: 14 }}>or</Text>
            <Separator style={{ flex: 1 }} />
          </View>
          <SocialConnections
            onGoogleSuccess={(session) => {
              // Refresh the global auth state
              refetch();
            }}
          />
        </CardContent>
      </Card>
    </View>
  );
}