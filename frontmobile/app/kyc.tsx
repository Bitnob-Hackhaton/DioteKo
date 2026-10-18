import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Text, View } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import { CaptureStep } from '@/components/kyc/CaptureStep';
import { confirmExit, KycFrame } from '@/components/kyc/kyc-ui';
import {
  DocumentScreen,
  ProcessingScreen,
  ResultScreen,
  ReviewScreen,
  SelfieIntroScreen,
  StartScreen,
  type ResultKind,
} from '@/components/kyc/StepScreens';
import { Button } from '@/components/ui/Button';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useKycStatus } from '@/hooks/use-kyc-status';
import { kycLog, kycWarn } from '@/lib/kyc-log';
import { findCountryByName, getCountryList } from '@/services/countries';
import {
  cancelKycSession,
  getKycStatus,
  isNoAnswerError,
  isTimeoutError,
  kycStepsFor,
  precheckKycPhoto,
  startKycSession,
  uploadKycPhoto,
  type KycDocumentType,
  type KycPhotoStep,
  type KycStatusView,
} from '@/services/kyc';
import { discardPhoto } from '@/services/photo-cleanup';

// Parcours de verification d'identite, calque sur l'ordre du flow Didit :
//   accueil + consentement -> pays ET type de piece -> photos (recto, verso, selfie) -> traitement -> resultat.
// Retour arriere possible a chaque etape (fleche, bouton retour d'Android) : la photo deja envoyee est reaffichee.
// Ici : l'etat et les appels reseau. Les ecrans sont dans components/kyc/. Le serveur reste l'autorite : l'ecran de
// resultat suit le statut relu chez le prestataire, jamais une decision locale.
type Phase = 'start' | 'document' | 'selfie-intro' | 'capture' | 'review' | 'processing' | 'result';

const DOCUMENT_TYPES: KycDocumentType[] = ['national_id', 'passport'];
const DEFAULT_COUNTRY = 'Sénégal';
// Ecrans depuis lesquels « retour » revient a l'ecran precedent du parcours (sinon il quitte l'ecran).
const BACKABLE: Phase[] = ['document', 'capture', 'selfie-intro', 'review'];

const resultKindOf = (status: KycStatusView['status'] | undefined): ResultKind | null =>
  status === 'verified'
    ? 'approved'
    : status === 'manual_review'
      ? 'review'
      : status === 'failed' || status === 'rejected'
        ? 'declined'
        : null;

type Photos = Partial<Record<KycPhotoStep, string>>;

const KycScreen = () => {
  const router = useRouter();
  const colors = Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const { kyc, loading, error: statusError, refresh, setKyc } = useKycStatus({ poll: true });

  // `null` = pas encore choisie : l'ecran initial se deduit du statut serveur (pas d'effet, pas de setState au montage).
  const [phase, setPhase] = useState<Phase | null>(null);
  const [consent, setConsent] = useState(false);
  const [country, setCountry] = useState<string | undefined>(DEFAULT_COUNTRY);
  const [documentType, setDocumentType] = useState<KycDocumentType>('national_id');
  const [session, setSession] = useState<KycStatusView | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [photos, setPhotos] = useState<Photos>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Photos envoyees, gardees pour le retour arriere ; copie en ref pour le nettoyage a la sortie.
  const photosRef = useRef<Photos>({});

  const countries = useMemo(() => getCountryList('fr'), []);
  const countryCode = findCountryByName(countries, country)?.code;

  const steps: KycPhotoStep[] = kycStepsFor((session?.documentType ?? documentType) as KycDocumentType);
  const step = steps[stepIndex];
  const sessionId = session?.sessionId ?? null;
  const kycSessionId = kyc?.sessionId ?? null;

  const serverResult = resultKindOf(kyc?.status);
  const effective: Phase = phase ?? (serverResult ? 'result' : 'start');
  // Apres l'envoi du selfie, le statut relu par le serveur (ou par le sondage) fait passer du traitement au resultat.
  // A verdict that closes the dossier (rejected / failed) ends the flow wherever the holder is: the provider refuses any further
  // photo, so offering the next step would only end in an error. With the agent fallback on, the server never answers
  // rejected / failed for a provider verdict: it stays `pending` with a `nextStep` until every photo is kept, then
  // `manual_review` (the "waiting for an agent" result).
  const closedByProvider = serverResult === 'declined';
  const shown: Phase =
    (effective === 'processing' && serverResult) || (closedByProvider && ['capture', 'selfie-intro', 'review'].includes(effective))
      ? 'result'
      : effective;

  useEffect(() => {
    kycLog('screen', { phase: shown, step: step ?? '-', stepIndex, status: kyc?.status });
  }, [shown, step, stepIndex, kyc?.status]);

  // Supprime du telephone toutes les photos gardees (fin du parcours, recommencer, sortie de l'ecran).
  const discardAll = useCallback(() => {
    Object.values(photosRef.current).forEach((uri) => discardPhoto(uri));
    photosRef.current = {};
    setPhotos({});
  }, []);

  useEffect(
    () => () => {
      Object.values(photosRef.current).forEach((uri) => discardPhoto(uri));
    },
    []
  );

  const keepPhoto = useCallback((photoStep: KycPhotoStep, uri: string) => {
    photosRef.current = { ...photosRef.current, [photoStep]: uri };
    setPhotos(photosRef.current);
  }, []);

  const leave = useCallback(() => router.back(), [router]);
  const askLeave = useCallback(() => {
    if (shown === 'result' || shown === 'processing') leave();
    else confirmExit(leave);
  }, [shown, leave]);

  // Retour a l'ecran precedent du parcours.
  const goBack = useCallback(() => {
    kycLog('back', { from: shown, stepIndex, reviewIndex });
    if (shown === 'document') {
      setPhase('start');
    } else if (shown === 'review') {
      if (reviewIndex > 0) setReviewIndex(reviewIndex - 1);
      else setPhase('document');
    } else if (shown === 'capture' || shown === 'selfie-intro') {
      const previous = stepIndex - 1;
      if (previous >= 0 && photos[steps[previous]]) {
        setReviewIndex(previous);
        setPhase('review');
      } else {
        setPhase('document');
      }
    }
  }, [shown, stepIndex, reviewIndex, photos, steps]);

  // Bouton retour d'Android : meme chose que la fleche, sans quitter l'ecran au milieu du parcours.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (BACKABLE.includes(shown)) {
          goBack();
          return true;
        }
        return false;
      });
      return () => subscription.remove();
    }, [shown, goBack])
  );

  const toCurrentCapture = useCallback(() => {
    setPhase(steps[stepIndex] === 'selfie' ? 'selfie-intro' : 'capture');
  }, [steps, stepIndex]);

  // Ferme la session ouverte (pour en recommencer une) et efface les photos gardees.
  const closeOpenSession = useCallback(
    async (sessionId: string | null | undefined) => {
      if (sessionId) {
        const closed = await cancelKycSession(sessionId);
        setKyc(closed);
      }
      discardAll();
      setSession(null);
      setStepIndex(0);
      setReviewIndex(0);
    },
    [discardAll, setKyc]
  );

  const begin = useCallback(
    async (type: KycDocumentType) => {
      setBusy(true);
      setActionError(null);
      try {
        // Autre type de piece que la session ouverte : on la ferme et on en ouvre une nouvelle.
        if (session?.sessionId && session.documentType && session.documentType !== type) {
          await closeOpenSession(session.sessionId);
        }
        const opened = await startKycSession(type, countryCode);
        setKyc(opened);
        if (opened.status === 'verified') {
          setPhase('result');
          return;
        }
        setSession(opened);
        const kind = (opened.documentType ?? type) as KycDocumentType;
        const sequence = kycStepsFor(kind);
        // Session reprise : on repart de la photo que le prestataire attend (sinon de la premiere).
        const resumeAt = opened.nextStep ? Math.max(sequence.indexOf(opened.nextStep), 0) : 0;
        setDocumentType(kind);
        setStepIndex(resumeAt);
        setPhase(sequence[resumeAt] === 'selfie' ? 'selfie-intro' : 'capture');
      } catch (startError) {
        kycWarn('begin failed', { reason: startError instanceof Error ? startError.message : 'unknown' });
        setActionError(startError instanceof Error ? startError.message : 'Impossible de démarrer.');
      } finally {
        setBusy(false);
      }
    },
    [session, countryCode, closeOpenSession, setKyc]
  );

  // Accueil, session deja ouverte : « Choisir une autre pièce » = fermer la session et repasser par le choix.
  const restartFromStart = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      await closeOpenSession(kycSessionId);
      setPhase('document');
    } catch (restartError) {
      setActionError(restartError instanceof Error ? restartError.message : 'Impossible de recommencer.');
    } finally {
      setBusy(false);
    }
  }, [closeOpenSession, kycSessionId]);

  // Revue d'une photo deja envoyee : la changer exige de recommencer (le parcours ne va que vers l'avant).
  const confirmRestart = useCallback(() => {
    Alert.alert('Recommencer la vérification ?', 'Vos photos déjà envoyées seront abandonnées et vous repartirez du choix de la pièce.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Recommencer',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await closeOpenSession(sessionId);
              setPhase('document');
            } catch (restartError) {
              setActionError(restartError instanceof Error ? restartError.message : 'Impossible de recommencer.');
            }
          })();
        },
      },
    ]);
  }, [closeOpenSession, sessionId]);

  const submitPhoto = useCallback(
    async (uri: string) => {
      if (!session?.sessionId || !step) return;
      let updated: KycStatusView;
      try {
        updated = await uploadKycPhoto(session.sessionId, step, uri);
      } catch (uploadError) {
        if (!isNoAnswerError(uploadError)) throw uploadError;
        // Pas de reponse a temps : la photo est peut-etre bien arrivee (l'analyse du recto peut etre longue). On relit la
        // progression chez le serveur avant de demander de reprendre la photo.
        const fresh = await getKycStatus().catch(() => null);
        if (!fresh) throw uploadError;
        const last = stepIndex >= steps.length - 1;
        const resumeAt = fresh.nextStep ? steps.indexOf(fresh.nextStep) : -1;
        if (fresh.status !== 'pending' || (last && isTimeoutError(uploadError))) {
          // Verdict deja rendu, ou selfie encore en cours d'analyse : l'ecran de traitement prend le relais (sondage).
          keepPhoto(step, uri);
          setKyc(fresh);
          setPhase('processing');
          discardAll();
          return;
        }
        if (resumeAt > stepIndex) {
          keepPhoto(step, uri);
          setKyc(fresh);
          setStepIndex(resumeAt);
          setPhase(steps[resumeAt] === 'selfie' ? 'selfie-intro' : 'capture');
          return;
        }
        throw uploadError;
      }
      keepPhoto(step, uri);
      if (stepIndex < steps.length - 1) {
        const nextIndex = stepIndex + 1;
        setStepIndex(nextIndex);
        setPhase(steps[nextIndex] === 'selfie' ? 'selfie-intro' : 'capture');
        return;
      }
      // Selfie envoye : le serveur a relu le verdict (ou le fera au prochain sondage). Plus de retour possible.
      setKyc(updated);
      // Dossier confie a un agent (le prestataire a clos sa session) mais une photo precedente n'a pas pu etre gardee : le
      // serveur la redemande, l'agent ne decide qu'avec toutes les photos. Pas d'ecran de traitement ni de resultat avant.
      const missingIndex = updated.status === 'pending' && updated.nextStep && updated.nextStep !== 'selfie' ? steps.indexOf(updated.nextStep) : -1;
      if (missingIndex >= 0) {
        kycLog('photo missing after selfie', { nextStep: updated.nextStep });
        setStepIndex(missingIndex);
        setPhase('capture');
        return;
      }
      setPhase('processing');
      discardAll();
      if (updated.status === 'verified') Toast.show({ type: 'success', text1: 'Identité vérifiée' });
    },
    [session, step, stepIndex, steps, keepPhoto, setKyc, discardAll]
  );

  const checkPhoto = useMemo(
    () => (sessionId && step ? (probeUri: string) => precheckKycPhoto(sessionId, step, probeUri) : undefined),
    [sessionId, step]
  );

  const photoProgress = 0.3 + (steps.length ? (stepIndex + 1) / steps.length : 0) * 0.55;

  let screen: React.ReactNode;
  if (loading) {
    screen = (
      <KycFrame colors={colors} progress={0.02} onClose={leave}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors['brand.primary']} />
        </View>
      </KycFrame>
    );
  } else if (!kyc) {
    screen = (
      <KycFrame colors={colors} progress={0.02} onClose={leave}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: colors['state.error.fg'], textAlign: 'center' }}>{statusError ?? 'Statut indisponible.'}</Text>
          <Button title="Réessayer" onPress={() => void refresh()} variant="secondary" style={{ marginTop: 12 }} />
        </View>
      </KycFrame>
    );
  } else if (shown === 'start') {
    const resuming = kyc.status === 'pending';
    screen = (
      <StartScreen
        colors={colors}
        onClose={askLeave}
        resuming={resuming}
        consent={consent}
        onToggleConsent={() => setConsent((value) => !value)}
        busy={busy}
        error={actionError}
        onContinue={() => (resuming && kyc.documentType ? void begin(kyc.documentType) : setPhase('document'))}
        onRestart={() => void restartFromStart()}
      />
    );
  } else if (shown === 'document') {
    screen = (
      <DocumentScreen
        colors={colors}
        onClose={askLeave}
        onBack={goBack}
        country={country}
        onCountryChange={setCountry}
        types={DOCUMENT_TYPES}
        selected={documentType}
        onSelect={setDocumentType}
        onContinue={() => void begin(documentType)}
        busy={busy}
        error={actionError}
      />
    );
  } else if (shown === 'review' && steps[reviewIndex] && photos[steps[reviewIndex]]) {
    const reviewedStep = steps[reviewIndex];
    screen = (
      <ReviewScreen
        colors={colors}
        onClose={askLeave}
        onBack={goBack}
        step={reviewedStep}
        uri={photos[reviewedStep] as string}
        position={`Photo ${reviewIndex + 1} sur ${steps.length}`}
        onContinue={() => {
          const next = reviewIndex + 1;
          if (next < stepIndex && photos[steps[next]]) setReviewIndex(next);
          else toCurrentCapture();
        }}
        onRestart={confirmRestart}
      />
    );
  } else if (shown === 'selfie-intro') {
    screen = <SelfieIntroScreen colors={colors} onClose={askLeave} onBack={goBack} progress={photoProgress - 0.05} onReady={() => setPhase('capture')} />;
  } else if (shown === 'capture' && step) {
    screen = (
      <CaptureStep
        key={`${session?.sessionId}-${step}`}
        colors={colors}
        step={step}
        progress={photoProgress}
        positionLabel={`Photo ${stepIndex + 1} sur ${steps.length}`}
        onClose={askLeave}
        onBack={goBack}
        onSubmit={submitPhoto}
        onCheck={checkPhoto}
        mrzMode={kyc?.mrzPrecheck}
      />
    );
  } else if (shown === 'processing') {
    screen = <ProcessingScreen colors={colors} onClose={askLeave} />;
  } else {
    screen = (
      <ResultScreen
        colors={colors}
        onClose={leave}
        kind={serverResult ?? 'declined'}
        failureReason={kyc.failureReason}
        canRetry={kyc.canRestart}
        agentReview={kyc.reviewMode === 'agent'}
        onDone={leave}
        onRetry={() => {
          setActionError(null);
          discardAll();
          setSession(null);
          setStepIndex(0);
          setPhase('document');
        }}
      />
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {screen}
    </>
  );
};

export default KycScreen;
