import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useMyCertificateRequests } from '@/hooks/use-my-certificate-requests';
import { Colors } from '@/constants/theme';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { CERTIFICATE_FILTERS, FILTER_LABELS } from '@/services/certificate-requests';

// Liste "mes demandes" : partagee par /my-certificates et /all-certificates (meme source, l'appelant uniquement).
const CertificateListScreen = () => {
  const colors = Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const router = useRouter();
  const { items, total, filter, setFilter, loading, error, reload } = useMyCertificateRequests({ limit: 100 });

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        <View style={styles.filterContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {CERTIFICATE_FILTERS.map((f) => (
              <TouchableOpacity
                key={f}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === f }}
                style={[
                  styles.filterButton,
                  { backgroundColor: filter === f ? colors['brand.primary'] : colors['surface.default'] },
                ]}
                onPress={() => setFilter(f)}
              >
                <Text style={{ color: filter === f ? colors['brand.primary.on'] : colors['text.primary'] }}>{FILTER_LABELS[f]}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={colors['brand.primary']} style={{ marginTop: 32 }} />
        ) : error ? (
          <View style={styles.centered}>
            <Text style={[styles.message, { color: colors['state.error.fg'] }]}>{error}</Text>
            <Button title="Réessayer" onPress={reload} variant="secondary" style={{ marginTop: 12 }} />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.centered}>
            <Text style={[styles.message, { color: colors['text.muted'] }]}>
              {filter === 'All' ? "Vous n'avez pas encore fait de demande." : 'Aucune demande dans ce filtre.'}
            </Text>
            {filter === 'All' && (
              <Button
                title="Demander un certificat"
                onPress={() => router.push('/CertificateFormScreen')}
                variant="primary"
                style={{ marginTop: 12 }}
              />
            )}
          </View>
        ) : (
          <ScrollView>
            <Text style={[styles.message, { color: colors['text.muted'], marginBottom: 12, textAlign: 'left' }]}>
              {total > items.length ? `${items.length} sur ${total} demandes` : `${total} demande${total > 1 ? 's' : ''}`}
            </Text>
            {items.map((item) => (
              <Card key={item.id} style={styles.certCard}>
                <TouchableOpacity accessibilityRole="button" onPress={() => router.push(`/certificate/${item.id}`)}>
                  <Text style={[styles.certName, { color: colors['text.primary'] }]}>{item.name}</Text>
                  <Text style={[styles.certStatus, { color: colors['text.muted'] }]}>
                    {`${item.detail} · ${item.date}`}
                  </Text>
                </TouchableOpacity>
              </Card>
            ))}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    padding: 16,
  },
  filterContainer: {
    marginBottom: 16,
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 8,
  },
  certCard: {
    marginBottom: 12,
  },
  certName: {
    fontSize: 16,
    fontWeight: '600',
  },
  certStatus: {
    fontSize: 14,
    marginTop: 4,
  },
  centered: {
    marginTop: 32,
    alignItems: 'center',
  },
  message: {
    fontSize: 14,
    textAlign: 'center',
  },
});

export default CertificateListScreen;
