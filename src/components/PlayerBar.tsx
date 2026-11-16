import { useState } from 'react';
import type { TTSStatus } from '../hooks/useTTS';
import { RATE_MAX, RATE_MIN } from '../lib/settings';

interface Props {
  status: TTSStatus;
  index: number;
  total: number;
  rate: number;
  disabled: boolean;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onStop: () => void;
  onSeek: (i: number) => void;
  onRate: (rate: number) => void;
}

const RATES: number[] = [];
for (let r = RATE_MIN; r <= RATE_MAX + 1e-9; r += 0.25) RATES.push(Math.round(r * 100) / 100);

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
    <path d={d} fill="currentColor" />
  </svg>
);

const ICONS = {
  prev: 'M6 5h2v14H6zM20 5v14L9.5 12z',
  next: 'M16 5h2v14h-2zM4 5v14l10.5-7z',
  play: 'M7 4.5v15L19.5 12z',
  pause: 'M6.5 5h4v14h-4zM13.5 5h4v14h-4z',
  stop: 'M6 6h12v12H6z',
};

export function PlayerBar({
  status,
  index,
  total,
  rate,
  disabled,
  onToggle,
  onPrev,
  onNext,
  onStop,
  onSeek,
  onRate,
}: Props) {
  const position = Math.max(0, index);
  // While dragging, show the thumb position without restarting speech on every step.
  const [drag, setDrag] = useState<number | null>(null);

  const commit = () => {
    if (drag !== null && drag !== position) onSeek(drag);
    setDrag(null);
  };

  const playing = status === 'playing';
  const rateOptions = RATES.includes(rate) ? RATES : [...RATES, rate].sort((a, b) => a - b);
  const shown = (drag ?? position) + 1;

  return (
    <div className="player" dir="ltr" role="region" aria-label="נגן הקראה">
      <div className="player-inner">
        <div className="player-buttons">
          <button type="button" className="icon-btn" onClick={onPrev} disabled={disabled} aria-label="המשפט הקודם" title="המשפט הקודם (←)">
            <Icon d={ICONS.prev} />
          </button>
          <button
            type="button"
            className="icon-btn play"
            onClick={onToggle}
            disabled={disabled}
            aria-label={playing ? 'השהה' : 'הקרא'}
            title={playing ? 'השהה (רווח)' : 'הקרא (רווח)'}
          >
            <Icon d={playing ? ICONS.pause : ICONS.play} />
          </button>
          <button type="button" className="icon-btn" onClick={onNext} disabled={disabled} aria-label="המשפט הבא" title="המשפט הבא (→)">
            <Icon d={ICONS.next} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onStop}
            disabled={disabled || status === 'idle'}
            aria-label="עצור"
            title="עצור"
          >
            <Icon d={ICONS.stop} />
          </button>
        </div>

        <input
          className="seek"
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          step={1}
          value={drag ?? position}
          disabled={disabled || total < 2}
          aria-label="מיקום במאמר"
          aria-valuetext={`משפט ${shown} מתוך ${total}`}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />

        <span className="counter" aria-live="off">
          {total ? `${shown}/${total}` : '0/0'}
        </span>

        <label className="rate">
          <span className="visually-hidden">מהירות הקראה</span>
          <select value={rate} onChange={(e) => onRate(Number(e.target.value))} disabled={disabled}>
            {rateOptions.map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
