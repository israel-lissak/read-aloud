import type { HistoryEntry } from '../lib/history';

interface Props {
  entries: HistoryEntry[];
  onOpen: (url: string) => void;
  onRemove: (url: string) => void;
  onClear: () => void;
}

const timeFmt = new Intl.RelativeTimeFormat('he', { numeric: 'auto' });
const dateFmt = new Intl.DateTimeFormat('he', { day: 'numeric', month: 'short', year: 'numeric' });

function relativeTime(ts: number): string {
  const diff = (ts - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'עכשיו';
  if (abs < 3600) return timeFmt.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return timeFmt.format(Math.round(diff / 3600), 'hour');
  if (abs < 7 * 86400) return timeFmt.format(Math.round(diff / 86400), 'day');
  return dateFmt.format(ts);
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function progress(e: HistoryEntry): string | null {
  if (e.position < 0 || e.total <= 0) return null;
  if (e.position >= e.total - 1) return 'הסתיים';
  return `${Math.round(((e.position + 1) / e.total) * 100)}%`;
}

export function HistoryList({ entries, onOpen, onRemove, onClear }: Props) {
  if (entries.length === 0) return null;

  const onClearClick = () => {
    if (confirm('למחוק את כל ההיסטוריה?')) onClear();
  };

  return (
    <section className="history" aria-labelledby="history-title">
      <div className="history-head">
        <h2 id="history-title">נקראו לאחרונה</h2>
        <button type="button" className="link-btn" onClick={onClearClick}>
          ניקוי
        </button>
      </div>
      <ul>
        {entries.map((e) => {
          const p = progress(e);
          return (
            <li key={e.url}>
              <button type="button" className="history-item" onClick={() => onOpen(e.url)}>
                <span className="history-title">{e.title || host(e.url)}</span>
                <span className="history-meta">
                  <span dir="ltr">{host(e.url)}</span>
                  <span>{relativeTime(e.visitedAt)}</span>
                  {p && <span>{p}</span>}
                </span>
              </button>
              <button
                type="button"
                className="icon-btn history-remove"
                onClick={() => onRemove(e.url)}
                aria-label={`הסרה מההיסטוריה: ${e.title || host(e.url)}`}
                title="הסרה"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
