import { Avatar } from '@/components/Avatar';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useGlobalContext } from '@/lib/global-provider';
import { CertificateTypeInfo, getCertificateTypes } from '@/services/api';
import { CERTIFICATE_LABELS } from '@/services/certificate-requests';
import * as Haptics from 'expo-haptics';
import { Stack, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

type CertificateOption = CertificateTypeInfo & {
  title: string;
  description: string;
};

const toOption = (type: CertificateTypeInfo): CertificateOption => ({
  ...type,
  title: CERTIFICATE_LABELS[type.id]?.title ?? type.name,
  description: CERTIFICATE_LABELS[type.id]?.description ?? '',
});

const CertificateFormScreen = () => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user } = useGlobalContext();

  const router = useRouter();

  const [certificateTypes, setCertificateTypes] = useState<CertificateOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadTypes = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const types = await getCertificateTypes();
      setCertificateTypes(types.map(toOption));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Impossible de charger les certificats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTypes();
  }, [loadTypes]);

  const handleSelectCertificate = async (type: CertificateOption) => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // Le formulaire de depot charge lui-meme le type (prix du serveur) a partir de son identifiant.
      router.push(`/certificate/new?type=${encodeURIComponent(type.id)}`);
    } catch (error) {
      console.error('Error navigating to certificate:', error);
      Toast.show({
        type: 'error',
        text1: 'Erreur',
        text2: 'Impossible de continuer',
        visibilityTime: 2500,
      });
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.headerContainer}>
          <View style={styles.userInfo}>
            <Avatar user={user} />
            <View style={styles.welcomeText}>
              {/* <Text style={[styles.greeting, { color: colors['text'] }]}>Bienvenue,</Text> */}
              <Text style={[styles.userName, { color: colors['text'] }]} numberOfLines={1}>
                {user?.displayName || user?.name || 'Utilisateur'}
              </Text>
            </View>
          </View>
          <TouchableOpacity style={[styles.notificationBtn, { borderColor: colors['text.muted'] }]}>
            <IconSymbol name="bell.fill" size={22} color={colors['text']} />
          </TouchableOpacity>
        </View>
        <Text style={[styles.title, { color: colors['text'] }]}>Nouvelle Demande</Text>
        <Text style={[styles.subtitle, { color: colors['text.secondary'] }]}> 
          Choisissez un certificat, remplissez le formulaire, puis payez une fois la demande acceptée.
        </Text>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors['text'] }]}>Type de Certificat</Text>
          {loading && <ActivityIndicator color={colors['brand.primary']} style={styles.stateBlock} />}
          {!loading && loadError && (
            <View style={styles.stateBlock}>
              <Text style={[styles.stateText, { color: colors['text.secondary'] }]}>{loadError}</Text>
              <TouchableOpacity
                style={[styles.retryBtn, { borderColor: colors['brand.primary'] }]}
                onPress={loadTypes}
                accessibilityRole="button"
                accessibilityLabel="Réessayer de charger les certificats"
              >
                <Text style={{ color: colors['brand.primary'], fontWeight: 'bold' }}>Réessayer</Text>
              </TouchableOpacity>
            </View>
          )}
          {!loading && !loadError && certificateTypes.length === 0 && (
            <Text style={[styles.stateText, styles.stateBlock, { color: colors['text.secondary'] }]}>
              Aucun certificat disponible pour le moment.
            </Text>
          )}
          {certificateTypes.map((type) => {
            return (
              <TouchableOpacity
                key={type.id}
                style={[
                  styles.certificateTypeCard,
                  { backgroundColor: colors['surface.default'] },
                ]}
                onPress={() => handleSelectCertificate(type)}
              >
                <View style={styles.certificateTypeInfo}>
                  <Text style={[styles.certificateTypeName, { color: colors['text'] }]}>{type.title}</Text>
                  <Text style={[styles.certificateTypeDescription, { color: colors['text.secondary'] }]}>{type.description}</Text>
                </View>
                <View style={styles.certificateTypePrice}>
                  <Text style={[styles.priceSats, { color: colors['brand.primary'] }]}>
                    {type.priceSats.toLocaleString('fr-FR')} sats
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    height: '100%',
  },
  scrollContent: {
    paddingBottom: 128,
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 24,
    lineHeight: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  certificateTypeCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  certificateTypeInfo: {
    flex: 1,
  },
  certificateTypeName: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  certificateTypeDescription: {
    fontSize: 14,
  },
  certificateTypePrice: {
    alignItems: 'flex-end',
  },
  priceSats: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  stateBlock: {
    marginVertical: 24,
    alignItems: 'center',
  },
  stateText: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 12,
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  welcomeText: {
    marginLeft: 12,
  },
  userName: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  notificationBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default CertificateFormScreen;