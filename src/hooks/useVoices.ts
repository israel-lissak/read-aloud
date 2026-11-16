import { useEffect, useState } from 'react';
import { normalizeLang, primaryLang } from '../lib/lang';
import { ttsSupported } from './useTTS';

/** Voices load asynchronously in Chrome; listen for voiceschanged. */
export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() =>
    ttsSupported ? window.speechSynthesis.getVoices() : [],
  );

  useEffect(() => {
    if (!ttsSupported) return;
    const synth = window.speechSynthesis;
    const update = () => setVoices(synth.getVoices());
    update();
    synth.addEventListener('voiceschanged', update);
    return () => synth.removeEventListener('voiceschanged', update);
  }, []);

  return voices;
}

export function voicesForLang(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice[] {
  const target = primaryLang(lang);
  return voices.filter((v) => primaryLang(v.lang) === target);
}

/**
 * Pick a voice for the document language. Local voices are preferred: Chrome's
 * Google network voices do not fire boundary events, so word highlighting
 * and resume-from-word would not work with them.
 */
export function pickDefaultVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  const full = normalizeLang(lang);
  const candidates = voicesForLang(voices, lang);
  if (candidates.length === 0) return null;
  const score = (v: SpeechSynthesisVoice) =>
    (v.localService ? 4 : 0) + (normalizeLang(v.lang) === full ? 2 : 0) + (v.default ? 1 : 0);
  return [...candidates].sort((a, b) => score(b) - score(a))[0] ?? null;
}
