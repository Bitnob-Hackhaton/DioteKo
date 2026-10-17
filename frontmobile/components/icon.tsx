import React, { memo } from "react";
import { Image as ExpoImage, ImageSource } from "expo-image";

interface IconProps {
  image: ImageSource;
  style?: string;
  color?: string;
  noTint?: boolean;
}

const Icon = memo<IconProps>(({
  image,
  style = "",
  color,
  noTint,
}) => {
  const tintColor = noTint ? undefined : (color || "#f26b17");
  
  return (
    <ExpoImage
      source={image}
      className={`w-6 h-6 ${style}`}
      contentFit="contain"
      tintColor={tintColor}
      cachePolicy="memory-disk"
      transition={0}
      recyclingKey={typeof image === 'number' ? String(image) : undefined}
    />
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.image === nextProps.image &&
    prevProps.style === nextProps.style &&
    prevProps.color === nextProps.color &&
    prevProps.noTint === nextProps.noTint
  );
});

Icon.displayName = "Icon";

export default Icon;
