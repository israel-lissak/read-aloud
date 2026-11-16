import { useEffect, useRef } from 'react';
import { FONTS, type FontKey } from '../lib/fonts';
import { langName } from '../lib/lang';
import {
  LH_MAX,
  LH_MIN,
  RATE_MAX,
  RATE_MIN,
  SIZE_MAX,
  SIZE_MIN,
  type Settings,
  type Theme,
} from '../lib/settings';
import { voicesForLang } from '../hooks/useVoices';

interface Props {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  voices: SpeechSynthesisVoice[];
  /** Primary language of the current document ("he", "en", …). */
  langKey: string;
  /** The voice actually in use (chosen or default). */
  activeVoice: SpeechSynthesisVoice | null;
}

const THEMES: { value: Theme; label: string }[] = [
  { value: 'light', label: 'בהיר' },
  { value: 'sepia', label: 'ספיה' },
  { value: 'dark', label: 'כהה' },
];

const voiceLabel = (v: SpeechSynthesisVoice) => `${v.name} (${v.lang})${v.localService ? '' : ' · רשת'}`;

export function SettingsPanel({ open, onClose, settings, update, voices, langKey, activeVoice }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const matching = voicesForLang(voices, langKey);
  const others = voices.filter((v) => !matching.includes(v));
  const chosen = settings.voices[langKey] ?? '';
  const chosenExists = voices.some((v) => v.voiceURI === chosen);

  const setVoice = (uri: string) => {
    const next = { ...settings.voices };
    if (uri) next[langKey] = uri;
    else delete next[langKey];
    update({ voices: next });
  };

  return (
    <dialog
      ref={ref}
      className="settings"
      aria-labelledby="settings-title"
      onClose={onClose}
      onClick={(e) => {
        // Click on the backdrop closes the dialog.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="settings-body">
        <header className="settings-head">
          <h2 id="settings-title">הגדרות</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="סגירה">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <fieldset className="group">
          <legend>תצוגה</legend>

          <label className="field">
            <span>גופן</span>
            <select value={settings.font} onChange={(e) => update({ font: e.target.value as FontKey })}>
              {(Object.keys(FONTS) as FontKey[]).map((k) => (
                <option key={k} value={k}>
                  {FONTS[k].label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>
              גודל טקסט <output>{settings.size}px</output>
            </span>
            <input
              type="range"
              min={SIZE_MIN}
              max={SIZE_MAX}
              step={1}
              value={settings.size}
              onChange={(e) => update({ size: Number(e.target.value) })}
            />
          </label>

          <label className="field">
            <span>
              ריווח שורות <output>{settings.lineHeight.toFixed(1)}</output>
            </span>
            <input
              type="range"
              min={LH_MIN}
              max={LH_MAX}
              step={0.1}
              value={settings.lineHeight}
              onChange={(e) => update({ lineHeight: Number(e.target.value) })}
            />
          </label>

          <div className="field" role="radiogroup" aria-label="ערכת צבעים">
            <span>ערכת צבעים</span>
            <div className="segmented">
              {THEMES.map((t) => (
                <label key={t.value} className={`swatch swatch-${t.value}`}>
                  <input
                    type="radio"
                    name="theme"
                    value={t.value}
                    checked={settings.theme === t.value}
                    onChange={() => update({ theme: t.value })}
                  />
                  <span>{t.label}</span>
                </label>
              ))}
            </div>
          </div>
        </fieldset>

        <fieldset className="group">
          <legend>הקראה</legend>

          <label className="field">
            <span>קול{langKey ? ` (${langName(langKey)})` : ''}</span>
            <select value={chosenExists ? chosen : ''} onChange={(e) => setVoice(e.target.value)}>
              <option value="">אוטומטי{activeVoice && !chosenExists ? ` — ${activeVoice.name}` : ''}</option>
              {matching.length > 0 && (
                <optgroup label={`קולות ב${langName(langKey) || 'שפת המסמך'}`}>
                  {matching.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {voiceLabel(v)}
                    </option>
                  ))}
                </optgroup>
              )}
              {others.length > 0 && (
                <optgroup label="קולות אחרים">
                  {others.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {voiceLabel(v)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          {voices.length > 0 && matching.length === 0 && langKey && (
            <p className="hint">לא נמצא בדפדפן קול ב{langName(langKey)}. אפשר להתקין קול בהגדרות מערכת ההפעלה.</p>
          )}
          {activeVoice && !activeVoice.localService && (
            <p className="hint">קולות רשת (כמו Google ב־Chrome) לא מדווחים על מיקום המילה — ההדגשה תהיה ברמת משפט בלבד.</p>
          )}

          <label className="field">
            <span>
              מהירות <output>{settings.rate.toFixed(2)}×</output>
            </span>
            <input
              type="range"
              min={RATE_MIN}
              max={RATE_MAX}
              step={0.05}
              value={settings.rate}
              onChange={(e) => update({ rate: Number(e.target.value) })}
            />
          </label>
        </fieldset>

        <section className="group shortcuts" aria-label="קיצורי מקלדת">
          <h3>קיצורי מקלדת</h3>
          <dl>
            <dt>
              <kbd>רווח</kbd>
            </dt>
            <dd>הקראה / השהיה</dd>
            <dt>
              <kbd>←</kbd> <kbd>→</kbd>
            </dt>
            <dd>משפט קודם / הבא</dd>
          </dl>
        </section>
      </div>
    </dialog>
  );
}
