/** "en_gb" / "EN-GB" -> "en-GB". */
export function normalizeLocale(tag: string): string {
  const [lang, region, ...rest] = tag.replace(/_/g, '-').split('-');
  if (!lang) return 'en-US';
  return [lang.toLowerCase(), ...(region ? [region.length === 2 ? region.toUpperCase() : region] : []), ...rest].join('-');
}

/** The phone's language for speech, falling back to US English. */
export function deviceSpeechLocale(resolved: string | undefined = safeResolvedLocale()): string {
  if (!resolved || resolved === 'und') return 'en-US';
  const n = normalizeLocale(resolved);
  // Speech services want language-REGION; a bare language gets its usual region.
  if (!n.includes('-')) return n === 'en' ? 'en-US' : `${n}-${n.toUpperCase()}`;
  return n;
}

function safeResolvedLocale(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return undefined;
  }
}

/** Whether `locale` is among the installed offline locales (exact match, ignoring case and separators). */
export function hasOfflineLocale(locale: string, installed: string[]): boolean {
  const want = normalizeLocale(locale);
  return installed.some((l) => normalizeLocale(l) === want);
}
