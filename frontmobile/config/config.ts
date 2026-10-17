import Constants from 'expo-constants';
import { Platform } from 'react-native';

const API_PORT = process.env.EXPO_PUBLIC_API_PORT || '3001';

const isPrivateIpv4 = (host: string): boolean => {
  const privateIpv4Regex = /^(10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.(?:\d{1,3})\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.(?:\d{1,3})\.\d{1,3})$/;
  return privateIpv4Regex.test(host);
};

const parseHostFromUri = (uri?: string | null): string | null => {
  if (!uri) {
    return null;
  }

  const normalized = uri.replace(/^[a-zA-Z]+:\/\//, '');
  const hostPort = normalized.split('/')[0] ?? '';
  const host = hostPort.split(':')[0] ?? '';

  if (!host || host === 'localhost' || host === '127.0.0.1') {
    return null;
  }

  return host;
};

const getExpoNetworkHost = (): string | null => {
  const manifestLike = Constants as unknown as {
    expoConfig?: {
      hostUri?: string;
    };
    manifest?: {
      debuggerHost?: string;
    };
    manifest2?: {
      extra?: {
        expoGo?: {
          debuggerHost?: string;
        };
        expoClient?: {
          hostUri?: string;
        };
      };
    };
    linkingUri?: string;
  };

  const candidateUris = [
    manifestLike.expoConfig?.hostUri,
    manifestLike.manifest2?.extra?.expoGo?.debuggerHost,
    manifestLike.manifest2?.extra?.expoClient?.hostUri,
    manifestLike.manifest?.debuggerHost,
    manifestLike.linkingUri,
  ];

  for (const uri of candidateUris) {
    const host = parseHostFromUri(uri);
    if (host && isPrivateIpv4(host)) {
      return host;
    }
  }

  return null;
};

type ApiBaseUrlSource = 'env' | 'expo-host' | 'fallback-localhost';

// L'IP du backend = l'hote Metro (le PC qui sert le bundle sert aussi le backend) : elle suit
// donc tout changement de Wi-Fi sans toucher a .env. (expo-network donnerait l'IP du telephone.)
const resolveApiBaseUrl = (): { url: string; source: ApiBaseUrlSource } => {
  if (process.env.EXPO_PUBLIC_API_BASE_URL) {
    return { url: process.env.EXPO_PUBLIC_API_BASE_URL, source: 'env' };
  }

  const expoNetworkHost = getExpoNetworkHost();
  if (expoNetworkHost) {
    return { url: `http://${expoNetworkHost}:${API_PORT}/api`, source: 'expo-host' };
  }

  return { url: `http://localhost:${API_PORT}/api`, source: 'fallback-localhost' };
};

const resolvedApiBaseUrl = resolveApiBaseUrl();

export const API_BASE_URL = resolvedApiBaseUrl.url;

if (__DEV__) {
  const isLocalhost = /\/\/(localhost|127\.0\.0\.1)[:/]/i.test(API_BASE_URL);
  if (Platform.OS !== 'web' && isLocalhost) {
    console.warn(
      `[Config] API_BASE_URL=${API_BASE_URL} (source: ${resolvedApiBaseUrl.source}) : injoignable depuis un telephone physique `
      + '(localhost = le telephone). Retire EXPO_PUBLIC_API_BASE_URL (auto : IP LAN) ou utilise http://<IP-LAN>:3001/api.'
    );
  } else {
    console.log(`[Config] API_BASE_URL=${API_BASE_URL} (source: ${resolvedApiBaseUrl.source})`);
  }
}

export const APPWRITE_ENDPOINT = process.env.EXPO_PUBLIC_APPWRITE_ENDPOINT || '';
export const APPWRITE_PROJECT_ID = process.env.EXPO_PUBLIC_APPWRITE_PROJECT_ID || '';

export const CERTIFICATE_TYPES = {
  BIRTH: 'birth',
  MARRIAGE: 'marriage',
  DEATH: 'death',
  RESIDENCE: 'residence',
  IDENTITY: 'identity',
};

export const ROUTES = {
  HOME: 'Home',
  CERTIFICATE_FORM: 'CertificateForm',
  PAYMENT: 'Payment',
  QR_SCANNER: 'QRScanner',
  PDF_VIEWER: 'PDFViewer',
  VERIFICATION: 'Verification',
};