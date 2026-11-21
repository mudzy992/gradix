export const palette = {
  primary: '#1B365D',
  background: '#F4F1EA',
  text: '#1A1A1A',
  accent: '#C45C26',
  success: '#2F6F4E',
  danger: '#B42318',
  card: '#FFFFFF',
  muted: '#5C5852',
  border: '#D9D3C6',
} as const;

export const darkPalette = {
  primary: '#8BA4C7',
  background: '#12151A',
  text: '#F4F1EA',
  accent: '#E07A45',
  success: '#5B9A76',
  danger: '#E05A52',
  card: '#1C2128',
  muted: '#A8A29A',
  border: '#2E3540',
} as const;

export type ThemePalette = typeof palette;

export const minTap = 48;
export const bodySize = 16;
