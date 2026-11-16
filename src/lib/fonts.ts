export type FontKey = 'frank' | 'david' | 'heebo' | 'assistant' | 'noto' | 'system';

interface FontDef {
  label: string;
  family: string;
  google?: string;
}

export const FONTS: Record<FontKey, FontDef> = {
  frank: { label: 'Frank Ruhl Libre', family: '"Frank Ruhl Libre", David, serif', google: 'Frank+Ruhl+Libre:wght@400;700' },
  david: { label: 'David Libre', family: '"David Libre", David, serif', google: 'David+Libre:wght@400;700' },
  heebo: { label: 'Heebo', family: 'Heebo, "Segoe UI", Arial, sans-serif', google: 'Heebo:wght@400;700' },
  assistant: { label: 'Assistant', family: 'Assistant, "Segoe UI", Arial, sans-serif', google: 'Assistant:wght@400;700' },
  noto: { label: 'Noto Sans Hebrew', family: '"Noto Sans Hebrew", "Segoe UI", Arial, sans-serif', google: 'Noto+Sans+Hebrew:wght@400;700' },
  system: { label: 'גופן המערכת', family: 'system-ui, -apple-system, "Segoe UI", Arial, sans-serif' },
};

const loaded = new Set<FontKey>();

/** Load only the selected Google font, on demand. */
export function ensureFont(key: FontKey): void {
  const def = FONTS[key];
  if (!def.google || loaded.has(key)) return;
  loaded.add(key);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${def.google}&display=swap`;
  document.head.appendChild(link);
}
