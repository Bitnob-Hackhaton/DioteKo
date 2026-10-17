
  // Define static palettes for light and dark
  const paletteLight = {
    globalBackground: '#0B0F12', // HSL 210, 27%, 6%
    surface1: '#F8F9FA', // HSL 210, 28%, 9%
    surface2: '#DDE1E5', // HSL 208, 26%, 12%
    surface3: '#E6E9EC', // HSL 210, 22%, 16%
    primary: '#19C37D', // HSL 152, 76%, 44%
    primaryDark: '#11A968', // HSL 152, 81%, 37%
    primaryLight: '#CFF7E6', // HSL 152, 73%, 90%
    secondary: '#3BA3F7', // HSL 207, 91%, 61%
    accent: '#F5A524', // HSL 38, 91%, 55%
    success: '#22C55E', // HSL 142, 64%, 47%
    warning: '#F59E0B', // HSL 38, 92%, 50%
    error: '#EF4444', // HSL 0, 83%, 61%
    info: '#60A5FA', // HSL 215, 89%, 70%
    danger: '#DC2626', // HSL 0, 78%, 51%
    onBg1: '#11181C',
    onBg2: '#19C37D',
    onSurface: '#212121',
  };

  const paletteDark = {
    globalBackground: '#0B0F12', // HSL 210, 27%, 6%
    surface1: '#12171B', // HSL 210, 28%, 9%
    surface2: '#171D22', // HSL 208, 26%, 12%
    surface3: '#1E252B', // HSL 210, 22%, 16%
    primary: '#19C37D', // HSL 152, 76%, 44%
    primaryDark: '#11A968', // HSL 152, 81%, 37%
    primaryLight: '#CFF7E6', // HSL 152, 73%, 90%
    secondary: '#3BA3F7', // HSL 207, 91%, 61%
    accent: '#F5A524', // HSL 38, 91%, 55%
    success: '#22C55E', // HSL 142, 64%, 47%
    warning: '#F59E0B', // HSL 38, 92%, 50%
    error: '#EF4444', // HSL 0, 83%, 61%
    info: '#60A5FA', // HSL 215, 89%, 70%
    danger: '#DC2626', // HSL 0, 78%, 51%
    onBg1: '#E6E9EC',
    onBg2: '#19C37D',
    onSurface: '#DDE1E5',
  };

  // Define tokens for each theme
  const tokensLight = {
    // Fond de page clair (comme `Colors.light.background`). Il reprenait par erreur le fond sombre de la palette.
    'bg.default': '#FFFFFF',
    'bg.muted': '#0E1317',
    'surface.default': paletteLight.surface1,
    'surface.raised': paletteLight.surface3,
    'surface.overlay': 'rgba(0,0,0,0.44)',
    'text.primary': paletteLight.onBg1,
    'text.secondary': paletteLight.onBg2,
    'text.muted': '#97A0A9',
    'text.inverse': paletteLight.globalBackground,
    'brand.primary': paletteLight.primary,
    'brand.primary.strong': paletteLight.primaryDark,
    'brand.primary.on': '#062016',
    'brand.secondary': paletteLight.secondary,
    'state.success.fg': paletteLight.success,
    'state.warning.fg': paletteLight.warning,
    'state.accent.fg': paletteLight.accent,
    'state.error.fg': paletteLight.error,
    'state.danger.fg': paletteLight.danger,
  };

  const tokensDark = {
    'bg.default': paletteDark.globalBackground,
    'bg.muted': '#0E1317',
    'surface.default': paletteDark.surface1,
    'surface.raised': paletteDark.surface3,
    'surface.overlay': 'rgba(0,0,0,0.44)',
    'text.primary': paletteDark.onBg1,
    'text.secondary': paletteDark.onBg2,
    'text.muted': '#97A0A9',
    'text.inverse': paletteDark.globalBackground,
    'brand.primary': paletteDark.primary,
    'brand.primary.strong': paletteDark.primaryDark,
    'brand.primary.on': '#062016',
    'brand.secondary': paletteDark.secondary,
    'state.success.fg': paletteDark.success,
    'state.warning.fg': paletteDark.warning,
    'state.accent.fg': paletteDark.accent,
    'state.error.fg': paletteDark.error,
    'state.danger.fg': paletteDark.danger,
  };


export const Colors = {
  light: {
    background: '#fff',
    tint: tokensLight['brand.primary'],
    tabIconSelected: tokensLight['brand.primary'],
    text: '#11181C',
    icon: '#687076',
    tabIconDefault: '#687076',
    grayDark: '#212121',
    grayMedium: '#666666',
    grayLight: '#E0E0E0',
    grayBackground: '#EFEFEF',
    grayWhite: '#FFFFFF',
    cardbg: '#E0E0E0',
    // Ecrans d'auth : fond de page, carte, champs (contraste net entre les trois niveaux).
    authBg: '#F2F4F7',
    authCard: '#FFFFFF',
    authCardBorder: '#E3E8EE',
    fieldBg: '#F8FAFC',
    fieldBorder: '#CBD3DC',
    ...tokensLight,
  },
  dark: {
    background: '#0B0F12',
    tint: tokensDark['brand.primary'],
    tabIconSelected: tokensDark['brand.primary'],
    text: '#ECEDEE',
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    grayDark: '#212121',
    grayMedium: '#666666',
    grayLight: '#E0E0E0',
    grayBackground: '#EFEFEF',
    grayWhite: '#FFFFFF',
    cardbg: '#0E1317',
    authBg: '#0B0F12',
    authCard: '#151B21',
    authCardBorder: '#232C34',
    fieldBg: '#0E1317',
    fieldBorder: '#2E3943',
    ...tokensDark,
  },
};
