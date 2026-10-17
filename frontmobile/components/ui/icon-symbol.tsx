import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolViewProps } from 'expo-symbols';
import { ComponentProps } from 'react';
import { StyleProp, TextStyle } from 'react-native';

// Simplification du mapping pour éviter les erreurs de type complexes
const MAPPING: Record<string, ComponentProps<typeof MaterialIcons>['name']> = {
  'house.fill': 'home',
  'paperplane.fill': 'send',
  'chevron.left.forwardslash.chevron.right': 'code',
  'chevron.right': 'chevron-right',
  'bell.fill': 'notifications',
  'bell': 'notifications',
  'person.fill': 'person',
  'person.crop.circle': 'account-circle',
  'shield.fill': 'security',
  'square.and.pencil': 'edit',
  'rectangle.portrait.and.arrow.right': 'logout',
  'questionmark.circle.fill': 'help-outline',
  'faceid': 'face-retouching-natural',
  'speaker.wave.2.fill': 'volume-up',
  'iphone.radiowaves.left.and.right': 'vibration',
  'moon.fill': 'dark-mode',
  'arrow.clockwise': 'refresh',
  'gear': 'settings',
  'doc.text.fill': 'description',
  'creditcard.fill': 'credit-card',
  'qrcode': 'qr-code-scanner',
  'checkmark.seal.fill': 'verified',
  'logout.fill': 'logout',
  'logout': 'logout',
  'arrow.right': 'chevron-right',
  'checkmark.circle.fill': 'check-circle',
  'xmark.circle.fill': 'cancel',
  'info.circle.fill': 'info',
  'xmark': 'close',
  'chevron.left': 'chevron-left',
  'clock.fill': 'schedule',
  'lock.fill': 'lock',
  'checkmark': 'check',
  'person.text.rectangle': 'badge',
  'book.closed.fill': 'menu-book',
  'camera.rotate.fill': 'flip-camera-ios',
};

export function IconSymbol({ 
  name, 
  size = 24, 
  color = '#000',
  style
}: { 
  name: string; 
  size?: number; 
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  const materialName = MAPPING[name] || 'help';
  return <MaterialIcons name={materialName} size={size} color={color} style={style} />;
}
