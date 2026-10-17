import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Button } from '@/components/ui/Button';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ErrorText, Heading, KycFrame, type KycColors } from '@/components/kyc/kyc-ui';
import { ScanOverlay } from '@/components/kyc/ScanOverlay';
import { useSteadiness } from '@/hooks/use-steadiness';
import { elapsedMs, kycLog, kycWarn } from '@/lib/kyc-log';
import type { KycPhotoStep, KycPrecheckResult } from '@/services/kyc';
import { discardPhoto } from '@/services/photo-cleanup';
import { makeProbe, preparePhoto } from '@/services/photo-prepare';

const COPY: Record<KycPhotoStep, { title: string; hint: string }> = {
  front: { title: 'Face avant de la pièce', hint: 'Placez la pièce dans le cadre, bien à plat, en pleine lumière, sans reflet.' },
  back: { title: 'Verso de la pièce', hint: 'Retournez la pièce et placez-la dans le cadre. La zone de caractères « < » en bas doit être nette.' },
  selfie: { title: 'Votre selfie', hint: 'Placez votre visage dans l’ovale, de face, bien éclairé.' },
};

// Temps d'immobilite avant la prise automatique, et delai de grace pour se placer.
const HOLD_MS: Record<KycPhotoStep, number> = { front: 1300, back: 1300, selfie: 1000 };
const ARM_AFTER_MS = 1000;
// Apres un refus, on laisse plus de temps pour recadrer avant de rearmer la prise automatique.
const REARM_AFTER_REFUSAL_MS = 3500;
// Pause entre deux photos-sondes : plus courte tant que rien n'est reconnu, pour reagir vite au cadrage.
const PROBE_PAUSE_FOUND_MS = 1200;
const PROBE_PAUSE_SEARCHING_MS = 700;
// Apres ce nombre de controles impossibles de suite (moteur eteint, reseau), on se rabat sur l'immobilite seule.
const PROBE_MAX_FAILURES = 3;

const REFUSED_MESSAGE: Record<'no_document' | 'no_face' | 'mrz_unreadable', string> = {
  mrz_unreadable: 'Les caractères « < » en bas du verso ne sont pas lisibles. Rapprochez-vous, évitez les reflets et gardez le téléphone bien droit.',
  no_document: 'Nous ne voyons pas de pièce d’identité dans cette photo. Placez-la entière dans le cadre, bien éclairée.',
  no_face: 'Nous ne voyons pas de visage dans cette photo. Placez votre visage dans l’ovale, bien éclairé.',
};

// Hors mode strict, un MRZ illisible n'est plus un motif de refus : le dossier ira a un agent qui lit la piece lui-meme.
export const relaxMrz = (verdict: KycPrecheckResult, mode: 'strict' | 'warn' | 'off'): KycPrecheckResult =>
  verdict === 'mrz_unreadable' && mode !== 'strict' ? 'ok' : verdict;

type Phase = 'live' | 'checking' | 'sending' | 'refused' | 'error';
// `searching` : on cherche la piece / le visage ; `found` : reconnu ; `unavailable` : controle impossible.
type Detection = 'searching' | 'found' | 'unreadable' | 'unavailable';

interface Props {
  colors: KycColors;
  step: KycPhotoStep;
  progress: number;
  // « Photo 2 sur 3 »
  positionLabel: string;
  onClose: () => void;
  onBack?: () => void;
  // Envoie la photo ; doit rejeter avec un message affichable si le serveur la refuse. S'il reussit, l'ecran parent
  // passe a l'etape suivante et GARDE la photo (retour arriere) : c'est lui qui la supprimera.
  onSubmit: (uri: string) => Promise<void>;
  // Controle d'une petite copie : y a-t-il une piece / un visage ? Sert a la detection AVANT la prise (sonde) et au
  // controle d'une prise manuelle. Optionnel.
  onCheck?: (probeUri: string) => Promise<KycPrecheckResult>;
  // Reglage du serveur pour un MRZ illisible : hors `strict`, la photo n'est plus refusee pour ce motif (un agent la relira).
  mrzMode?: 'strict' | 'warn' | 'off';
}

// Photos recto, verso et selfie. Avant de prendre la photo, une petite photo-sonde est controlee en boucle par le moteur :
// la prise automatique ne part que quand la piece (ou le visage) est reconnue ET que le telephone est immobile. Sans
// controle possible, on se rabat sur l'immobilite seule. Le declencheur manuel et l'interrupteur « Auto » restent.
export const CaptureStep = ({ colors, step, progress, positionLabel, onClose, onBack, onSubmit, onCheck, mrzMode = 'strict' }: Props) => {
  const isSelfie = step === 'selfie';
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const cameraQueue = useRef<Promise<unknown>>(Promise.resolve());
  const busyRef = useRef(false);
  // Derniere photo presente dans le cache et non envoyee : supprimee si l'ecran est quitte.
  const pendingUriRef = useRef<string | null>(null);
  const checkRef = useRef(onCheck);
  const mrzModeRef = useRef(mrzMode);
  const [facing, setFacing] = useState<CameraType>(isSelfie ? 'front' : 'back');
  const [auto, setAuto] = useState(true);
  const [phase, setPhase] = useState<Phase>('live');
  const [detection, setDetection] = useState<Detection>('searching');
  const [frozen, setFrozen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armAfter, setArmAfter] = useState(ARM_AFTER_MS);

  useEffect(() => {
    checkRef.current = onCheck;
    mrzModeRef.current = mrzMode;
  });

  useEffect(
    () => () => {
      discardPhoto(pendingUriRef.current);
    },
    []
  );

  // La camera ne fait qu'une photo a la fois : sonde et prise reelle passent par la meme file.
  const withCamera = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const run = cameraQueue.current.then(job, job);
    cameraQueue.current = run.catch(() => undefined);
    return run;
  }, []);

  // Envoi de la photo preparee : « Analyse en cours », puis l'ecran parent passe a l'etape suivante (demontage).
  const send = useCallback(
    async (uri: string) => {
      busyRef.current = true;
      setError(null);
      setPhase('sending');
      try {
        await onSubmit(uri);
        pendingUriRef.current = null; // gardee par l'ecran parent
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : 'Envoi impossible.');
        setPhase('error');
      } finally {
        busyRef.current = false;
      }
    },
    [onSubmit]
  );

  // Verifie une petite copie de la photo : une photo d'un mur ne doit pas partir dans la session (le prestataire
  // rejette alors definitivement la session, et il n'y en a que quelques-unes par jour).
  const verify = useCallback(async (uri: string): Promise<KycPrecheckResult> => {
    const check = checkRef.current;
    if (!check) return 'skipped';
    const probe = await makeProbe(uri);
    try {
      return relaxMrz(await check(probe), mrzModeRef.current);
    } catch {
      return 'skipped';
    } finally {
      if (probe !== uri) discardPhoto(probe);
    }
  }, []);

  const capture = useCallback(
    async (alreadyDetected: boolean) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setError(null);
      const startedAt = Date.now();
      try {
        // Prise a bonne qualite. Un document est ensuite reduit (1800 px) ; le selfie est envoye tel quel, avec l'EXIF de
        // l'appareil (la verification de vivacite du prestataire le lit : une photo re-encodee, sans EXIF, est jugee suspecte).
        const picture = await withCamera(async () => cameraRef.current?.takePictureAsync({ quality: 0.9 }));
        if (!picture?.uri) throw new Error('empty picture');
        pendingUriRef.current = picture.uri;
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setFrozen(picture.uri);
        setPhase('checking');

        const prepared = isSelfie ? picture.uri : await preparePhoto(picture.uri, picture.width, picture.height);
        pendingUriRef.current = prepared;
        kycLog('captured', { step, detectedBefore: alreadyDetected, width: picture.width, height: picture.height, ms: elapsedMs(startedAt) });

        // Prise manuelle (ou controle indisponible) : on verifie ici ce que la sonde n'a pas verifie.
        if (!alreadyDetected) {
          const verdict = await verify(prepared);
          if (verdict === 'no_document' || verdict === 'no_face' || verdict === 'mrz_unreadable') {
            kycWarn('photo refused before upload', { step, verdict });
            setError(REFUSED_MESSAGE[verdict]);
            setPhase('refused');
            return;
          }
        }
        busyRef.current = false;
        await send(prepared);
      } catch (captureError) {
        kycWarn('capture failed', { step, reason: captureError instanceof Error ? captureError.message : 'unknown' });
        setError('La photo n’a pas pu être prise. Réessayez.');
        setPhase('error');
      } finally {
        busyRef.current = false;
      }
    },
    [isSelfie, send, step, verify, withCamera]
  );

  // Detection AVANT la prise : une petite photo-sonde toutes les ~1 s, controlee par le moteur.
  const probeEnabled = auto && phase === 'live' && Boolean(permission?.granted) && Boolean(onCheck);
  useEffect(() => {
    if (!probeEnabled) return;
    let cancelled = false;
    let failures = 0;
    const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    const loop = async () => {
      await pause(armAfter);
      while (!cancelled) {
        let verdict: KycPrecheckResult = 'skipped';
        try {
          // `shutterSound: false` : sans declic sur Android (sur iPhone le systeme l'impose).
          const shot = await withCamera(async () => cameraRef.current?.takePictureAsync({ quality: 0.3, skipProcessing: true, shutterSound: false }));
          if (!shot?.uri) break;
          if (cancelled) {
            discardPhoto(shot.uri);
            return;
          }
          const probe = await makeProbe(shot.uri);
          if (probe !== shot.uri) discardPhoto(shot.uri);
          try {
            verdict = relaxMrz((await checkRef.current?.(probe)) ?? 'skipped', mrzModeRef.current);
          } finally {
            discardPhoto(probe);
          }
        } catch {
          verdict = 'skipped';
        }
        if (cancelled) return;
        if (verdict === 'skipped') {
          failures += 1;
          if (failures >= PROBE_MAX_FAILURES) {
            kycWarn('detection unavailable, falling back to steadiness only', { step });
            setDetection('unavailable');
            return;
          }
        } else {
          failures = 0;
          setDetection(verdict === 'ok' ? 'found' : verdict === 'mrz_unreadable' ? 'unreadable' : 'searching');
        }
        kycLog('probe', { step, verdict });
        await pause(verdict === 'ok' ? PROBE_PAUSE_FOUND_MS : PROBE_PAUSE_SEARCHING_MS);
      }
    };
    void loop();
    return () => {
      cancelled = true;
    };
  }, [probeEnabled, armAfter, step, withCamera]);

  // Prise automatique : reconnu (ou controle impossible) ET telephone immobile.
  const detected = detection === 'found';
  const { progress: steadiness } = useSteadiness({
    enabled: auto && phase === 'live' && Boolean(permission?.granted) && (detected || detection === 'unavailable' || !onCheck),
    holdMs: HOLD_MS[step],
    armAfterMs: ARM_AFTER_MS,
    onSteady: () => void capture(detected),
  });

  const retake = () => {
    discardPhoto(pendingUriRef.current);
    pendingUriRef.current = null;
    setFrozen(null);
    setError(null);
    setDetection('searching');
    setArmAfter(REARM_AFTER_REFUSAL_MS);
    setPhase('live');
  };

  // Le controle s'est trompe (carte tres abimee, texte trop petit) : on laisse envoyer la photo telle quelle.
  const sendAnyway = () => {
    if (pendingUriRef.current) void send(pendingUriRef.current);
  };

  if (!permission) {
    return (
      <KycFrame colors={colors} progress={progress} onClose={onClose} onBack={onBack}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors['brand.primary']} />
        </View>
      </KycFrame>
    );
  }

  if (!permission.granted) {
    return (
      <KycFrame
        colors={colors}
        progress={progress}
        onClose={onClose}
        onBack={onBack}
        footer={<Button title="Autoriser la caméra" onPress={() => void requestPermission()} />}
      >
        <Heading
          colors={colors}
          title="Accès à la caméra"
          subtitle="DioteKo a besoin de la caméra pour photographier votre pièce d’identité et votre visage. Aucune photo n’est publiée."
        />
      </KycFrame>
    );
  }

  const live = phase === 'live';
  const what = isSelfie ? 'visage' : 'pièce';
  const hint =
    phase === 'checking'
      ? 'Vérification de la photo…'
      : phase === 'sending'
        ? 'Analyse en cours… cela peut prendre jusqu’à une minute.'
        : phase === 'refused'
          ? 'Photo non conforme'
          : !auto || !onCheck || detection === 'unavailable'
            ? auto && steadiness > 0.05
              ? 'Ne bougez plus…'
              : COPY[step].hint
            : detected
              ? `${isSelfie ? 'Visage détecté' : 'Pièce détectée'}, ne bougez plus…`
              : detection === 'unreadable'
                ? 'Verso détecté, mais les caractères « < » en bas ne sont pas lisibles : rapprochez-vous, évitez les reflets.'
                : `Recherche du ${what}… ${COPY[step].hint}`;

  const footer =
    phase === 'refused' ? (
      <>
        <Button title="Reprendre" onPress={retake} />
        <Button title="Envoyer quand même" onPress={sendAnyway} variant="secondary" style={styles.gap} />
      </>
    ) : phase === 'error' ? (
      <Button title="Reprendre" onPress={retake} />
    ) : phase === 'sending' || phase === 'checking' ? null : (
      <View style={styles.footerRow}>
        <TouchableOpacity
          onPress={() => setAuto((value) => !value)}
          accessibilityRole="switch"
          accessibilityState={{ checked: auto }}
          accessibilityLabel="Capture automatique"
          style={[styles.autoChip, { backgroundColor: colors['surface.raised'] }]}
        >
          <Text style={{ color: auto ? colors['brand.primary'] : colors['text.muted'], fontWeight: '600', fontSize: 13 }}>
            {auto ? 'Auto : activée' : 'Auto : désactivée'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => void capture(false)}
          accessibilityRole="button"
          accessibilityLabel="Prendre la photo"
          style={[styles.shutterRing, { borderColor: colors['brand.primary'] }]}
        >
          <View style={[styles.shutter, { backgroundColor: colors['brand.primary'] }]} />
        </TouchableOpacity>
        <View style={styles.footerSpacer} />
      </View>
    );

  return (
    <KycFrame colors={colors} progress={progress} label={positionLabel} onClose={onClose} onBack={onBack} footer={footer}>
      <Heading colors={colors} title={COPY[step].title} subtitle={hint} />

      <View style={[styles.viewport, { backgroundColor: colors['bg.muted'] }]}>
        {frozen ? (
          <>
            <Image source={{ uri: frozen }} style={styles.fill} resizeMode="cover" accessibilityLabel="Photo prise" />
            {phase === 'sending' || phase === 'checking' ? (
              <View style={styles.sending}>
                <ActivityIndicator size="large" color="#FFFFFF" />
              </View>
            ) : null}
          </>
        ) : (
          <>
            <CameraView ref={cameraRef} style={styles.fill} facing={facing} />
            <View pointerEvents="none" style={styles.overlay}>
              <ScanOverlay variant={isSelfie ? 'face' : 'document'} accent={colors['brand.primary']} steady={detected || (auto && steadiness > 0.05 && (!onCheck || detection === 'unavailable'))} />
            </View>
            <TouchableOpacity
              onPress={() => setFacing((current) => (current === 'back' ? 'front' : 'back'))}
              accessibilityRole="button"
              accessibilityLabel="Changer de caméra"
              style={styles.flip}
            >
              <IconSymbol name="camera.rotate.fill" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </>
        )}
      </View>

      {live && auto ? (
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(steadiness * 100) }} style={[styles.steadyTrack, { backgroundColor: colors['surface.raised'] }]}>
          <View style={[styles.steadyFill, { width: `${Math.round(steadiness * 100)}%`, backgroundColor: colors['brand.primary'] }]} />
        </View>
      ) : null}

      {error ? <ErrorText colors={colors} message={error} /> : null}
    </KycFrame>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  gap: { marginTop: 10 },
  viewport: { width: '100%', aspectRatio: 3 / 4, maxHeight: '64%', borderRadius: 20, overflow: 'hidden', alignSelf: 'center' },
  fill: { width: '100%', height: '100%' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  sending: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  flip: { position: 'absolute', right: 12, top: 12, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  steadyTrack: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 12, marginHorizontal: 8 },
  steadyFill: { height: 6, borderRadius: 3 },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  footerSpacer: { width: 110 },
  autoChip: { width: 110, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  shutterRing: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  shutter: { width: 58, height: 58, borderRadius: 29 },
});
