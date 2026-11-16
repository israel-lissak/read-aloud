import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArticleView } from './components/ArticleView';
import { HistoryList } from './components/HistoryList';
import { PlayerBar } from './components/PlayerBar';
import { SettingsPanel } from './components/SettingsPanel';
import { pickDefaultVoice, useVoices } from './hooks/useVoices';
import { useTTS } from './hooks/useTTS';
import { ensureFont, FONTS } from './lib/fonts';
import { primaryLang } from './lib/lang';
import { buildArticle } from './lib/sentences';
import { useHistory } from './lib/history';
import { useSettings } from './lib/settings';
import type { ApiArticle } from './types';

type LoadState =
  | { kind: 'empty' }
  | { kind: 'loading'; url: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: ApiArticle };

const NO_SENTENCES: string[] = [];

function normalizeInput(raw: string): string {
  const v = raw.trim();
  if (!v) return v;
  return /^[a-z][a-z\d+.-]*:\/\//i.test(v) ? v : `https://${v}`;
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

export default function App() {
  const [settings, update] = useSettings();
  const voices = useVoices();
  const readingHistory = useHistory();
  const [input, setInput] = useState(() => new URLSearchParams(location.search).get('url') ?? '');
  const [state, setState] = useState<LoadState>({ kind: 'empty' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const data = state.kind === 'ready' ? state.data : null;
  const article = useMemo(() => (data ? buildArticle(data) : null), [data]);
  const langKey = primaryLang(data?.lang || navigator.language);

  const voice = useMemo(() => {
    const uri = settings.voices[langKey];
    return voices.find((v) => v.voiceURI === uri) ?? pickDefaultVoice(voices, langKey);
  }, [voices, settings.voices, langKey]);

  const tts = useTTS({
    sentences: article?.sentences ?? NO_SENTENCES,
    voice,
    rate: settings.rate,
    lang: data?.lang ?? '',
  });

  /* ---------- history ---------- */

  const historyRef = useRef(readingHistory);
  historyRef.current = readingHistory;
  const urlRef = useRef('');
  urlRef.current = data?.url ?? '';

  // New article: record the visit and restore the saved position.
  useEffect(() => {
    if (!data || !article || article.sentences.length === 0) return;
    const total = article.sentences.length;
    const prev = historyRef.current.get(data.url);
    if (prev && prev.total === total && prev.position > 0 && prev.position < total - 1) {
      tts.seek(prev.position);
    }
    historyRef.current.visit({ url: data.url, title: data.title, total });
  }, [article]);

  // Remember the reading position (keyed on index only, so an article switch
  // never writes the old article's index under the new URL).
  useEffect(() => {
    if (tts.index >= 0 && urlRef.current) historyRef.current.setPosition(urlRef.current, tts.index);
  }, [tts.index]);

  /* ---------- loading ---------- */

  const load = useCallback(async (raw: string) => {
    const url = normalizeInput(raw);
    if (!url) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState({ kind: 'loading', url });

    const params = new URLSearchParams({ url });
    window.history.replaceState(null, '', `?${params}`);

    try {
      const res = await fetch(`/api/extract?${params}`, { signal: ctrl.signal });
      const body = (await res.json().catch(() => null)) as (ApiArticle & { error?: string }) | null;
      if (!res.ok || !body || body.error) {
        throw new Error(body?.error ?? `השרת החזיר שגיאה (${res.status}). נסו שוב.`);
      }
      setState({ kind: 'ready', data: body });
      window.scrollTo({ top: 0 });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      const message =
        err instanceof TypeError
          ? 'אין חיבור לשרת. ודאו שהשרת רץ (npm run dev) ושיש חיבור לאינטרנט.'
          : err instanceof Error
            ? err.message
            : 'אירעה שגיאה לא צפויה.';
      setState({ kind: 'error', message });
    }
  }, []);

  // Load ?url= on first visit.
  useEffect(() => {
    const initial = new URLSearchParams(location.search).get('url');
    if (initial) void load(initial);
    return () => abortRef.current?.abort();
  }, [load]);

  const openFromHistory = (url: string) => {
    setInput(url);
    void load(url);
  };

  const goHome = () => {
    abortRef.current?.abort();
    tts.stop();
    setState({ kind: 'empty' });
    setInput('');
    window.history.replaceState(null, '', location.pathname);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void load(input);
  };

  /* ---------- appearance ---------- */

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  useEffect(() => ensureFont(settings.font), [settings.font]);

  useEffect(() => {
    document.title = data?.title ? `${data.title} · הקראה` : 'הקראה';
  }, [data?.title]);

  const articleStyle = useMemo(
    () => ({
      fontFamily: FONTS[settings.font].family,
      fontSize: `${settings.size}px`,
      lineHeight: settings.lineHeight,
    }),
    [settings.font, settings.size, settings.lineHeight],
  );

  /* ---------- keyboard ---------- */

  const { toggle, next, prev, speak } = tts;
  const hasArticle = !!article && article.sentences.length > 0;

  useEffect(() => {
    if (!hasArticle) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || settingsOpen) return;
      if (isTypingTarget(e.target)) return;
      if (e.key === ' ' || e.code === 'Space') {
        // Let a focused button handle its own Space activation.
        if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) return;
        e.preventDefault();
        toggle();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasArticle, settingsOpen, toggle, next, prev]);

  /* ---------- render ---------- */

  const host = data ? safeHost(data.url) : '';

  return (
    <div className={`app${hasArticle ? ' has-player' : ''}`}>
      <a className="skip-link" href="#content">
        דילוג לתוכן
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <button type="button" className="icon-btn brand" onClick={goHome} aria-label="דף הבית והיסטוריה" title="דף הבית">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M4 9h3.5L12 5v14l-4.5-4H4z" fill="currentColor" />
              <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
            </svg>
          </button>
          <form className="url-form" onSubmit={onSubmit} role="search">
            <label htmlFor="url" className="visually-hidden">
              כתובת הכתבה
            </label>
            <input
              id="url"
              type="url"
              inputMode="url"
              dir="ltr"
              placeholder="https://… הדביקו קישור לכתבה"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoComplete="url"
              spellCheck={false}
              required
            />
            <button type="submit" className="btn-primary" disabled={state.kind === 'loading'}>
              {state.kind === 'loading' ? 'טוען…' : 'טעינה'}
            </button>
          </form>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setSettingsOpen(true)}
            aria-label="הגדרות"
            aria-haspopup="dialog"
            title="הגדרות"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path
                d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4.5v5M8 14.5v5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
        </div>
      </header>

      <main id="content" className="main" tabIndex={-1}>
        {state.kind === 'empty' && (
          <section className="intro">
            <h1>הקראת כתבות</h1>
            <p>הדביקו קישור לכתבה או לפוסט. הטקסט יוצג בתצוגת קריאה נקייה, ותוכלו להאזין לו בקול.</p>
            <ul>
              <li>לחיצה על משפט מתחילה את ההקראה ממנו.</li>
              <li>
                <kbd>רווח</kbd> להקראה ולהשהיה, <kbd>←</kbd> <kbd>→</kbd> למעבר בין משפטים.
              </li>
              <li>גופן, גודל, צבעים, קול ומהירות — בכפתור ההגדרות.</li>
            </ul>
            {!tts.supported && <p className="notice">הדפדפן הזה לא תומך בהקראה (Web Speech API). אפשר עדיין לקרוא את הטקסט.</p>}
            <HistoryList
              entries={readingHistory.entries}
              onOpen={openFromHistory}
              onRemove={readingHistory.remove}
              onClear={readingHistory.clear}
            />
          </section>
        )}

        {state.kind === 'loading' && (
          <div className="status" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            טוען את העמוד ומחלץ את הטקסט…
          </div>
        )}

        {state.kind === 'error' && (
          <div className="error" role="alert">
            <strong>לא הצלחנו לטעון את העמוד</strong>
            <p>{state.message}</p>
            <button type="button" className="btn-secondary" onClick={() => void load(input)}>
              נסו שוב
            </button>
          </div>
        )}

        {state.kind === 'ready' && article && (
          <>
            <div className="meta">
              {host && (
                <a href={data!.url} target="_blank" rel="noopener noreferrer" dir="ltr">
                  {host}
                </a>
              )}
              <span>{article.sentences.length} משפטים</span>
              {voice && <span>קול: {voice.name}</span>}
            </div>
            {!tts.supported && (
              <p className="notice">הדפדפן הזה לא תומך בהקראה (Web Speech API). אפשר עדיין לקרוא את הטקסט.</p>
            )}
            <ArticleView
              article={article}
              index={tts.index}
              word={tts.word}
              onSentenceClick={speak}
              style={articleStyle}
              lang={data!.lang}
            />
          </>
        )}
      </main>

      {hasArticle && (
        <PlayerBar
          status={tts.status}
          index={tts.index}
          total={article!.sentences.length}
          rate={settings.rate}
          disabled={!tts.supported}
          onToggle={tts.toggle}
          onPrev={tts.prev}
          onNext={tts.next}
          onStop={tts.stop}
          onSeek={tts.seek}
          onRate={(rate) => update({ rate })}
        />
      )}

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        update={update}
        voices={voices}
        langKey={langKey}
        activeVoice={voice}
      />
    </div>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
