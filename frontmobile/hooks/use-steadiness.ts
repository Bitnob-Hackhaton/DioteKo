import { useEffect, useRef, useState } from 'react';
import { Accelerometer } from 'expo-sensors';

const SAMPLE_MS = 100;
// Ecart (en g) entre deux mesures successives en dessous duquel la main est consideree comme immobile.
const STILL_THRESHOLD = 0.035;

interface Options {
  enabled: boolean;
  // Duree d'immobilite avant de declencher.
  holdMs: number;
  // Delai de grace apres l'activation : le temps de placer la piece dans le cadre.
  armAfterMs: number;
  onSteady: () => void;
}

// Declenchement « quand on ne bouge plus » : detecte l'immobilite du telephone avec l'accelerometre (disponible
// dans Expo Go). Ce n'est PAS une reconnaissance de la carte : seul un build de developpement permettrait d'analyser
// l'image en direct. Sans accelerometre, un minuteur prend le relais pour que la prise reste automatique.
// `progress` va de 0 a 1 (avancement vers le declenchement) et sert a l'anneau / la barre d'attente.
export const useSteadiness = ({ enabled, holdMs, armAfterMs, onSteady }: Options) => {
  const [progress, setProgress] = useState(0);
  const callback = useRef(onSteady);
  useEffect(() => {
    callback.current = onSteady;
  });

  useEffect(() => {
    if (!enabled) return;
    let fired = false;
    let last: { x: number; y: number; z: number } | null = null;
    let stillSince: number | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    const armedAt = Date.now() + armAfterMs;

    const fire = () => {
      if (fired) return;
      fired = true;
      callback.current();
    };

    Accelerometer.setUpdateInterval(SAMPLE_MS);
    const subscription = Accelerometer.addListener(({ x, y, z }) => {
      const now = Date.now();
      const moved = last ? Math.hypot(x - last.x, y - last.y, z - last.z) : Number.POSITIVE_INFINITY;
      last = { x, y, z };
      if (now < armedAt || moved > STILL_THRESHOLD) {
        stillSince = null;
        setProgress(0);
        return;
      }
      stillSince ??= now;
      const value = Math.min(1, (now - stillSince) / holdMs);
      setProgress(value);
      if (value >= 1) fire();
    });

    Accelerometer.isAvailableAsync()
      .then((available) => {
        if (!available) fallbackTimer = setTimeout(fire, armAfterMs + holdMs);
      })
      .catch(() => {
        fallbackTimer = setTimeout(fire, armAfterMs + holdMs);
      });

    return () => {
      subscription.remove();
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };
  }, [enabled, holdMs, armAfterMs]);

  return { progress: enabled ? progress : 0 };
};
