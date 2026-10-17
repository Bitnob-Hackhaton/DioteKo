import React from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';

export type KycColors = (typeof Colors)['light'];

// Quitter en cours de route perd la progression : on demande confirmation (comme le flow Didit).
export const confirmExit = (onExit: () => void) =>
  Alert.alert('Quitter la vérification ?', 'Votre progression sera perdue.', [
    { text: 'Continuer la vérification', style: 'cancel' },
    { text: 'Quitter', style: 'destructive', onPress: onExit },
  ]);

interface FrameProps {
  colors: KycColors;
  // 0..1 : avancement dans le parcours.
  progress: number;
  // Libelle a droite du bandeau (ex. « Photo 2 sur 3 »).
  label?: string;
  onClose: () => void;
  // Retour a l'ecran precedent du parcours ; sans lui, le bouton a gauche ferme l'ecran.
  onBack?: () => void;
  children: React.ReactNode;
  // Zone fixe en bas (boutons).
  footer?: React.ReactNode;
}

// Cadre commun a tous les ecrans : bouton fermer, barre de progression, contenu, pied avec les boutons.
export const KycFrame = ({ colors, progress, label, onClose, onBack, children, footer }: FrameProps) => (
  <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
    <View style={styles.topBar}>
      <TouchableOpacity
        onPress={onBack ?? onClose}
        accessibilityRole="button"
        accessibilityLabel={onBack ? 'Retour' : 'Fermer'}
        hitSlop={12}
        style={[styles.closeButton, { backgroundColor: colors['surface.raised'] }]}
      >
        <IconSymbol name={onBack ? 'chevron.left' : 'xmark'} size={20} color={colors['text.primary']} />
      </TouchableOpacity>
      <View style={styles.progressWrap}>
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
          style={[styles.track, { backgroundColor: colors['surface.raised'] }]}
        >
          <View style={[styles.fill, { width: `${Math.max(4, Math.min(100, progress * 100))}%`, backgroundColor: colors['brand.primary'] }]} />
        </View>
      </View>
      <Text style={[styles.label, { color: colors['text.muted'] }]}>{label ?? ' '}</Text>
      {onBack ? (
        <TouchableOpacity
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Fermer"
          hitSlop={12}
          style={[styles.closeButton, { backgroundColor: colors['surface.raised'] }]}
        >
          <IconSymbol name="xmark" size={18} color={colors['text.primary']} />
        </TouchableOpacity>
      ) : null}
    </View>
    <View style={styles.body}>{children}</View>
    {footer ? <View style={styles.footer}>{footer}</View> : null}
  </SafeAreaView>
);

export const Heading = ({ colors, title, subtitle }: { colors: KycColors; title: string; subtitle?: string }) => (
  <View style={styles.heading}>
    <Text accessibilityRole="header" style={[styles.title, { color: colors['text.primary'] }]}>
      {title}
    </Text>
    {subtitle ? <Text style={[styles.subtitle, { color: colors['text.secondary'] }]}>{subtitle}</Text> : null}
  </View>
);

// Ligne « icone + titre + description », utilisee pour la liste des etapes et les conseils.
export const InfoRow = ({
  colors,
  icon,
  title,
  description,
}: {
  colors: KycColors;
  icon: string;
  title: string;
  description?: string;
}) => (
  <View style={styles.infoRow}>
    <View style={[styles.infoIcon, { backgroundColor: colors['surface.raised'] }]}>
      <IconSymbol name={icon} size={22} color={colors['brand.primary']} />
    </View>
    <View style={styles.infoText}>
      <Text style={[styles.infoTitle, { color: colors['text.primary'] }]}>{title}</Text>
      {description ? <Text style={[styles.infoDescription, { color: colors['text.secondary'] }]}>{description}</Text> : null}
    </View>
  </View>
);

export const ErrorText = ({ colors, message }: { colors: KycColors; message: string }) => (
  <Text accessibilityRole="alert" style={[styles.error, { color: colors['state.error.fg'] }]}>
    {message}
  </Text>
);

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  closeButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  progressWrap: { flex: 1 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  label: { minWidth: 76, textAlign: 'right', fontSize: 12, fontWeight: '600' },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 16 },
  footer: { paddingHorizontal: 24, paddingBottom: 20, paddingTop: 8 },
  heading: { marginBottom: 20 },
  title: { fontSize: 26, fontWeight: 'bold' },
  subtitle: { fontSize: 15, lineHeight: 22, marginTop: 8 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 },
  infoIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  infoText: { flex: 1 },
  infoTitle: { fontSize: 16, fontWeight: '600' },
  infoDescription: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  error: { fontSize: 14, textAlign: 'center', marginTop: 12 },
});
