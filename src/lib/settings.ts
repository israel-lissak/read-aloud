import { useCallback, useEffect, useState } from 'react';
import { FONTS, type FontKey } from './fonts';

export type Theme = 'light' | 'sepia' | 'dark';

export interface Settings {
  font: FontKey;
  size: number;
  lineHeight: number;
  theme: Theme;
  rate: number;
  /** Chosen voiceURI per primary language ("he", "en", …). */
  voices: Record<string, string>;
}

const KEY = 'read-aloud:settings';

export const RATE_MIN = 0.75;
export const RATE_MAX = 2;
export const SIZE_MIN = 15;
export const SIZE_MAX = 30;
export const LH_MIN = 1.4;
export const LH_MAX = 2.2;

function defaults(): Settings {
  const dark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  return { font: 'frank', size: 20, lineHeight: 1.8, theme: dark ? 'dark' : 'light', rate: 1, voices: {} };
}

const clamp = (n: unknown, min: number, max: number, fallback: number) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;

function load(): Settings {
  const d = defaults();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return {
      font: raw.font && raw.font in FONTS ? raw.font : d.font,
      size: clamp(raw.size, SIZE_MIN, SIZE_MAX, d.size),
      lineHeight: clamp(raw.lineHeight, LH_MIN, LH_MAX, d.lineHeight),
      theme: raw.theme === 'light' || raw.theme === 'sepia' || raw.theme === 'dark' ? raw.theme : d.theme,
      rate: clamp(raw.rate, RATE_MIN, RATE_MAX, d.rate),
      voices: raw.voices && typeof raw.voices === 'object' ? raw.voices : {},
    };
  } catch {
    return d;
  }
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable (private mode etc.) */
    }
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  return [settings, update];
}
