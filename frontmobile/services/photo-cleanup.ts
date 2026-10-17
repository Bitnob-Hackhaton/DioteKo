import { File } from 'expo-file-system';

// La camera ecrit chaque photo dans le cache de l'application. Les photos de piece d'identite et de selfie ne doivent
// pas y rester : on les supprime des qu'elles ne servent plus (envoyees, reprises, ecran quitte). Best effort : un echec
// ne doit jamais bloquer le parcours, le systeme purge le cache de toute facon.
export const discardPhoto = (uri: string | null | undefined): void => {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch (error) {
    if (__DEV__) console.warn('[kyc] photo cleanup failed:', error);
  }
};
