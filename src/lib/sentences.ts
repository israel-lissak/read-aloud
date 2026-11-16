import type { ApiArticle, ReadArticle, ReadBlock } from '../types';

/** Longer sentences are split at commas (Chrome also stops long utterances after ~15s). */
export const MAX_SENTENCE = 220;
const MIN_PIECE = 40;

let segmenterCache: { lang: string; seg: Intl.Segmenter } | null = null;

function getSegmenter(lang: string): Intl.Segmenter | null {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return null;
  if (segmenterCache?.lang !== lang) {
    let seg: Intl.Segmenter;
    try {
      seg = new Intl.Segmenter(lang || undefined, { granularity: 'sentence' });
    } catch {
      seg = new Intl.Segmenter(undefined, { granularity: 'sentence' });
    }
    segmenterCache = { lang, seg };
  }
  return segmenterCache.seg;
}

const FALLBACK_RE = /[^.!?…]+(?:[.!?…]+["'”’»)\]]*\s*|$)|[.!?…]+\s*/gu;

/** Split into sentences. The pieces concatenate back to the original text exactly. */
export function splitSentences(text: string, lang: string): string[] {
  const seg = getSegmenter(lang);
  const raw = seg ? Array.from(seg.segment(text), (s) => s.segment) : (text.match(FALLBACK_RE) ?? [text]);

  const out: string[] = [];
  for (const s of raw) {
    // Glue segments without letters/digits (a lone quote mark, an ellipsis) to the previous one.
    if (out.length > 0 && !/[\p{L}\p{N}]/u.test(s)) {
      out[out.length - 1] += s;
      continue;
    }
    out.push(...chunkLong(s));
  }
  return out.filter((s) => s.length > 0);
}

function chunkLong(sentence: string): string[] {
  const pieces: string[] = [];
  let rest = sentence;
  while (rest.length > MAX_SENTENCE) {
    const win = rest.slice(0, MAX_SENTENCE);
    let cut = -1;
    // Prefer the last comma-like break in the window.
    const re = /[,،;:–—](?=\s)/gu;
    for (let m = re.exec(win); m; m = re.exec(win)) {
      if (m.index >= MIN_PIECE) cut = m.index + 1;
    }
    if (cut < 0) {
      const ws = win.lastIndexOf(' ');
      cut = ws >= MIN_PIECE ? ws : MAX_SENTENCE;
    }
    // Keep the whitespace after the break with the left piece.
    while (cut < rest.length && /\s/.test(rest.charAt(cut))) cut++;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) pieces.push(rest);
  return pieces;
}

export function buildArticle(data: ApiArticle): ReadArticle {
  const sentences: string[] = [];
  const blocks: ReadBlock[] = [];
  for (const b of data.blocks) {
    const parts = splitSentences(b.text, data.lang);
    if (parts.length === 0) continue;
    const first = sentences.length;
    const refs = parts.map((text) => ({ i: sentences.push(text) - 1, text }));
    blocks.push({ tag: b.tag, first, last: sentences.length - 1, sentences: refs });
  }
  return { blocks, sentences };
}
