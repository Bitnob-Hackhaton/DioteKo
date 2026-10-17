import type { ImageSourcePropType } from 'react-native';

// Moyens de paiement proposes sur l'ecran « Payer avec ». Seul le reseau Lightning est branche (Bitnob) : les autres
// sont affiches mais inactifs. Passer `available` a true ne suffit pas, il faut aussi un backend pour le moyen en question.
export type PaymentProviderId = 'lightning' | 'bitcoin-core' | 'wave' | 'orange-money' | 'yas' | 'pi-spi';

export interface PaymentProvider {
  id: PaymentProviderId;
  name: string;
  // Une ligne sous le nom : ce que le citoyen doit savoir avant de choisir.
  description: string;
  logo: ImageSourcePropType;
  available: boolean;
  // Cadrage du logo dans sa pastille : `cover` rogne l'image carree, `lightning` recadre le visuel portrait sur son disque.
  logoFit?: 'cover' | 'lightning';
}

export const PAYMENT_PROVIDERS: PaymentProvider[] = [
  {
    id: 'lightning',
    name: 'Bitcoin Lightning',
    description: 'Paiement instantané en sats',
    logo: require('@/assets/providers/lightning.jpg'),
    logoFit: 'lightning',
    available: true,
  },
  {
    id: 'bitcoin-core',
    name: 'Bitcoin (réseau principal)',
    description: 'Transaction on-chain',
    logo: require('@/assets/providers/bitcoin.png'),
    available: false,
  },
  {
    id: 'wave',
    name: 'Wave',
    description: 'Mobile money',
    logo: require('@/assets/providers/wave.png'),
    available: false,
  },
  {
    id: 'orange-money',
    name: 'Orange Money',
    description: 'Mobile money',
    logo: require('@/assets/providers/orange-money.png'),
    available: false,
  },
  {
    id: 'yas',
    name: 'YAS',
    description: 'Mobile money',
    logo: require('@/assets/providers/yas.jpg'),
    available: false,
  },
  {
    id: 'pi-spi',
    name: 'PI-SPI',
    description: 'Paiement instantané interbancaire',
    logo: require('@/assets/providers/pi-spi.png'),
    available: false,
  },
];
