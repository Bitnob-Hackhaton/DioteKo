import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PaymentMethodPicker } from '@/components/PaymentMethodPicker';
import type { PaymentProviderId } from '@/constants/payment-providers';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useInvoicePolling } from '@/hooks/use-invoice-polling';
import {
  createLightningInvoice,
  getOpenInvoice,
  getPaymentConfig,
  simulatePayment,
  type CertificateRequestStatus,
  type RequestInvoice,
} from '@/services/api';

interface Props {
  requestId: string;
  // `accepted` : pas encore de facture (bouton "Payer"). `awaiting_payment` : une facture existe, on la relit.
  status: CertificateRequestStatus;
  amountSats: number | null;
  // Appele des que le paiement est constate : l'ecran parent recharge la demande (paid -> issuing -> issued).
  onSettled: () => void;
}

const formatRemaining = (expiresAt: string | null, now: number): string | null => {
  if (!expiresAt) return null;
  const seconds = Math.floor((new Date(expiresAt).getTime() - now) / 1000);
  if (Number.isNaN(seconds)) return null;
  if (seconds <= 0) return 'expirée';
  const minutes = Math.floor(seconds / 60);
  return minutes >= 1 ? `expire dans ${minutes} min` : `expire dans ${seconds} s`;
};

// Paiement Lightning d'une demande acceptee : QR du BOLT11, copie, suivi automatique du statut, et (developpement
// seulement, si le serveur l'indique) bouton pour simuler le paiement.
export const PaymentPanel = ({ requestId, status, amountSats, onSettled }: Props) => {
  const colorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const colors = Colors[colorScheme];

  const [invoice, setInvoice] = useState<RequestInvoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [resuming, setResuming] = useState(status === 'awaiting_payment');
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [simulation, setSimulation] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Moyen choisi dans « Payer avec » dont la facture est en cours de creation.
  const [creatingWith, setCreatingWith] = useState<PaymentProviderId | null>(null);

  // Le serveur dit s'il faut proposer la simulation (jamais vrai en production).
  useEffect(() => {
    let cancelled = false;
    getPaymentConfig()
      .then((config) => {
        if (!cancelled) setSimulation(config.paymentSimulation);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Facture deja creee (on est revenu sur l'ecran) : le BOLT11 n'est relisible que par cette route.
  useEffect(() => {
    if (status !== 'awaiting_payment') return;
    let cancelled = false;
    getOpenInvoice(requestId)
      .then((open) => {
        if (cancelled) return;
        setInvoice(open);
        setClosed(open === null);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Impossible de charger la facture.');
      })
      .finally(() => {
        if (!cancelled) setResuming(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requestId, status]);

  // Compte a rebours de l'expiration.
  useEffect(() => {
    if (!invoice?.expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [invoice?.expiresAt]);

  useInvoicePolling({
    requestId,
    active: invoice !== null && !closed,
    onSettled: () => {
      Toast.show({ type: 'success', text1: 'Paiement reçu', text2: 'Votre certificat est en cours de génération.' });
      onSettled();
    },
    onClosed: () => setClosed(true),
  });

  const createInvoice = useCallback(async () => {
    setBusy(true);
    setCreatingWith('lightning');
    setError(null);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setInvoice(await createLightningInvoice(requestId));
      setClosed(false);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Impossible de créer la facture.');
    } finally {
      setBusy(false);
      setCreatingWith(null);
    }
  }, [requestId]);

  // Seul Lightning est branche : les autres moyens sont inactifs dans la liste et n'arrivent pas jusqu'ici.
  const selectProvider = (provider: PaymentProviderId) => {
    if (provider === 'lightning') void createInvoice();
  };

  const copyInvoice = async () => {
    if (!invoice) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await Clipboard.setStringAsync(invoice.paymentRequest);
    Toast.show({ type: 'success', text1: 'Facture copiée', visibilityTime: 2000 });
  };

  const simulate = async () => {
    setBusy(true);
    setError(null);
    try {
      await simulatePayment(requestId);
      onSettled();
    } catch (simulateError) {
      setError(simulateError instanceof Error ? simulateError.message : 'Simulation impossible.');
    } finally {
      setBusy(false);
    }
  };

  const remaining = invoice ? formatRemaining(invoice.expiresAt, now) : null;
  const expired = closed || remaining === 'expirée';
  const price = amountSats != null ? `${amountSats.toLocaleString('fr-FR')} sats` : '';

  return (
    <Card style={[styles.card, { borderColor: colors['brand.primary'] }]}>
      {!resuming && invoice && !expired && (
        <Text style={[styles.title, { color: colors['text.primary'] }]}>Paiement Lightning</Text>
      )}

      {resuming ? (
        <ActivityIndicator color={colors['brand.primary']} style={styles.block} />
      ) : !invoice || expired ? (
        <>
          <Text style={[styles.text, styles.intro, { color: colors['text.secondary'] }]}>
            {expired
              ? 'La facture a expiré. Choisissez un moyen de paiement pour en générer une nouvelle.'
              : 'Votre demande est acceptée. Choisissez comment régler pour recevoir votre certificat.'}
          </Text>
          <PaymentMethodPicker priceLabel={price} busyId={creatingWith} onSelect={selectProvider} />
        </>
      ) : (
        <>
          <Text style={[styles.text, { color: colors['text.secondary'] }]}>
            Scannez avec un portefeuille Lightning ou copiez la facture.
          </Text>
          <View style={[styles.qr, { backgroundColor: '#FFFFFF' }]}>
            <QRCode value={invoice.paymentRequest} size={220} backgroundColor="#FFFFFF" color="#000000" />
          </View>
          <Text style={[styles.amount, { color: colors['text.primary'] }]}>
            {invoice.amountSats.toLocaleString('fr-FR')} sats{remaining ? ` · ${remaining}` : ''}
          </Text>
          <Text style={[styles.bolt, { color: colors['text.muted'] }]} numberOfLines={2} selectable>
            {invoice.paymentRequest}
          </Text>
          <Button title="Copier la facture" onPress={copyInvoice} variant="secondary" style={styles.button} />
          <View style={styles.waiting}>
            <ActivityIndicator size="small" color={colors['brand.primary']} />
            <Text style={[styles.waitingText, { color: colors['text.muted'] }]}>En attente du paiement…</Text>
          </View>
        </>
      )}

      {simulation && invoice && !expired && (
        <Button
          title="Simuler le paiement (développement)"
          onPress={simulate}
          variant="secondary"
          loading={busy}
          style={styles.button}
        />
      )}

      {error && <Text style={[styles.error, { color: colors['state.error.fg'] }]}>{error}</Text>}
    </Card>
  );
};

const styles = StyleSheet.create({
  card: { marginHorizontal: 24, marginBottom: 16, padding: 16, borderWidth: 1, borderRadius: 12 },
  title: { fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  text: { fontSize: 14, lineHeight: 20 },
  intro: { marginBottom: 16 },
  block: { marginVertical: 16 },
  button: { marginTop: 12 },
  qr: { alignSelf: 'center', padding: 12, borderRadius: 12, marginTop: 16 },
  amount: { textAlign: 'center', fontSize: 16, fontWeight: '600', marginTop: 12 },
  bolt: { fontSize: 11, textAlign: 'center', marginTop: 8 },
  waiting: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 16, gap: 8 },
  waitingText: { fontSize: 13 },
  error: { fontSize: 13, marginTop: 12, textAlign: 'center' },
});
