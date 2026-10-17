import React from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { PAYMENT_PROVIDERS, type PaymentProvider, type PaymentProviderId } from '@/constants/payment-providers';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
  // Montant affiche en tete (« 100 sats »), pour que le choix du moyen se fasse sans perdre le prix de vue.
  priceLabel: string;
  // Moyen dont l'appui est en cours (spinner dans sa ligne, les autres lignes se figent).
  busyId?: PaymentProviderId | null;
  onSelect: (provider: PaymentProviderId) => void;
}

const LOGO_SIZE = 40;

// Le visuel Lightning est un disque violet sur fond clair, en portrait : on le recadre sur son disque pour qu'il remplisse
// la pastille, comme les autres logos.
const ProviderLogo = ({ provider, dimmed }: { provider: PaymentProvider; dimmed: boolean }) => (
  <View style={[styles.logoWrap, dimmed && styles.dimmed]} importantForAccessibility="no-hide-descendants">
    <Image
      source={provider.logo}
      resizeMode="cover"
      style={provider.logoFit === 'lightning' ? styles.logoLightning : styles.logo}
      accessible={false}
    />
  </View>
);

const Row = ({
  provider,
  colors,
  busy,
  locked,
  onSelect,
}: {
  provider: PaymentProvider;
  colors: (typeof Colors)['light'];
  busy: boolean;
  locked: boolean;
  onSelect: (id: PaymentProviderId) => void;
}) => {
  const enabled = provider.available;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={enabled ? `Payer avec ${provider.name}` : `${provider.name}, bientôt disponible`}
      accessibilityHint={enabled ? provider.description : undefined}
      accessibilityState={{ disabled: !enabled || locked, busy }}
      disabled={!enabled || locked}
      onPress={() => onSelect(provider.id)}
      activeOpacity={0.7}
      style={[
        styles.row,
        { backgroundColor: colors['surface.raised'] },
        enabled && { borderColor: colors['brand.primary'], borderWidth: 1.5 },
      ]}
    >
      <ProviderLogo provider={provider} dimmed={!enabled} />
      <View style={[styles.rowText, !enabled && styles.dimmed]}>
        <Text style={[styles.name, { color: colors['text.primary'] }]} numberOfLines={1}>
          {provider.name}
        </Text>
        <Text style={[styles.description, { color: colors['text.secondary'] }]} numberOfLines={1}>
          {provider.description}
        </Text>
      </View>
      {enabled ? (
        busy ? (
          <ActivityIndicator color={colors['brand.primary']} />
        ) : (
          <IconSymbol name="chevron.right" size={20} color={colors['brand.primary']} />
        )
      ) : (
        // Le motif d'inactivite est ecrit, pas seulement grise : un moyen assombri seul se lit comme « en panne ».
        <View style={[styles.soonPill, { borderColor: colors['text.muted'] }]}>
          <Text style={[styles.soonText, { color: colors['text.secondary'] }]}>Bientôt</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

// « Payer avec » : une ligne par moyen de paiement. Lightning est le seul actif ; les autres sont visibles pour annoncer ce qui
// vient, sans action possible.
export const PaymentMethodPicker = ({ priceLabel, busyId = null, onSelect }: Props) => {
  const colorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const colors = Colors[colorScheme];
  const available = PAYMENT_PROVIDERS.filter((provider) => provider.available);
  const soon = PAYMENT_PROVIDERS.filter((provider) => !provider.available);

  return (
    <View>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors['text.primary'] }]} accessibilityRole="header">
          Payer avec
        </Text>
        {priceLabel ? <Text style={[styles.price, { color: colors['brand.primary'] }]}>{priceLabel}</Text> : null}
      </View>

      <View style={styles.group}>
        {available.map((provider) => (
          <Row key={provider.id} provider={provider} colors={colors} busy={busyId === provider.id} locked={busyId !== null} onSelect={onSelect} />
        ))}
      </View>

      <Text style={[styles.groupLabel, { color: colors['text.secondary'] }]}>Bientôt disponible</Text>
      <View style={styles.group}>
        {soon.map((provider) => (
          <Row key={provider.id} provider={provider} colors={colors} busy={false} locked onSelect={onSelect} />
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 18, fontWeight: 'bold' },
  price: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  group: { gap: 8 },
  groupLabel: { fontSize: 13, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  // 56 dp de haut : au-dessus des 48 dp minimum pour une cible tactile, et 8 dp entre deux lignes.
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 0 },
  rowText: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600' },
  description: { fontSize: 13, marginTop: 2 },
  dimmed: { opacity: 0.5 },
  logoWrap: { width: LOGO_SIZE, height: LOGO_SIZE, borderRadius: 10, overflow: 'hidden', backgroundColor: '#FFFFFF' },
  logo: { width: LOGO_SIZE, height: LOGO_SIZE },
  // Image portrait 3:4 dont le disque occupe toute la largeur : agrandie a 1,5x et centree sur le disque.
  logoLightning: { width: LOGO_SIZE * 1.5, height: LOGO_SIZE * 2, position: 'absolute', left: -LOGO_SIZE * 0.25, top: -LOGO_SIZE * 0.5 },
  soonPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  soonText: { fontSize: 12, fontWeight: '600' },
});
