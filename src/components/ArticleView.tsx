import { memo, useCallback, useEffect, useRef, type CSSProperties, type MouseEvent } from 'react';
import type { ReadArticle, ReadBlock, WordRange } from '../types';

/* ---------------- Sentence ---------------- */

interface SentenceProps {
  i: number;
  text: string;
  active: boolean;
  word: WordRange | null;
}

const Sentence = memo(function Sentence({ i, text, active, word }: SentenceProps) {
  if (active && word && word.end <= text.length && word.start < word.end) {
    return (
      <span data-i={i} className="s is-active">
        {text.slice(0, word.start)}
        <mark className="w">{text.slice(word.start, word.end)}</mark>
        {text.slice(word.end)}
      </span>
    );
  }
  return (
    <span data-i={i} className={active ? 's is-active' : 's'}>
      {text}
    </span>
  );
});

/* ---------------- Block ---------------- */

interface BlockProps {
  block: ReadBlock;
  /** The active sentence index if it belongs to this block, else -1. */
  active: number;
  /** Only passed to the block holding the active sentence. */
  word: WordRange | null;
}

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const Block = memo(function Block({ block, active, word }: BlockProps) {
  const children = block.sentences.map((s) => (
    <Sentence
      key={s.i}
      i={s.i}
      text={s.text}
      active={s.i === active}
      word={s.i === active ? word : null}
    />
  ));

  const tag = block.tag;
  if (HEADINGS.has(tag)) {
    const H = tag as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
    return (
      <H dir="auto" className={`b b-${tag}`}>
        {children}
      </H>
    );
  }
  if (tag === 'blockquote') {
    return (
      <blockquote dir="auto" className="b b-blockquote">
        {children}
      </blockquote>
    );
  }
  if (tag === 'pre') {
    return (
      <pre dir="auto" className="b b-pre">
        {children}
      </pre>
    );
  }
  return (
    <p dir="auto" className={`b b-${tag}`}>
      {children}
    </p>
  );
});

/* ---------------- Article ---------------- */

interface ArticleViewProps {
  article: ReadArticle;
  index: number;
  word: WordRange | null;
  onSentenceClick: (i: number) => void;
  style: CSSProperties;
  lang: string;
}

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function ArticleView({ article, index, word, onSentenceClick, style, lang }: ArticleViewProps) {
  const ref = useRef<HTMLElement>(null);

  // Delegate clicks: one handler for the whole article.
  const handleClick = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      // Don't hijack text selection.
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) return;
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (!el) return;
      const i = Number(el.dataset.i);
      if (Number.isInteger(i)) onSentenceClick(i);
    },
    [onSentenceClick],
  );

  // Auto-scroll only when the active sentence/word leaves the central band of the viewport.
  useEffect(() => {
    const root = ref.current;
    if (!root || index < 0) return;
    const el =
      root.querySelector<HTMLElement>('mark.w') ?? root.querySelector<HTMLElement>(`[data-i="${index}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const bar = document.querySelector('.player')?.getBoundingClientRect().height ?? 0;
    const top = vh * 0.18;
    const bottom = Math.min(vh * 0.72, vh - bar - 24);
    if (r.top < top || r.bottom > bottom) {
      el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  }, [index, word]);

  return (
    <article ref={ref} className="article" style={style} lang={lang || undefined} onClick={handleClick}>
      {article.blocks.map((b, k) => {
        const has = index >= b.first && index <= b.last;
        return <Block key={k} block={b} active={has ? index : -1} word={has ? word : null} />;
      })}
    </article>
  );
}
