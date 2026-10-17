import cn  from 'clsx';
import * as LabelPrimitive from '@rn-primitives/label';
import { Platform } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
 
function Label({
  className,
  onPress,
  onLongPress,
  onPressIn,
  onPressOut,
  disabled,
  style,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Text>) {
  // `text-foreground` n'est pas defini dans global.css : sans couleur explicite le libelle est noir (illisible en sombre sur iOS).
  const colors = useColorScheme() === 'dark' ? Colors.dark : Colors.light;
  return (
    <LabelPrimitive.Root
      className={cn(
        'flex select-none flex-row items-center gap-2',
        Platform.select({
          web: 'cursor-default leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50 group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50',
        }),
        disabled && 'opacity-50'
      )}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}>
      <LabelPrimitive.Text
        className={cn(
          'text-foreground text-sm font-medium',
          Platform.select({ web: 'leading-none' }),
          className
        )}
        style={[{ color: colors.text, fontSize: 14, lineHeight: 20 }, style]}
        {...props}
      />
    </LabelPrimitive.Root>
  );
}
 
export { Label };