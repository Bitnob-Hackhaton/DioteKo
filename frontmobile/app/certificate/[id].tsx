import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Share,
  ActivityIndicator,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect, Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { PaymentPanel } from '@/components/PaymentPanel';
import { Card } from '@/components/ui/Card';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { Button } from '@/components/ui/Button';
import { WebView } from 'react-native-webview';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import {
  birthCertificateFieldsFromRequest,
  buildBirthCertificateHtml,
  buildQrSvg,
} from '@/services/birth-certificate-html';
import { IconSymbol } from '@/components/ui/icon-symbol';
import Toast from 'react-native-toast-message';
import { Timeline } from '@/components/ui/Timeline';
import * as Haptics from 'expo-haptics';
import {
  getCertificateFileUrl,
  getCertificateTypes,
  getMyCertificateRequest,
  type CertificateRequestView,
} from '@/services/api';
import {
  buildTimeline,
  displayName,
  formatDate,
  statusDetail,
  toUiStatus,
  typeNameById,
  verificationLink,
  type CertificateUiStatus,
} from '@/services/certificate-requests';

// L'identifiant de la route est celui de la DEMANDE (GET /admin-certificates/requests/:id, titulaire seulement).
// Le certificat n'existe (et son QR de verification) qu'une fois la demande `issued`.
// A4 sheet: 794 css px wide at 96 dpi (matches the viewport of the generated HTML), 595 x 842 points for the PDF.
const A4_CSS_WIDTH = 794;
const A4_RATIO = 842 / 595;
const A4_POINTS = { width: 595, height: 842 };
// Reports the real height of the sheet (css px) so the WebView is exactly as tall as the scaled content.
const MEASURE_SHEET_JS = 'window.ReactNativeWebView.postMessage(String(document.documentElement.scrollHeight)); true;';

const CertificateDetailScreen = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const colors = Colors[colorScheme];
  const { width: windowWidth } = useWindowDimensions();
  // The certificate is laid out on an A4 sheet (794 css px wide) and scaled down to the screen width, so the
  // whole sheet is visible without a second scroll area inside the page scroll.
  const sheetWidth = Math.max(windowWidth - 32, 240);
  const [sheetContentHeight, setSheetContentHeight] = useState<number | null>(null);
  const sheetHeight = Math.round(sheetWidth * (sheetContentHeight ? sheetContentHeight / A4_CSS_WIDTH : A4_RATIO));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState<CertificateRequestView | null>(null);
  const [name, setName] = useState('');

  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  // Rechargement sans spinner plein ecran : tirer pour rafraichir, retour sur l'ecran, suivi de la generation.
  const refresh = useCallback(() => {
    setRefreshing(true);
    setReloadKey((key) => key + 1);
  }, []);

  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      setReloadKey((key) => key + 1);
    }, [])
  );

  // Paiement constate : le serveur genere le certificat en quelques secondes ; on suit jusqu'a `issued`.
  const generating = request?.status === 'paid' || request?.status === 'issuing';
  useEffect(() => {
    if (!generating) return;
    const timer = setInterval(() => setReloadKey((key) => key + 1), 3000);
    return () => clearInterval(timer);
  }, [generating]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [requestData, typesData] = await Promise.all([
          getMyCertificateRequest(String(id)),
          getCertificateTypes().catch(() => []),
        ]);
        if (cancelled) return;
        setError(null);
        setRequest(requestData);
        setName(displayName(requestData, typeNameById(typesData)));
      } catch (fetchError) {
        console.error('[certificate] failed to load request:', fetchError);
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : 'Impossible de charger cette demande.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  // Extrait officiel (id2) + QR de verification, genere localement une fois la demande emise.
  const [certificateHtml, setCertificateHtml] = useState<string | null>(null);
  useEffect(() => {
    if (request?.status !== 'issued' || !request.certificateId) {
      return;
    }
    let cancelled = false;
    const fields = birthCertificateFieldsFromRequest(request);
    buildQrSvg(fields.verify_url)
      .then((qrSvg) => {
        if (!cancelled) setCertificateHtml(buildBirthCertificateHtml(fields, qrSvg));
      })
      .catch((qrError) => console.error('[certificate] failed to build QR:', qrError));
    return () => {
      cancelled = true;
    };
  }, [request]);

  // `loading` vaut deja true au premier rendu ; "Réessayer" le repasse a true puis relance l'effet.
  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    setReloadKey((key) => key + 1);
  }, []);

  const copyToClipboard = async (text: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await Clipboard.setStringAsync(text);
    Toast.hide();
    setTimeout(() => {
      Toast.show({
        type: 'success',
        text1: 'Copied to clipboard!',
        visibilityTime: 2000,
      });
    }, 100);
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors['brand.primary']} />
        </View>
      </SafeAreaView>
    );
  }

  // A failed reload (polling, refocus) must not wipe a request that is already on screen.
  if (!request) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.centered}>
          <Text style={[styles.message, { color: colors['state.error.fg'] }]}>{error ?? 'Demande introuvable.'}</Text>
          <Button title="Réessayer" onPress={fetchData} variant="secondary" style={{ marginTop: 12 }} />
        </View>
      </SafeAreaView>
    );
  }

  const uiStatus = toUiStatus(request.status, request.validity);
  const timeline = buildTimeline(request.status);
  const certificateId = request.certificateId;
  const link = certificateId ? verificationLink(certificateId) : null;

  const handleShare = async () => {
    if (!certificateId || !link) return;
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await Share.share({
        title: name,
        message: `${name}\nCertificat ID: ${certificateId}\nVérifiez l'authenticité: ${link}`,
      });
    } catch (shareError) {
      console.error('Error sharing:', shareError);
      Toast.show({ type: 'error', text1: 'Erreur lors du partage', text2: 'Veuillez réessayer', visibilityTime: 3000 });
    }
  };

  // Lien signe (court) demande au backend : le PDF s'ouvre dans le navigateur du telephone, qui n'a pas le jeton.
  const handleDownload = async () => {
    if (!certificateId) return;
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      // PDF local depuis l'extrait affiche (avec QR) ; repli sur le PDF du serveur si l'impression echoue.
      if (certificateHtml) {
        try {
          const { uri } = await Print.printToFileAsync({ html: certificateHtml, width: A4_POINTS.width, height: A4_POINTS.height });
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: name });
            return;
          }
        } catch (printError) {
          console.error('Error printing the PDF locally, falling back to server PDF:', printError);
        }
      }
      await WebBrowser.openBrowserAsync(await getCertificateFileUrl(request.id));
    } catch (openError) {
      console.error('Error opening the PDF:', openError);
      Toast.show({ type: 'error', text1: "Impossible d'ouvrir le PDF", text2: 'Veuillez réessayer', visibilityTime: 3000 });
    }
  };

  const rows: { label: string; value: string; copyable?: boolean }[] = [
    { label: 'Demande ID', value: request.id, copyable: true },
    { label: 'Type', value: name },
    { label: 'Prix', value: request.priceSats != null ? `${request.priceSats} sats` : '—' },
    { label: 'Date de la demande', value: formatDate(request.createdAt) },
  ];
  if (certificateId) {
    rows.push({ label: 'Certificat ID', value: certificateId, copyable: true });
  }
  if (request.expiresAt) {
    rows.push({ label: "Date d'expiration", value: formatDate(request.expiresAt) });
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.text} />}
      >
        <View style={[styles.header, { backgroundColor: getStatusColor(uiStatus, colorScheme) }]}>
          <IconSymbol name={getStatusIcon(uiStatus)} size={64} color="white" />
          <Text style={[styles.headerTitle, { color: colors['text.inverse'] }]}>{name}</Text>
          <Text style={[styles.headerSubtitle, { color: colors['text.inverse'] }]}>{statusDetail(request.status, request.validity)}</Text>
        </View>

        {request.status === 'rejected' && (
          <Card style={[styles.reasonCard, { borderColor: colors['state.error.fg'] }]}>
            <Text style={[styles.reasonTitle, { color: colors['state.error.fg'] }]}>Demande refusée</Text>
            <Text style={[styles.reasonText, { color: colors['text.secondary'] }]}>
              {request.decisionReason ?? "L'organisation a refusé cette demande."}
            </Text>
          </Card>
        )}

        {request.status === 'pending' && (
          <Card style={[styles.reasonCard, { borderColor: colors['state.warning.fg'] }]}>
            <Text style={[styles.reasonTitle, { color: colors['state.warning.fg'] }]}>Vérification en cours</Text>
            <Text style={[styles.reasonText, { color: colors['text.secondary'] }]}>
              L&apos;organisation vérifie votre demande. Vous pourrez payer dès qu&apos;elle sera acceptée ; tirez l&apos;écran vers
              le bas pour actualiser.
            </Text>
          </Card>
        )}

        {request.status === 'needs_info' && (
          <Card style={[styles.reasonCard, { borderColor: colors['state.warning.fg'] }]}>
            <Text style={[styles.reasonTitle, { color: colors['state.warning.fg'] }]}>Complément demandé</Text>
            <Text style={[styles.reasonText, { color: colors['text.primary'] }]}>
              {request.decisionReason ?? "L'organisation demande un complément d'information."}
            </Text>
            <Button
              title="Corriger et renvoyer"
              onPress={() => router.push(`/certificate/new?resubmit=${encodeURIComponent(request.id)}`)}
              style={{ marginTop: 12 }}
            />
          </Card>
        )}

        {(request.status === 'accepted' || request.status === 'awaiting_payment') && (
          <PaymentPanel
            requestId={request.id}
            status={request.status}
            amountSats={request.priceSats}
            onSettled={refresh}
          />
        )}

        {generating && (
          <Card style={[styles.reasonCard, { borderColor: colors['brand.primary'] }]}>
            <Text style={[styles.reasonTitle, { color: colors['text.primary'] }]}>Génération du certificat</Text>
            <ActivityIndicator color={colors['brand.primary']} style={{ marginVertical: 8 }} />
            <Text style={[styles.reasonText, { color: colors['text.secondary'] }]}>
              Paiement reçu. Votre certificat est généré automatiquement, cela prend quelques secondes.
            </Text>
          </Card>
        )}

        <View style={styles.timelineContainer}>
          <Timeline steps={timeline.steps} currentStep={timeline.currentStep} />
        </View>

        <View style={styles.detailsContainer}>
          <Text style={[styles.sectionTitle, { color: colors['text.primary'] }]}>Détails</Text>
          {rows.map((row) => (
            <View key={row.label} style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: colors['text.muted'] }]}>{row.label}</Text>
              {row.copyable ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Copier ${row.label}`}
                  style={styles.copyableValue}
                  onPress={() => copyToClipboard(row.value)}
                >
                  <Text style={[styles.infoValue, { color: colors['text.primary'] }]} numberOfLines={1}>
                    {row.value}
                  </Text>
                  <IconSymbol name="square.on.square" size={16} color={colors['text.muted']} style={{ marginLeft: 8 }} />
                </TouchableOpacity>
              ) : (
                <Text style={[styles.infoValue, { color: colors['text.primary'] }]}>{row.value}</Text>
              )}
            </View>
          ))}
        </View>

        {link && (
          <>
            <View style={styles.certificateContainer}>
              {certificateHtml ? (
                <WebView
                  source={{ html: certificateHtml }}
                  style={[styles.certificateWebView, { height: sheetHeight }]}
                  originWhitelist={['*']}
                  scrollEnabled={false}
                  scalesPageToFit
                  showsVerticalScrollIndicator={false}
                  injectedJavaScript={MEASURE_SHEET_JS}
                  onMessage={(event) => {
                    const measured = Number(event.nativeEvent.data);
                    if (Number.isFinite(measured) && measured > 0) setSheetContentHeight(measured);
                  }}
                />
              ) : (
                <ActivityIndicator color={colors['brand.primary']} style={{ marginVertical: 24 }} />
              )}
            </View>
            <View style={styles.actionsContainer}>
              <Button title="Télécharger le PDF" onPress={handleDownload} />
              <Button title="Partager" onPress={handleShare} variant="secondary" />
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const getStatusColor = (status: CertificateUiStatus, colorScheme: 'light' | 'dark') => {
  const colors = Colors[colorScheme];
  switch (status) {
    case 'Valid':
      return colors['state.success.fg'];
    case 'Pending':
    case 'Expiring Soon':
      return colors['state.warning.fg'];
    case 'Refused':
    case 'Expired':
    case 'Revoked':
      return colors['state.error.fg'];
  }
};

const getStatusIcon = (status: CertificateUiStatus) => {
  switch (status) {
    case 'Valid':
      return 'checkmark.shield.fill';
    case 'Pending':
      return 'hourglass';
    case 'Expiring Soon':
    case 'Expired':
      return 'clock.fill';
    case 'Refused':
    case 'Revoked':
      return 'xmark.shield.fill';
  }
};

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    padding: 32,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 16,
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 16,
    marginTop: 4,
  },
  reasonCard: {
    marginHorizontal: 24,
    marginBottom: 16,
    padding: 16,
    borderWidth: 1,
    borderRadius: 8,
  },
  reasonTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  reasonText: {
    fontSize: 14,
  },
  timelineContainer: {
    marginHorizontal: 24,
    marginBottom: 16,
  },
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  message: {
    fontSize: 14,
    textAlign: 'center',
  },
  detailsContainer: {
    padding: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  infoLabel: {
    fontSize: 16,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '600',
    flexShrink: 1,
  },
  copyableValue: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    marginLeft: 16,
  },
  certificateContainer: {
    marginHorizontal: 16,
    marginVertical: 24,
    borderRadius: 8,
    overflow: 'hidden',
  },
  certificateWebView: {
    backgroundColor: 'white',
  },
  actionsContainer: {
    paddingHorizontal: 24,
    marginBottom: 32,
    gap: 12,
  },
});

export default CertificateDetailScreen;
