import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { SelectiveShareModal } from '@/components/ui/SelectiveShareModal';
import { Timeline } from '@/components/ui/Timeline';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useMyCertificateRequests } from '@/hooks/use-my-certificate-requests';
import { getCertificateTypes, type CertificateTypeInfo } from '@/services/api';
import { CERTIFICATE_LABELS } from '@/services/certificate-requests';
import { useRouter } from 'expo-router';
import { useGlobalContext } from '@/lib/global-provider';
import React, { useEffect, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import {
    ActivityIndicator,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettingsStore } from '@/store/settings.store';

const HomeScreen = () => {
  const theme = useSettingsStore((state) => state.theme);
    const colors = Colors[theme ?? 'light'];
  const router = useRouter();

  const [services, setServices] = useState<CertificateTypeInfo[]>([]);
  const [certToShare, setCertToShare] = useState<any>(null);
  const { user } = useGlobalContext();
  const { items, stats, loading, error, reload } = useMyCertificateRequests({ limit: 3, withStats: true });
  const recentCerts = items;
  // Toutes les etapes avant l'emission (verification, paiement, generation) ; ni les emises ni les refusees.
  const pendingCount = stats
    ? stats.byStatus.pending +
      stats.byStatus.accepted +
      stats.byStatus.needs_info +
      stats.byStatus.awaiting_payment +
      stats.byStatus.paid +
      stats.byStatus.issuing
    : 0;

  useEffect(() => {
    let cancelled = false;
    getCertificateTypes()
      .then((types) => {
        if (!cancelled) setServices(types);
      })
      .catch((servicesError) => console.error('Error fetching certificate types:', servicesError));
    return () => {
      cancelled = true;
    };
  }, []);

  const handleServiceSelection = (service: CertificateTypeInfo) => {
    router.push(`/certificate/new?type=${encodeURIComponent(service.id)}`);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors['text']} />}
      >
        <View style={styles.headerContainer}>
          <View style={styles.userInfo}>
            <Avatar user={user} />
            <View style={styles.welcomeText}>
              <Text style={[styles.greeting, { color: colors['text'] }]}>Bienvenue,</Text>
              <Text style={[styles.userName, { color: colors['text'] }]} numberOfLines={1}>
                {user?.displayName || user?.name || 'Utilisateur'}
              </Text>
            </View>
          </View>
          <TouchableOpacity style={[styles.notificationBtn, { borderColor: colors['text.muted'] }]}>
            <IconSymbol name="bell.fill" size={22} color={colors['text']} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={colors['brand.primary']} style={{ marginTop: 32 }} />
        ) : (
          <>
            <View style={styles.statsContainer}>
              <Card style={styles.statCard}>
                <View style={styles.statHeader}>
                  <IconSymbol name="shield.fill" size={20} color={colors['brand.secondary']} />
                  <Text style={[styles.statLabel, { color: colors['brand.secondary'], marginLeft: 8 }]}>Total</Text>
                </View>
                <Text style={[styles.statValue, { color: colors['brand.secondary'] }]}>{stats?.total ?? 0}</Text>
              </Card>

              <Card style={styles.statCard}>
                <View style={styles.statHeader}>
                  <IconSymbol name="checkmark.shield.fill" size={20} color={colors['state.success.fg']} />
                  <Text style={[styles.statLabel, { color: colors['state.success.fg'], marginLeft: 8 }]}>Valides</Text>
                </View>
                <Text style={[styles.statValue, { color: colors['state.success.fg'] }]}>{stats?.byValidity.valid ?? 0}</Text>
              </Card>

              <Card style={styles.statCard}>
                <View style={styles.statHeader}>
                  <IconSymbol name="hourglass" size={20} color={colors['state.warning.fg']} />
                  <Text style={[styles.statLabel, { color: colors['state.warning.fg'], marginLeft: 8 }]}>En attente</Text>
                </View>
                <Text style={[styles.statValue, { color: colors['state.warning.fg'] }]}>{pendingCount}</Text>
              </Card>

              <Card style={styles.statCard}>
                <View style={styles.statHeader}>
                  <IconSymbol name="clock.fill" size={20} color={colors['state.error.fg']} />
                  <Text style={[styles.statLabel, { color: colors['state.error.fg'], marginLeft: 8 }]}>Expiration</Text>
                </View>
                <Text style={[styles.statValue, { color: colors['state.error.fg'] }]}>{stats?.byValidity.expiring_soon ?? 0}</Text>
              </Card>
            </View>

            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors['text'] }]}>Demandes récentes</Text>
              {error ? (
                <View>
                  <Text style={[styles.certIssuer, { color: colors['state.error.fg'] }]}>{error}</Text>
                  <Button title="Réessayer" onPress={reload} variant="secondary" style={{ marginTop: 12 }} />
                </View>
              ) : recentCerts.length === 0 ? (
                <Text style={[styles.certIssuer, { color: colors['text.muted'] }]}>
                  Vous n&apos;avez pas encore fait de demande.
                </Text>
              ) : (
                recentCerts.map((cert) => (
                  <TouchableOpacity key={cert.id} onPress={() => router.push(`/certificate/${cert.id}`)}>
                    <Card style={styles.certCard}>
                      <View style={styles.certInfo}>
                        <Text
                          style={[
                            styles.certStatus,
                            {
                              color:
                                cert.status === 'Valid'
                                  ? colors['state.success.fg']
                                  : cert.status !== 'Pending'
                                    ? colors['state.error.fg']
                                    : colors['state.warning.fg'],
                            },
                          ]}
                        >
                          {cert.detail}
                        </Text>
                        <Text style={[styles.userName, { color: colors['text'] }]}>{cert.name}</Text>
                        <Text style={[styles.certIssuer, { color: colors['text.muted'] }]}>{cert.date}</Text>
                        <View style={{ marginTop: 8 }}>
                          <Timeline steps={cert.timeline.steps} currentStep={cert.timeline.currentStep} />
                        </View>
                        {cert.status === 'Valid' && cert.certificateId && (
                          <TouchableOpacity
                            style={styles.shareButton}
                            onPress={(e) => {
                              e.stopPropagation();
                              setCertToShare({
                                id: cert.certificateId,
                                name: cert.name,
                                issuer: '—',
                                issueDate: cert.date,
                              });
                            }}
                          >
                            <Text style={styles.shareButtonText}>Partager securise</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </Card>
                  </TouchableOpacity>
                ))
              )}
            </View>

            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors['text'] }]}>Actions</Text>
              <Button
                title="Demander un certificat"
                onPress={() => router.push('/CertificateFormScreen')}
                variant="primary"
              />
              <Button
                title="Verifier un certificat"
                onPress={() => router.push('/VerificationScreen')}
                variant="secondary"
                style={{ marginTop: 12 }}
              />
            </View>

            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors['text'] }]}>Services</Text>
              {services.map((service) => (
                <Card key={service.id} style={styles.serviceCard}>
                  <View style={styles.serviceInfo}>
                    <Text style={[styles.serviceTitle, { color: colors['text.secondary'] }]}>
                      {CERTIFICATE_LABELS[service.id]?.description ?? ''}
                    </Text>
                    <Text style={[styles.serviceName, { color: colors['text'] }]}>
                      {CERTIFICATE_LABELS[service.id]?.title ?? service.name}
                    </Text>
                    <Text style={[styles.servicePrice, { color: colors['text.muted'] }]}>{`${service.priceSats.toLocaleString('fr-FR')} sats`}</Text>
                    <TouchableOpacity
                      style={[styles.orderButton, { backgroundColor: colors['surface.raised'] }]}
                      onPress={() => handleServiceSelection(service)}
                    >
                      <Text style={[styles.orderButtonText, { color: colors['text'] }]}>Choisir</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <SelectiveShareModal
        visible={!!certToShare}
        certificate={certToShare}
        onClose={() => setCertToShare(null)}
      />
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
  headerTitle: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  statCard: {
    width: '48%',
    marginBottom: 16,
    padding: 16,
  },
  statHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  statLabel: {
    fontSize: 16,
  },
  statValue: {
    fontSize: 36,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statChange: {
    fontSize: 16,
    fontWeight: '600',
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
  avatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarInitials: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  welcomeText: {
    marginLeft: 12,
  },
  greeting: {
    fontSize: 12,
    opacity: 0.7,
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
  certCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  certInfo: {
    flex: 1,
  },
  certStatus: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  certName: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  certIssuer: {
    fontSize: 14,
    marginTop: 4,
  },
  certImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginLeft: 16,
  },
  shareButton: {
    marginTop: 8,
    backgroundColor: '#e8f4f8',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  shareButtonText: {
    color: '#0a7ea4',
    fontSize: 13,
    fontWeight: 'bold',
  },
  serviceCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  serviceInfo: {
    flex: 1,
  },
  serviceTitle: {
    fontSize: 14,
  },
  serviceName: {
    fontSize: 20,
    fontWeight: 'bold',
    marginVertical: 4,
  },
  servicePrice: {
    fontSize: 14,
  },
  orderButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 12,
    alignSelf: 'flex-start',
  },
  orderButtonText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  serviceImage: {
    width: 80,
    height: 80,
    borderRadius: 12,
    marginLeft: 16,
  },
});

export default HomeScreen;