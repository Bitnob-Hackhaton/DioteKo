import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

interface Props {
  variant: 'document' | 'face';
  // Couleur d'accent quand le telephone est stable ; blanc sinon.
  accent: string;
  steady: boolean;
}

const IDLE = 'rgba(255,255,255,0.9)';
const CORNER = 28;

// Cadre de guidage anime : ligne lumineuse qui balaie de haut en bas (comme le scan d'une piece sur les applis
// d'echange), coins ou ovale qui passent a la couleur d'accent quand le telephone ne bouge plus.
export const ScanOverlay = ({ variant, accent, steady }: Props) => {
  const [height, setHeight] = useState(0);
  const sweep = useSharedValue(0);
  const color = steady ? accent : IDLE;
  // Halo sous la ligne : l'accent est un code hexadecimal (on y ajoute l'opacite), le blanc est deja en rgba.
  const glow = color.startsWith('#') ? `${color}66` : 'rgba(255,255,255,0.3)';

  useEffect(() => {
    sweep.value = withRepeat(withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [sweep]);

  const lineStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sweep.value * Math.max(height - 4, 0) }] }));

  const sweepLayer = (
    <Animated.View pointerEvents="none" style={[styles.line, lineStyle]}>
      <LinearGradient colors={['transparent', color, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.bar} />
      <LinearGradient colors={[glow, 'transparent']} style={styles.glow} />
    </Animated.View>
  );

  if (variant === 'face') {
    return (
      <View pointerEvents="none" style={[styles.oval, { borderColor: color }]} onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
        {sweepLayer}
      </View>
    );
  }

  return (
    <View pointerEvents="none" style={styles.document} onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
      <View style={[styles.corner, styles.topLeft, { borderColor: color }]} />
      <View style={[styles.corner, styles.topRight, { borderColor: color }]} />
      <View style={[styles.corner, styles.bottomLeft, { borderColor: color }]} />
      <View style={[styles.corner, styles.bottomRight, { borderColor: color }]} />
      <View style={styles.clip}>{sweepLayer}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  document: { width: '88%', aspectRatio: 1.586 },
  clip: { ...StyleSheet.absoluteFill, overflow: 'hidden', borderRadius: 14 },
  oval: { width: '62%', aspectRatio: 0.78, borderWidth: 4, borderRadius: 999, overflow: 'hidden' },
  line: { position: 'absolute', top: 0, left: 0, right: 0 },
  bar: { height: 4, width: '100%' },
  glow: { height: 40, width: '100%' },
  corner: { position: 'absolute', width: CORNER, height: CORNER },
  topLeft: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 12 },
  topRight: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 12 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 12 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 12 },
});
