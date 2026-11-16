import { useCallback, useEffect, useRef, useState } from 'react';
import type { WordRange } from '../types';

export type TTSStatus = 'idle' | 'playing' | 'paused';

export const ttsSupported =
  typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

interface Options {
  sentences: string[];
  voice: SpeechSynthesisVoice | null;
  rate: number;
  /** Document language, used when no voice is available. */
  lang: string;
}

export interface TTS {
  supported: boolean;
  index: number;
  status: TTSStatus;
  word: WordRange | null;
  speak: (i: number) => void;
  toggle: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
  seek: (i: number) => void;
}

const MAX_CONSECUTIVE_ERRORS = 3;
const HAS_SPEECH = /[\p{L}\p{N}]/u;

/**
 * Sentence-by-sentence speech with the Web Speech API.
 *
 * - One utterance per sentence; `onend` advances to the next one.
 * - speechSynthesis.pause()/resume() are never used (buggy in Chrome,
 *   unsupported on Android). Pause = cancel + remember the sentence and the
 *   offset of the last spoken word; resume = a new utterance from that word.
 * - Every utterance carries a generation token, so events from cancelled
 *   utterances are ignored.
 */
export function useTTS({ sentences, voice, rate, lang }: Options): TTS {
  const [index, setIndex] = useState(-1);
  const [status, setStatus] = useState<TTSStatus>('idle');
  const [word, setWord] = useState<WordRange | null>(null);

  const tokenRef = useRef(0);
  // Strong reference to the live utterance: Chrome may garbage-collect it
  // mid-speech and then onend never fires.
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const indexRef = useRef(-1);
  const statusRef = useRef<TTSStatus>('idle');
  /** Offset (in the current sentence) of the last word reached. */
  const wordStartRef = useRef(0);
  const errorsRef = useRef(0);
  const cfgRef = useRef({ sentences, voice, rate, lang });
  cfgRef.current = { sentences, voice, rate, lang };

  const setIdx = useCallback((i: number) => {
    indexRef.current = i;
    setIndex(i);
  }, []);
  const setStat = useCallback((s: TTSStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  /** Invalidate the current utterance and silence the engine. */
  const halt = useCallback(() => {
    tokenRef.current++;
    utterRef.current = null;
    if (ttsSupported) window.speechSynthesis.cancel();
  }, []);

  const speakFrom = useCallback(
    function run(i: number, offset: number): void {
      if (!ttsSupported) return;
      const { sentences: list, voice: v, rate: r, lang: l } = cfgRef.current;
      halt();
      const token = tokenRef.current;

      if (i < 0 || i >= list.length) {
        // Finished (or nothing to read).
        wordStartRef.current = 0;
        setWord(null);
        setStat('idle');
        if (i >= list.length) setIdx(-1);
        return;
      }

      const full = list[i]!;
      const start = Math.max(0, Math.min(offset, full.length));
      const text = full.slice(start);
      setIdx(i);
      setWord(null);
      wordStartRef.current = start;

      if (!HAS_SPEECH.test(text)) {
        run(i + 1, 0);
        return;
      }

      const u = new SpeechSynthesisUtterance(text);
      if (v) {
        u.voice = v;
        u.lang = v.lang;
      } else if (l) {
        u.lang = l;
      }
      u.rate = r;

      u.onboundary = (e) => {
        if (token !== tokenRef.current) return;
        if (e.name && e.name !== 'word') return;
        const s = start + e.charIndex;
        let len = e.charLength;
        if (!len) len = /^\S+/u.exec(full.slice(s))?.[0].length ?? 0;
        wordStartRef.current = s;
        if (len > 0) setWord({ start: s, end: Math.min(full.length, s + len) });
      };
      u.onend = () => {
        if (token !== tokenRef.current) return;
        errorsRef.current = 0;
        run(i + 1, 0);
      };
      u.onerror = (e) => {
        if (token !== tokenRef.current) return;
        if (e.error === 'interrupted' || e.error === 'canceled') return;
        console.warn('speechSynthesis error:', e.error);
        errorsRef.current++;
        if (errorsRef.current >= MAX_CONSECUTIVE_ERRORS) {
          halt();
          setWord(null);
          setStat('idle');
          return;
        }
        run(i + 1, 0);
      };

      utterRef.current = u;
      setStat('playing');
      window.speechSynthesis.speak(u);
    },
    [halt, setIdx, setStat],
  );

  const speak = useCallback(
    (i: number) => {
      errorsRef.current = 0;
      speakFrom(i, 0);
    },
    [speakFrom],
  );

  const pause = useCallback(() => {
    if (statusRef.current !== 'playing') return;
    halt();
    setStat('paused');
  }, [halt, setStat]);

  const resume = useCallback(() => {
    if (statusRef.current !== 'paused') return;
    errorsRef.current = 0;
    speakFrom(Math.max(0, indexRef.current), wordStartRef.current);
  }, [speakFrom]);

  const stop = useCallback(() => {
    halt();
    wordStartRef.current = 0;
    setWord(null);
    setStat('idle');
  }, [halt, setStat]);

  const toggle = useCallback(() => {
    const s = statusRef.current;
    if (s === 'playing') pause();
    else if (s === 'paused') resume();
    else speak(Math.max(0, indexRef.current));
  }, [pause, resume, speak]);

  const seek = useCallback(
    (target: number) => {
      const n = cfgRef.current.sentences.length;
      if (n === 0) return;
      const i = Math.max(0, Math.min(n - 1, target));
      if (statusRef.current === 'playing') {
        speak(i);
      } else {
        // Move the position only; paused stays paused and resumes from here.
        halt();
        wordStartRef.current = 0;
        setWord(null);
        setIdx(i);
      }
    },
    [halt, setIdx, speak],
  );

  const next = useCallback(() => seek(indexRef.current + 1), [seek]);
  const prev = useCallback(() => seek(Math.max(0, indexRef.current - 1)), [seek]);

  // Changing voice or rate mid-reading restarts from the current word.
  const voiceURI = voice?.voiceURI ?? '';
  useEffect(() => {
    if (statusRef.current === 'playing') speakFrom(indexRef.current, wordStartRef.current);
  }, [voiceURI, rate, speakFrom]);

  // New article: reset everything.
  useEffect(() => {
    halt();
    wordStartRef.current = 0;
    setWord(null);
    setStat('idle');
    setIdx(-1);
  }, [sentences, halt, setIdx, setStat]);

  // Silence on unmount / page unload.
  useEffect(() => {
    const onHide = () => halt();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      halt();
    };
  }, [halt]);

  return { supported: ttsSupported, index, status, word, speak, toggle, pause, resume, stop, next, prev, seek };
}
