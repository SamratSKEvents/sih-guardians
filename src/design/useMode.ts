/**
 * The application's light/dark mode.
 *
 * A mode is a property of the APPLICATION, not of a surface or a route. The
 * same screen has to be readable in an operations room at night and on a
 * projector at noon, and which of those you are in is not something a route
 * can know. Put the returned class on the element that owns the ground.
 *
 * Light by default rather than following the system: this gets demonstrated on
 * other people's machines, and a deterministic first paint is worth more here
 * than guessing at a preference. Once someone chooses, the choice persists.
 *
 * Storage throws in a private window or with site data blocked, so every
 * access is guarded and the app renders correctly when it fails.
 */

import { useEffect, useState } from 'react';

export type Mode = 'light' | 'dark';

const STORAGE_KEY = 'guardians.mode';

export function useMode() {
  const [mode, setMode] = useState<Mode>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch {
      /* no storage: the default below is still correct */
    }
    return 'light';
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* the app works without remembering */
    }
  }, [mode]);

  return [mode, setMode] as const;
}
