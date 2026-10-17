// Journal du parcours KYC, visible dans le terminal de Metro (developpement seulement). Meme esprit que les logs du
// backend : un evenement, des identifiants et des mesures (etape, duree, taille, resultat). Jamais le contenu d'une
// photo, jamais un nom ou un numero lu sur une piece.
type LogValue = string | number | boolean | null | undefined;

const format = (event: string, data: Record<string, LogValue>): string => {
  const details = Object.entries(data)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  return `[kyc] ${event}${details ? ` ${details}` : ''}`;
};

export const kycLog = (event: string, data: Record<string, LogValue> = {}): void => {
  if (__DEV__) console.log(format(event, data));
};

export const kycWarn = (event: string, data: Record<string, LogValue> = {}): void => {
  if (__DEV__) console.warn(format(event, data));
};

// Duree ecoulee depuis `startedAt`, en millisecondes.
export const elapsedMs = (startedAt: number): number => Date.now() - startedAt;
