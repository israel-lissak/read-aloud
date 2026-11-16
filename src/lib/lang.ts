export function normalizeLang(lang: string | null | undefined): string {
  if (!lang) return '';
  const [primary = '', ...rest] = lang.trim().replace(/_/g, '-').toLowerCase().split('-');
  // Android reports Hebrew with the deprecated "iw" code.
  return [primary === 'iw' ? 'he' : primary, ...rest].join('-');
}

export function primaryLang(lang: string | null | undefined): string {
  return normalizeLang(lang).split('-')[0] ?? '';
}

export function langName(lang: string): string {
  const p = primaryLang(lang);
  if (!p) return '';
  try {
    return new Intl.DisplayNames(['he'], { type: 'language' }).of(p) ?? p;
  } catch {
    return p;
  }
}
