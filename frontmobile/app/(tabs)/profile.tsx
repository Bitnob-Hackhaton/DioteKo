import { Avatar } from '@/components/Avatar';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useGlobalContext } from '@/lib/global-provider';
import { useSettingsStore } from '@/store/settings.store';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useKycStatus } from '@/hooks/use-kyc-status';
import { KYC_STATUS_LABELS, type KycStatus } from '@/services/kyc';
import { Alert, ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

// Declare hors du composant `Profile` : un composant cree pendant le rendu perd son etat a chaque rendu.
const SettingsItem = ({ icon, title, onPress, textStyle, showArrow = true, badge, badgeColor }: any) => {
  const theme = useSettingsStore((state) => state.theme);
  const colors = Colors[theme ?? 'light'];
  const isDanger = textStyle === 'text-danger';
  const activeColor = isDanger ? colors['state.danger.fg'] : colors['text'];
  
  return (
    <TouchableOpacity 
      onPress={onPress} 
      className="flex flex-row items-center justify-between py-4"
    >
      <View className="flex flex-row items-center gap-3">
        <View 
          className="w-10 h-10 rounded-full items-center justify-center" 
          style={{ backgroundColor: colors['surface.raised'] }}
        >
          <IconSymbol name={icon} size={20} color={activeColor} />
        </View>
        <Text 
          className="text-lg font-semibold" 
          style={{ color: activeColor }}
        >
          {title}
        </Text>
      </View>
      <View className="flex flex-row items-center gap-2">
        {badge ? (
          <Text style={{ color: badgeColor ?? colors['text.muted'], fontSize: 13, fontWeight: '600' }}>{badge}</Text>
        ) : null}
        {showArrow && <IconSymbol name="chevron.right" size={20} color={colors['text.muted']} />}
      </View>
    </TouchableOpacity>
  );
};

const Profile = () => {
  const { user, logout } = useGlobalContext();
  const router = useRouter();
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const colors = Colors[theme ?? 'light'];
  const { kyc, refresh: refreshKyc } = useKycStatus();
  const kycStatus: KycStatus = kyc?.status ?? 'not_started';
  const kycColor =
    kycStatus === 'verified'
      ? colors['state.success.fg']
      : kycStatus === 'failed' || kycStatus === 'rejected'
        ? colors['state.error.fg']
        : kycStatus === 'pending' || kycStatus === 'manual_review'
          ? colors['state.warning.fg']
          : colors['text.muted'];

  // Statut a jour au retour de l'ecran de verification.
  useFocusEffect(
    useCallback(() => {
      void refreshKyc();
    }, [refreshKyc])
  );

  const handleLogout = () => {
    Alert.alert('Déconnexion', 'Voulez-vous vraiment vous déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Déconnexion',
        style: 'destructive',
        onPress: async () => {
          try {
            await logout();
            Toast.show({
              type: 'success',
              text1: 'Déconnecté',
              text2: 'À bientôt !',
            });
          } catch (error) {
            Alert.alert('Erreur', 'Impossible de se déconnecter');
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView className="h-full" style={{ backgroundColor: colors['background'] }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="pb-32 px-7"
      >
        <View className="flex flex-row items-center justify-between mt-5">
          <Text className="text-2xl font-bold" style={{ color: colors['text'] }}>Profil</Text>
          <TouchableOpacity 
            className="w-10 h-10 rounded-full items-center justify-center"
            style={{ backgroundColor: colors['surface.raised'] }}
          >
            <IconSymbol name="bell.fill" size={24} color={colors['text']} />
          </TouchableOpacity>
        </View>

        <View className="flex flex-row justify-center mt-8">
          <View className="flex flex-col items-center relative">
            <Avatar user={user} size={176} />
            <TouchableOpacity 
              className="absolute bottom-1 right-2 p-2 rounded-full border-2"
              style={{ backgroundColor: colors['brand.primary'], borderColor: colors['background'] }}
            >
              <IconSymbol name="square.and.pencil" size={18} color="white" />
            </TouchableOpacity>
          </View>
        </View>

        <View className="items-center mt-4">
          <Text className="text-2xl font-bold" style={{ color: colors['text'] }}>
            {user?.displayName || user?.name || 'Utilisateur'}
          </Text>
          <Text className="text-base font-medium" style={{ color: colors['text'] }}>
            {user?.email || 'Vérification en cours...'}
          </Text>
        </View>

        <View className="flex flex-col mt-10">
          <SettingsItem
            icon="faceid"
            title="Vérification d'identité"
            badge={KYC_STATUS_LABELS[kycStatus]}
            badgeColor={kycColor}
            onPress={() => router.push('/kyc')}
          />
          <SettingsItem icon="person.fill" title="Mon Compte" />
          <SettingsItem icon="shield.fill" title="Sécurité & Confidentialité" />
          <SettingsItem icon="bell.fill" title="Notifications" />
          <View className="flex flex-row items-center justify-between py-4">
            <View className="flex flex-row items-center gap-3">
              <View
                className="w-10 h-10 rounded-full items-center justify-center"
                style={{ backgroundColor: colors['surface.raised'] }}
              >
                <IconSymbol
                  name={theme === 'dark' ? 'moon.fill' : 'sun.max.fill'}
                  size={20}
                  color={colors['text']}
                />
              </View>
              <View>
                <Text className="text-lg font-semibold" style={{ color: colors['text'] }}>
                  Mode sombre
                </Text>
                <Text style={{ color: colors['text.muted'], fontSize: 13 }}>
                  {theme === 'dark' ? 'Activé' : 'Désactivé'}
                </Text>
              </View>
            </View>
            <Switch
              value={theme === 'dark'}
              onValueChange={(value) => setTheme(value ? 'dark' : 'light')}
              trackColor={{ false: colors['surface.raised'], true: colors['brand.primary'] }}
              thumbColor={theme === 'dark' ? colors['brand.primary.on'] : colors['text.muted']}
            />
          </View>
        </View>

        <View 
          className="flex flex-col mt-5 border-t pt-5" 
          style={{ borderTopColor: colors['surface.raised'] }}
        >
          <SettingsItem icon="gear" title="Paramètres Avancés" />
          <SettingsItem icon="questionmark.circle.fill" title="Centre d'aide" />
        </View>

        <View 
          className="flex flex-col mt-5 border-t pt-5" 
          style={{ borderTopColor: colors['surface.raised'] }}
        >
          <SettingsItem 
            icon="logout" 
            title="Déconnexion" 
            textStyle="text-danger" 
            showArrow={false} 
            onPress={handleLogout}
          />
        </View>
        
        <View className="mt-10 items-center">
          <Text className="text-xs font-medium" style={{ color: colors['text'] }}>
            Version 1.0.0 (Beta)
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default Profile;
