import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CountryField } from '@/components/CountryField';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useKycStatus } from '@/hooks/use-kyc-status';
import { useGlobalContext } from '@/lib/global-provider';
import {
  createCertificateRequest,
  getCertificateTypes,
  getMyCertificateRequest,
  isKycRequiredError,
  resubmitCertificateRequest,
  type CertificateRequestView,
  type CertificateTypeInfo,
} from '@/services/api';
import { CERTIFICATE_LABELS } from '@/services/certificate-requests';

// Les 7 champs que le PDF du certificat imprime (backend `certificate-pdf.service.ts`). Le serveur ne valide pas
// les champs par type : ces regles sont celles du formulaire, pas une garantie cote serveur.
type FieldKey =
  | 'fullName'
  | 'dateOfBirth'
  | 'placeOfBirth'
  | 'fatherName'
  | 'motherName'
  | 'nationality'
  | 'idNumber';

const FIELDS: { key: FieldKey; label: string; placeholder?: string; keyboard?: 'default' | 'numbers-and-punctuation' }[] =
  [
    { key: 'fullName', label: 'Nom complet' },
    { key: 'dateOfBirth', label: 'Date de naissance' },
    { key: 'placeOfBirth', label: 'Lieu de naissance' },
    { key: 'fatherName', label: 'Nom du père' },
    { key: 'motherName', label: 'Nom de la mère' },
    { key: 'nationality', label: 'Nationalité' },
    { key: 'idNumber', label: "Numéro de pièce d'identité" },
  ];

const ALWAYS_REQUIRED: FieldKey[] = ['fullName', 'dateOfBirth'];
const REQUIRED_BY_TYPE: Record<string, FieldKey[]> = {
  birth: ['placeOfBirth', 'fatherName', 'motherName'],
  residence: ['idNumber'],
  identity: ['idNumber'],
};

const isValidDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

// Date au format du serveur (AAAA-MM-JJ) <-> Date locale. On lit/ecrit les composantes locales : passer par
// toISOString() decalerait d'un jour dans les fuseaux a l'est de UTC.
const toDateString = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const fromDateString = (value: string | undefined): Date | null => {
  if (!value || !isValidDate(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const displayDate = (value: string | undefined): string | null => {
  const date = fromDateString(value);
  return date ? date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : null;
};

const DEFAULT_PICKER_DATE = new Date(2000, 0, 1);

// Selecteur de date NATIF du telephone : calendrier systeme sur Android, roue sur iOS. Sur le web (pas de
// selecteur natif), repli sur une saisie AAAA-MM-JJ.
const DateField = ({
  label,
  value,
  onChange,
  disabled,
  error,
  colors,
}: {
  label: string;
  value: string | undefined;
  onChange: (next: string) => void;
  disabled: boolean;
  error: string | undefined;
  colors: (typeof Colors)['light'];
}) => {
  const [iosOpen, setIosOpen] = useState(false);
  const current = fromDateString(value) ?? DEFAULT_PICKER_DATE;
  const maximumDate = new Date();
  const borderColor = error ? colors['state.error.fg'] : colors['text.muted'];

  const handleChange = (_event: DateTimePickerEvent, picked?: Date) => {
    if (picked) onChange(toDateString(picked));
  };

  const open = () => {
    if (disabled) return;
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({ value: current, mode: 'date', maximumDate, onChange: handleChange });
    } else {
      setIosOpen((previous) => !previous);
    }
  };

  if (Platform.OS === 'web') {
    return (
      <TextInput
        value={value ?? ''}
        onChangeText={onChange}
        placeholder="AAAA-MM-JJ"
        placeholderTextColor={colors['text.muted']}
        editable={!disabled}
        accessibilityLabel={label}
        style={[
          styles.input,
          { color: colors['text.primary'], backgroundColor: colors['surface.default'], borderColor },
        ]}
      />
    );
  }

  return (
    <View>
      <TouchableOpacity
        onPress={open}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label} : ${displayDate(value) ?? 'choisir une date'}`}
        style={[styles.input, styles.dateButton, { backgroundColor: colors['surface.default'], borderColor }]}
      >
        <Text style={{ fontSize: 16, color: value ? colors['text.primary'] : colors['text.muted'] }}>
          {displayDate(value) ?? 'Choisir une date'}
        </Text>
      </TouchableOpacity>
      {Platform.OS === 'ios' && iosOpen && (
        <View>
          <DateTimePicker
            value={current}
            mode="date"
            display="spinner"
            maximumDate={maximumDate}
            locale="fr-FR"
            onChange={handleChange}
            themeVariant={colors === Colors.dark ? 'dark' : 'light'}
          />
          <Button title="OK" onPress={() => setIosOpen(false)} variant="secondary" style={styles.dateDone} />
        </View>
      )}
    </View>
  );
};

const toStringRecord = (data: Record<string, unknown> | undefined): Partial<Record<FieldKey, string>> => {
  const out: Partial<Record<FieldKey, string>> = {};
  for (const { key } of FIELDS) {
    const value = data?.[key];
    if (typeof value === 'string') out[key] = value;
  }
  return out;
};

// Depot d'une demande (`?type=<id>`) ou reponse a un complement demande (`?resubmit=<id de la demande>`).
const NewCertificateRequestScreen = () => {
  const { type, resubmit } = useLocalSearchParams<{ type?: string; resubmit?: string }>();
  const router = useRouter();
  const colorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const colors = Colors[colorScheme];
  const { user } = useGlobalContext();
  const { kyc, refresh: refreshKyc } = useKycStatus();

  // Au retour de l'ecran de verification, le statut est relu.
  useFocusEffect(
    useCallback(() => {
      void refreshKyc();
    }, [refreshKyc])
  );

  const [typeInfo, setTypeInfo] = useState<CertificateTypeInfo | null>(null);
  const [original, setOriginal] = useState<CertificateRequestView | null>(null);
  const [values, setValues] = useState<Partial<Record<FieldKey, string>>>({});
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isResubmit = Boolean(resubmit);
  const certificateType = isResubmit ? original?.certificateType : type;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [types, request] = await Promise.all([
          getCertificateTypes(),
          resubmit ? getMyCertificateRequest(String(resubmit)) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        const wanted = request?.certificateType ?? type;
        const found = types.find((candidate) => candidate.id === wanted) ?? null;
        if (!found) {
          setLoadError('Type de certificat inconnu.');
          return;
        }
        setTypeInfo(found);
        setOriginal(request);
        if (request) {
          setValues(toStringRecord(request.submittedData));
        } else {
          const name = (user?.displayName ?? user?.name) as string | undefined;
          setValues(name ? { fullName: name } : {});
        }
      } catch (fetchError) {
        if (!cancelled) setLoadError(fetchError instanceof Error ? fetchError.message : 'Chargement impossible.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [type, resubmit, user?.displayName, user?.name]);

  const required = useMemo(
    () => new Set<FieldKey>([...ALWAYS_REQUIRED, ...(REQUIRED_BY_TYPE[certificateType ?? ''] ?? [])]),
    [certificateType]
  );

  const errors = useMemo(() => {
    const result: Partial<Record<FieldKey, string>> = {};
    for (const { key } of FIELDS) {
      const value = (values[key] ?? '').trim();
      if (required.has(key) && !value) result[key] = 'Champ obligatoire';
      else if (key === 'dateOfBirth' && value && !isValidDate(value)) result[key] = 'Date invalide';
    }
    return result;
  }, [values, required]);

  const hasErrors = Object.keys(errors).length > 0;

  // Le serveur reste l'autorite (403 KYC_REQUIRED) ; l'ecran n'anticipe que si le statut est connu. Un statut
  // illisible ne bloque pas : on laisse le serveur trancher.
  const kycVerified = kyc?.status === 'verified';
  const kycBlocked = typeInfo?.kyc === 'required' && kyc !== null && !kycVerified;
  const kycPlanned = typeInfo?.kyc === 'planned' && kyc !== null && !kycVerified;
  // Dossier deja depose et relu par un agent : inutile de le refaire, il faut attendre la decision.
  const kycAwaitingAgent = kyc?.status === 'manual_review';

  const submit = async () => {
    setTouched(true);
    if (hasErrors || !certificateType) return;
    const submittedData: Record<string, string> = {};
    for (const { key } of FIELDS) {
      const value = (values[key] ?? '').trim();
      if (value) submittedData[key] = value;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const request =
        isResubmit && resubmit
          ? await resubmitCertificateRequest(String(resubmit), submittedData)
          : await createCertificateRequest(certificateType, submittedData);
      Toast.show({
        type: 'success',
        text1: isResubmit ? 'Complément envoyé' : 'Demande envoyée',
        text2: isResubmit ? "L'organisation va revérifier votre demande." : undefined,
      });
      router.replace(`/certificate/${request.id}`);
    } catch (error) {
      if (isKycRequiredError(error)) {
        Toast.show({ type: 'info', text1: 'Vérification d’identité requise' });
        router.push('/kyc');
        return;
      }
      setSubmitError(error instanceof Error ? error.message : "Impossible d'envoyer la demande.");
    } finally {
      setSubmitting(false);
    }
  };

  const title = typeInfo ? (CERTIFICATE_LABELS[typeInfo.id]?.title ?? typeInfo.name) : 'Nouvelle demande';

  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: true, title: isResubmit ? 'Compléter la demande' : 'Nouvelle demande' }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors['brand.primary']} />
          </View>
        ) : loadError || !typeInfo ? (
          <View style={styles.centered}>
            <Text style={[styles.message, { color: colors['state.error.fg'] }]}>{loadError ?? 'Chargement impossible.'}</Text>
            <Button title="Retour" onPress={() => router.back()} variant="secondary" style={styles.retry} />
          </View>
        ) : (
          <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={[styles.title, { color: colors['text.primary'] }]}>{title}</Text>
            <Text style={[styles.subtitle, { color: colors['text.secondary'] }]}>
              {isResubmit
                ? 'Corrigez ou complétez les informations demandées, puis renvoyez.'
                : `${typeInfo.priceSats.toLocaleString('fr-FR')} sats. Vous paierez une fois la demande acceptée.`}
            </Text>

            {isResubmit && original?.decisionReason && (
              <Card style={[styles.noteCard, { borderColor: colors['state.warning.fg'] }]}>
                <Text style={[styles.noteTitle, { color: colors['state.warning.fg'] }]}>Message de l&apos;organisation</Text>
                <Text style={{ color: colors['text.primary'] }}>{original.decisionReason}</Text>
              </Card>
            )}

            {kycBlocked && kycAwaitingAgent && (
              <Card style={[styles.noteCard, { borderColor: colors['state.warning.fg'] }]}>
                <Text style={[styles.noteTitle, { color: colors['state.warning.fg'] }]}>Vérification d&apos;identité en cours</Text>
                <Text style={{ color: colors['text.primary'] }}>
                  Vos documents ont été reçus et sont en cours de vérification par un agent. Vous pourrez déposer cette demande dès
                  qu’ils seront validés.
                </Text>
                <Button title="Voir l’état de ma vérification" onPress={() => router.push('/kyc')} variant="secondary" style={styles.kycButton} />
              </Card>
            )}

            {kycBlocked && !kycAwaitingAgent && (
              <Card style={[styles.noteCard, { borderColor: colors['state.warning.fg'] }]}>
                <Text style={[styles.noteTitle, { color: colors['state.warning.fg'] }]}>Vérification d&apos;identité requise</Text>
                <Text style={{ color: colors['text.primary'] }}>
                  Ce certificat n’est délivré qu’à une personne dont l’identité a été vérifiée. Cela prend quelques minutes : votre pièce
                  d’identité, puis un selfie.
                </Text>
                <Button title="Vérifier mon identité" onPress={() => router.push('/kyc')} style={styles.kycButton} />
              </Card>
            )}

            {kycPlanned && (
              <Card style={[styles.noteCard, { borderColor: colors['text.muted'] }]}>
                <Text style={{ color: colors['text.primary'] }}>
                  La vérification d’identité deviendra obligatoire pour ce document.{' '}
                  <Text
                    accessibilityRole="link"
                    onPress={() => router.push('/kyc')}
                    style={{ color: colors['brand.primary'], fontWeight: '600' }}
                  >
                    Vérifier mon identité
                  </Text>
                </Text>
              </Card>
            )}

            {!kycBlocked && FIELDS.map(({ key, label, placeholder, keyboard }) => {
              const showError = touched && errors[key];
              return (
                <View key={key} style={styles.field}>
                  <Text style={[styles.label, { color: colors['text.secondary'] }]}>
                    {label}
                    {required.has(key) ? ' *' : ''}
                  </Text>
                  {key === 'dateOfBirth' ? (
                    <DateField
                      label={label}
                      value={values[key]}
                      onChange={(next) => setValues((previous) => ({ ...previous, [key]: next }))}
                      disabled={submitting}
                      error={showError ? errors[key] : undefined}
                      colors={colors}
                    />
                  ) : key === 'nationality' ? (
                    <CountryField
                      label={label}
                      value={values[key]}
                      onChange={(next) => setValues((previous) => ({ ...previous, [key]: next }))}
                      disabled={submitting}
                      error={showError ? errors[key] : undefined}
                      colors={colors}
                    />
                  ) : (
                    <TextInput
                      value={values[key] ?? ''}
                      onChangeText={(text) => setValues((previous) => ({ ...previous, [key]: text }))}
                      placeholder={placeholder}
                      placeholderTextColor={colors['text.muted']}
                      keyboardType={keyboard ?? 'default'}
                      autoCapitalize={key === 'idNumber' ? 'none' : 'words'}
                      autoCorrect={false}
                      editable={!submitting}
                      accessibilityLabel={label}
                      style={[
                        styles.input,
                        {
                          color: colors['text.primary'],
                          backgroundColor: colors['surface.default'],
                          borderColor: showError ? colors['state.error.fg'] : colors['text.muted'],
                        },
                      ]}
                    />
                  )}
                  {showError ? <Text style={[styles.fieldError, { color: colors['state.error.fg'] }]}>{errors[key]}</Text> : null}
                </View>
              );
            })}

            {!kycBlocked && submitError && <Text style={[styles.message, { color: colors['state.error.fg'] }]}>{submitError}</Text>}

            {!kycBlocked && (
              <Button
                title={isResubmit ? 'Renvoyer la demande' : 'Envoyer la demande'}
                onPress={submit}
                loading={submitting}
                style={styles.submit}
              />
            )}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  content: { padding: 24, paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { fontSize: 24, fontWeight: 'bold' },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: 4, marginBottom: 20 },
  noteCard: { padding: 16, borderWidth: 1, borderRadius: 8, marginBottom: 16 },
  noteTitle: { fontSize: 14, fontWeight: 'bold', marginBottom: 6 },
  field: { marginBottom: 14 },
  label: { fontSize: 14, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  dateButton: { justifyContent: 'center', minHeight: 48 },
  dateDone: { marginTop: 4 },
  fieldError: { fontSize: 12, marginTop: 4 },
  message: { fontSize: 14, textAlign: 'center', marginTop: 8 },
  retry: { marginTop: 12 },
  submit: { marginTop: 20 },
  kycButton: { marginTop: 12 },
});

export default NewCertificateRequestScreen;
