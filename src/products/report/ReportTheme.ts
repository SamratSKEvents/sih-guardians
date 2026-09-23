/**
 * Visual system. CAD-like, monochrome first; accents only where they carry meaning.
 * Everything must survive greyscale printing: series are separated by dash pattern / marker,
 * never by colour alone.
 */

export const FONT_FILES = {
  sans: 'plex-sans/fonts/complete/woff/IBMPlexSans-Regular.woff',
  sansItalic: 'plex-sans/fonts/complete/woff/IBMPlexSans-Italic.woff',
  sansMedium: 'plex-sans/fonts/complete/woff/IBMPlexSans-Medium.woff',
  sansSemi: 'plex-sans/fonts/complete/woff/IBMPlexSans-SemiBold.woff',
  sansBold: 'plex-sans/fonts/complete/woff/IBMPlexSans-Bold.woff',
  cond: 'plex-sans-condensed/fonts/complete/woff/IBMPlexSansCondensed-Regular.woff',
  condMedium: 'plex-sans-condensed/fonts/complete/woff/IBMPlexSansCondensed-Medium.woff',
  condSemi: 'plex-sans-condensed/fonts/complete/woff/IBMPlexSansCondensed-SemiBold.woff',
  condBold: 'plex-sans-condensed/fonts/complete/woff/IBMPlexSansCondensed-Bold.woff',
  mono: 'plex-mono/fonts/complete/woff/IBMPlexMono-Regular.woff',
  monoMedium: 'plex-mono/fonts/complete/woff/IBMPlexMono-Medium.woff',
} as const;

export type FontKey = keyof typeof FONT_FILES;
export type FontBytes = Record<FontKey, Uint8Array | ArrayBuffer>;

export const C = {
  ink: '#111111',
  ink2: '#333333',
  ink3: '#5c5c5c',
  rule: '#7a7a7a',
  grid: '#bdbdbd',
  faint: '#dcdcdc',
  tint: '#efefef',
  tint2: '#f7f7f7',
  paper: '#ffffff',
  /** Modelled / predicted geometry. */
  model: '#1f4e8c',
  /** Critical status only. */
  critical: '#a3231b',
  /** Observed water body in maps (very light). */
  water: '#ffffff',
} as const;

/** Line weights in pt. */
export const LW = {
  frame: 1.1,
  heavy: 0.9,
  medium: 0.6,
  fine: 0.35,
  hair: 0.2,
} as const;

/** Dash patterns [dash, gap]. */
export const DASH = {
  solid: null,
  dashed: [4, 2.2] as [number, number],
  dotted: [0.8, 1.6] as [number, number],
  dashDot: [5, 1.6, 0.8, 1.6] as number[],
  construction: [6, 2, 1, 2] as number[],
  short: [2, 1.5] as [number, number],
};

/** Type scale (pt). Minimum used anywhere: 5.8 pt (frame zone labels only). */
export const T = {
  display: 22,
  h1: 13,
  h2: 8.6,
  body: 8.4,
  small: 7.4,
  table: 7.2,
  label: 6.6,
  micro: 6,
  zone: 5.8,
} as const;

export const PAGE = {
  a4: { w: 595.28, h: 841.89 },
  trim: 12,
  frame: 24,
  headerH: 20,
  footerH: 36,
  pad: 16,
  plateColumnW: 168,
} as const;
