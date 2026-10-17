import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { discardPhoto } from '@/services/photo-cleanup';

// Une photo pleine resolution (12 Mpx, 2 a 3 Mo) mettait ~48 s a etre analysee par le serveur de verification
// (plusieurs passes de lecture + detection de falsification), au-dela de son delai. Reduite a 1800 px sur le grand
// cote, elle reste largement lisible (le test de reference a echoue en dessous de ~1000 px) et part bien plus vite.
export const MAX_PHOTO_SIDE = 1800;
const JPEG_QUALITY = 0.8;

// Petite copie (900 px) pour le controle prealable : quelques dizaines de Ko, lue en 1 a 3 s par le moteur.
const PROBE_SIDE = 900;
export const makeProbe = async (uri: string): Promise<string> => {
  try {
    const rendered = await ImageManipulator.manipulate(uri).resize({ width: PROBE_SIDE }).renderAsync();
    const saved = await rendered.saveAsync({ compress: 0.6, format: SaveFormat.JPEG });
    return saved.uri;
  } catch {
    return uri;
  }
};

// Retourne l'URI de la photo a envoyer. En cas d'echec de la reduction on envoie l'original : mieux vaut une photo
// lourde qu'aucune photo. L'original reduit est supprime du cache.
export const preparePhoto = async (uri: string, width?: number, height?: number): Promise<string> => {
  const longEdge = Math.max(width ?? 0, height ?? 0);
  if (longEdge > 0 && longEdge <= MAX_PHOTO_SIDE) return uri;
  try {
    const landscape = (width ?? 0) >= (height ?? 0);
    const rendered = await ImageManipulator.manipulate(uri)
      .resize(landscape ? { width: MAX_PHOTO_SIDE } : { height: MAX_PHOTO_SIDE })
      .renderAsync();
    const saved = await rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
    if (saved.uri !== uri) discardPhoto(uri);
    return saved.uri;
  } catch (error) {
    if (__DEV__) console.warn('[kyc] photo resize failed, sending the original:', error);
    return uri;
  }
};
