/** Browser font loader: Vite resolves each WOFF to a hashed asset URL; bytes are fetched once. */
import type { FontBytes, FontKey } from './ReportTheme';
import sans from '@ibm/plex-sans/fonts/complete/woff/IBMPlexSans-Regular.woff?url';
import sansItalic from '@ibm/plex-sans/fonts/complete/woff/IBMPlexSans-Italic.woff?url';
import sansMedium from '@ibm/plex-sans/fonts/complete/woff/IBMPlexSans-Medium.woff?url';
import sansSemi from '@ibm/plex-sans/fonts/complete/woff/IBMPlexSans-SemiBold.woff?url';
import sansBold from '@ibm/plex-sans/fonts/complete/woff/IBMPlexSans-Bold.woff?url';
import cond from '@ibm/plex-sans-condensed/fonts/complete/woff/IBMPlexSansCondensed-Regular.woff?url';
import condMedium from '@ibm/plex-sans-condensed/fonts/complete/woff/IBMPlexSansCondensed-Medium.woff?url';
import condSemi from '@ibm/plex-sans-condensed/fonts/complete/woff/IBMPlexSansCondensed-SemiBold.woff?url';
import condBold from '@ibm/plex-sans-condensed/fonts/complete/woff/IBMPlexSansCondensed-Bold.woff?url';
import mono from '@ibm/plex-mono/fonts/complete/woff/IBMPlexMono-Regular.woff?url';
import monoMedium from '@ibm/plex-mono/fonts/complete/woff/IBMPlexMono-Medium.woff?url';

const URLS: Record<FontKey, string> = { sans, sansItalic, sansMedium, sansSemi, sansBold, cond, condMedium, condSemi, condBold, mono, monoMedium };

let cache: Promise<FontBytes> | undefined;

export function loadReportFonts(): Promise<FontBytes> {
  cache ??= Promise.all(
    Object.entries(URLS).map(async ([k, url]) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Font fetch failed: ${url}`);
      return [k, new Uint8Array(await res.arrayBuffer())] as const;
    }),
  ).then((entries) => Object.fromEntries(entries) as FontBytes);
  return cache;
}
