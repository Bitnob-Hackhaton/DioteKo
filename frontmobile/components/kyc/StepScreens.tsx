import React from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { CountryField } from '@/components/CountryField';
import { ErrorText, Heading, InfoRow, KycFrame, type KycColors } from '@/components/kyc/kyc-ui';
import { KYC_DOCUMENT_LABELS, kycFailureMessage, type KycDocumentType, type KycPhotoStep } from '@/services/kyc';

// Les ecrans du parcours de verification, dans l'ordre. Chacun est « bete » : l'etat et les appels reseau vivent
// dans `app/kyc.tsx`. Le cadre (retour, fermer, progression) vient de `KycFrame`.

interface Common {
  colors: KycColors;
  onClose: () => void;
  // Retour a l'ecran precedent ; absent = pas de retour possible depuis cet ecran.
  onBack?: () => void;
}

// 1. Accueil : ce que va demander le parcours, la duree, le consentement.
export const StartScreen = ({
  colors,
  onClose,
  resuming,
  consent,
  onToggleConsent,
  onContinue,
  onRestart,
  busy,
  error,
}: Common & {
  resuming: boolean;
  consent: boolean;
  onToggleConsent: () => void;
  onContinue: () => void;
  // Session deja ouverte : repartir de zero avec une autre piece ou un autre pays.
  onRestart: () => void;
  busy: boolean;
  error: string | null;
}) => (
  <KycFrame
    colors={colors}
    progress={0.05}
    onClose={onClose}
    footer={
      <>
        <Button
          title={resuming ? 'Reprendre la vérification' : 'Continuer'}
          onPress={onContinue}
          disabled={!consent}
          loading={busy}
        />
        {resuming ? (
          <Button title="Choisir une autre pièce" onPress={onRestart} variant="secondary" disabled={busy} style={styles.gap} />
        ) : null}
        <Text style={[styles.secured, { color: colors['text.muted'] }]}>Sécurisé par DioteKo</Text>
      </>
    }
  >
    <ScrollView showsVerticalScrollIndicator={false}>
      <Heading
        colors={colors}
        title="Vérifions votre identité"
        subtitle="Cela prend environ deux minutes. Munissez-vous de votre pièce d'identité."
      />
      <InfoRow colors={colors} icon="person.text.rectangle" title="Votre pièce d'identité" description="Photographiez-la, recto et verso si besoin." />
      <InfoRow colors={colors} icon="faceid" title="Votre visage" description="Un selfie pour confirmer que c'est bien vous." />
      <InfoRow colors={colors} icon="lock.fill" title="Vos photos restent confidentielles" description="Elles servent uniquement à cette vérification." />

      <TouchableOpacity
        onPress={onToggleConsent}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: consent }}
        accessibilityLabel="J'accepte que mes photos soient traitées pour vérifier mon identité"
        style={styles.consent}
      >
        <View
          style={[
            styles.checkbox,
            { borderColor: consent ? colors['brand.primary'] : colors['text.muted'], backgroundColor: consent ? colors['brand.primary'] : 'transparent' },
          ]}
        >
          {consent ? <IconSymbol name="checkmark" size={14} color={colors['brand.primary.on']} /> : null}
        </View>
        <Text style={[styles.consentText, { color: colors['text.secondary'] }]}>
          J&apos;accepte que mes photos soient traitées pour vérifier mon identité.
        </Text>
      </TouchableOpacity>
      {error ? <ErrorText colors={colors} message={error} /> : null}
    </ScrollView>
  </KycFrame>
);

const DOCUMENT_ICONS: Record<KycDocumentType, string> = {
  national_id: 'person.text.rectangle',
  passport: 'book.closed.fill',
};

// 2. Pays de delivrance ET type de piece, sur le meme ecran (toujours propose, y compris au « Réessayer »).
export const DocumentScreen = ({
  colors,
  onClose,
  onBack,
  country,
  onCountryChange,
  types,
  selected,
  onSelect,
  onContinue,
  busy,
  error,
}: Common & {
  country: string | undefined;
  onCountryChange: (countryName: string) => void;
  types: KycDocumentType[];
  selected: KycDocumentType;
  onSelect: (type: KycDocumentType) => void;
  onContinue: () => void;
  busy: boolean;
  error: string | null;
}) => (
  <KycFrame
    colors={colors}
    progress={0.2}
    onClose={onClose}
    onBack={onBack}
    footer={<Button title="Continuer" onPress={onContinue} loading={busy} disabled={!country} />}
  >
    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <Heading colors={colors} title="Votre pièce d'identité" subtitle="Choisissez le pays qui l'a délivrée, puis le type de pièce." />

      <Text style={[styles.fieldLabel, { color: colors['text.secondary'] }]}>Pays de délivrance</Text>
      <CountryField label="Pays de délivrance" value={country} onChange={onCountryChange} disabled={busy} error={undefined} colors={colors} />

      <Text style={[styles.fieldLabel, styles.fieldGap, { color: colors['text.secondary'] }]}>Type de pièce</Text>
      <View accessibilityRole="radiogroup" style={styles.cards}>
        {types.map((type) => {
          const isSelected = selected === type;
          return (
            <TouchableOpacity
              key={type}
              onPress={() => onSelect(type)}
              disabled={busy}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={KYC_DOCUMENT_LABELS[type].title}
              style={[
                styles.card,
                {
                  backgroundColor: colors['surface.default'],
                  borderColor: isSelected ? colors['brand.primary'] : colors['surface.raised'],
                  borderWidth: isSelected ? 2 : 1,
                },
              ]}
            >
              <View style={[styles.cardIcon, { backgroundColor: colors['surface.raised'] }]}>
                <IconSymbol name={DOCUMENT_ICONS[type]} size={24} color={colors['brand.primary']} />
              </View>
              <View style={styles.cardText}>
                <Text style={[styles.cardTitle, { color: colors['text.primary'] }]}>{KYC_DOCUMENT_LABELS[type].title}</Text>
                <Text style={{ color: colors['text.secondary'], fontSize: 13 }}>{KYC_DOCUMENT_LABELS[type].description}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
      {error ? <ErrorText colors={colors} message={error} /> : null}
    </ScrollView>
  </KycFrame>
);

const STEP_TITLES: Record<KycPhotoStep, string> = {
  front: 'Face avant de la pièce',
  back: 'Verso de la pièce',
  selfie: 'Votre selfie',
};

// Retour sur une etape deja faite : la photo envoyee est reaffichee. Le prestataire n'accepte pas de remplacer une
// photo deja envoyee (le parcours ne va que vers l'avant) : changer une photo = recommencer la verification.
export const ReviewScreen = ({
  colors,
  onClose,
  onBack,
  step,
  uri,
  position,
  onContinue,
  onRestart,
}: Common & {
  step: KycPhotoStep;
  uri: string;
  // « Photo 1 sur 3 »
  position: string;
  onContinue: () => void;
  onRestart: () => void;
}) => (
  <KycFrame
    colors={colors}
    progress={0.4}
    label={position}
    onClose={onClose}
    onBack={onBack}
    footer={
      <>
        <Button title="Continuer" onPress={onContinue} />
        <Button title="Recommencer la vérification" onPress={onRestart} variant="secondary" style={styles.gap} />
      </>
    }
  >
    <Heading colors={colors} title={STEP_TITLES[step]} subtitle="Cette photo a déjà été envoyée. Pour la changer, recommencez la vérification." />
    <View style={[styles.reviewBox, { backgroundColor: colors['bg.muted'] }]}>
      <Image source={{ uri }} style={styles.reviewImage} resizeMode="contain" accessibilityLabel={`Photo envoyée : ${STEP_TITLES[step]}`} />
    </View>
  </KycFrame>
);

// Introduction au selfie : ou placer le visage, quels conseils.
export const SelfieIntroScreen = ({ colors, onClose, onBack, onReady, progress }: Common & { onReady: () => void; progress: number }) => (
  <KycFrame colors={colors} progress={progress} onClose={onClose} onBack={onBack} footer={<Button title="Je suis prêt" onPress={onReady} />}>
    <Heading colors={colors} title="Maintenant, votre visage" subtitle="Placez votre visage dans l'ovale, regardez l'écran sans bouger." />
    <View style={styles.ovalWrap}>
      <View style={[styles.oval, { borderColor: colors['brand.primary'], backgroundColor: colors['surface.default'] }]}>
        <IconSymbol name="faceid" size={72} color={colors['brand.primary']} />
      </View>
    </View>
    <InfoRow colors={colors} icon="info.circle.fill" title="Bien éclairé, de face" description="Évitez le contre-jour." />
    <InfoRow colors={colors} icon="info.circle.fill" title="Visage découvert" description="Sans lunettes de soleil ni casquette." />
  </KycFrame>
);

// Traitement : le serveur relit le verdict chez le prestataire.
export const ProcessingScreen = ({ colors, onClose }: Common) => (
  <KycFrame colors={colors} progress={0.95} onClose={onClose}>
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors['brand.primary']} />
      <Text style={[styles.resultTitle, { color: colors['text.primary'] }]}>Vérification en cours</Text>
      <Text style={[styles.resultText, { color: colors['text.secondary'] }]}>
        Nous analysons vos photos. Cela prend quelques secondes, ne quittez pas cet écran.
      </Text>
    </View>
  </KycFrame>
);

export type ResultKind = 'approved' | 'review' | 'declined';

// Resultat : coche verte, horloge orange ou croix rouge, comme Didit.
export const ResultScreen = ({
  colors,
  onClose,
  kind,
  failureReason,
  canRetry,
  agentReview = false,
  onDone,
  onRetry,
}: Common & {
  kind: ResultKind;
  failureReason: string | null;
  canRetry: boolean;
  // Le dossier est relu a la main par un agent de l'organisation (et non par le prestataire).
  agentReview?: boolean;
  onDone: () => void;
  onRetry: () => void;
}) => {
  const view =
    kind === 'approved'
      ? {
          icon: 'checkmark.circle.fill',
          color: colors['state.success.fg'],
          title: 'Identité vérifiée',
          text: 'Vous pouvez maintenant demander vos certificats de résidence et d’identité.',
        }
      : kind === 'review'
        ? {
            icon: 'clock.fill',
            color: colors['state.warning.fg'],
            title: 'Dossier en cours d’examen',
            text: agentReview
              ? 'Vos documents ont bien été reçus. Un agent les vérifiera : vous serez débloqué dès la validation. Vous pouvez quitter cet écran et revenir plus tard.'
              : 'Un agent examine votre dossier. Cet écran se met à jour tout seul ; vous pouvez le quitter et revenir plus tard.',
          }
        : {
            icon: 'xmark.circle.fill',
            color: colors['state.error.fg'],
            title: 'Nous n’avons pas pu vérifier votre identité',
            text: kycFailureMessage(failureReason),
          };
  return (
    <KycFrame
      colors={colors}
      progress={1}
      onClose={onClose}
      footer={
        <>
          {kind === 'declined' && canRetry ? <Button title="Réessayer" onPress={onRetry} /> : null}
          <Button
            title={kind === 'approved' ? 'Continuer' : 'Retour'}
            onPress={onDone}
            variant={kind === 'declined' && canRetry ? 'secondary' : 'primary'}
            style={kind === 'declined' && canRetry ? styles.gap : undefined}
          />
        </>
      }
    >
      <View style={styles.center}>
        <IconSymbol name={view.icon} size={84} color={view.color} />
        <Text accessibilityRole="header" style={[styles.resultTitle, { color: colors['text.primary'] }]}>
          {view.title}
        </Text>
        <Text style={[styles.resultText, { color: colors['text.secondary'] }]}>{view.text}</Text>
      </View>
    </KycFrame>
  );
};

const styles = StyleSheet.create({
  secured: { textAlign: 'center', fontSize: 12, marginTop: 12 },
  consent: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 20, minHeight: 44 },
  checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  consentText: { flex: 1, fontSize: 14, lineHeight: 20 },
  fieldLabel: { fontSize: 14, marginBottom: 6 },
  fieldGap: { marginTop: 20 },
  cards: { gap: 12 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, padding: 16, minHeight: 76 },
  cardIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  reviewBox: { width: '100%', aspectRatio: 3 / 4, maxHeight: '64%', borderRadius: 20, overflow: 'hidden', alignSelf: 'center' },
  reviewImage: { width: '100%', height: '100%' },
  ovalWrap: { alignItems: 'center', marginVertical: 16 },
  oval: { width: 150, height: 192, borderRadius: 96, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  resultTitle: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginTop: 20 },
  resultText: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 10 },
  gap: { marginTop: 10 },
});
