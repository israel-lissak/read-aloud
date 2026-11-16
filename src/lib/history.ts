import { useCallback, useEffect, useState } from 'react';

export interface HistoryEntry {
  url: string;
  title: string;
  /** Last visit, epoch ms. */
  visitedAt: number;
  /** Last sentence reached (-1 = not started). */
  position: number;
  total: number;
}

const KEY = 'read-aloud:history';
const MAX_ENTRIES = 50;

function isEntry(e: unknown): e is HistoryEntry {
  if (!e || typeof e !== 'object') return false;
  const o = e as Record<string, unknown>;
  return (
    typeof o.url === 'string' &&
    typeof o.title === 'string' &&
    typeof o.visitedAt === 'number' &&
    typeof o.position === 'number' &&
    typeof o.total === 'number'
  );
}

function load(): HistoryEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter(isEntry).slice(0, MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

export interface HistoryApi {
  entries: HistoryEntry[];
  get: (url: string) => HistoryEntry | undefined;
  /** Add or move to top, merging with any existing entry for the URL. */
  visit: (entry: Pick<HistoryEntry, 'url' | 'title' | 'total'>) => void;
  setPosition: (url: string, position: number) => void;
  remove: (url: string) => void;
  clear: () => void;
}

export function useHistory(): HistoryApi {
  const [entries, setEntries] = useState<HistoryEntry[]>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(entries));
    } catch {
      /* storage unavailable (private mode etc.) */
    }
  }, [entries]);

  // Keep tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setEntries(load());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const get = useCallback((url: string) => entries.find((e) => e.url === url), [entries]);

  const visit = useCallback<HistoryApi['visit']>(({ url, title, total }) => {
    setEntries((list) => {
      const prev = list.find((e) => e.url === url);
      // Keep the saved position only if the article still has the same length.
      const position = prev && prev.total === total ? prev.position : -1;
      const entry: HistoryEntry = { url, title, total, position, visitedAt: Date.now() };
      return [entry, ...list.filter((e) => e.url !== url)].slice(0, MAX_ENTRIES);
    });
  }, []);

  const setPosition = useCallback((url: string, position: number) => {
    setEntries((list) => {
      const i = list.findIndex((e) => e.url === url);
      if (i < 0 || list[i].position === position) return list;
      const copy = list.slice();
      copy[i] = { ...copy[i], position };
      return copy;
    });
  }, []);

  const remove = useCallback((url: string) => {
    setEntries((list) => list.filter((e) => e.url !== url));
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  return { entries, get, visit, setPosition, remove, clear };
}
