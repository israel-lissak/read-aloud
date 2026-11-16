import express, { type NextFunction, type Request, type Response } from 'express';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const PORT = Number(process.env.PORT ?? 3001);
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/* ------------------------------------------------------------------ */
/* SSRF protection                                                     */
/* ------------------------------------------------------------------ */

const blockList = new net.BlockList();
const V4_RANGES: [string, number][] = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (incl. cloud metadata)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];
const V6_RANGES: [string, number][] = [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
  ['2001:db8::', 32], // documentation
];
for (const [a, p] of V4_RANGES) blockList.addSubnet(a, p, 'ipv4');
for (const [a, p] of V6_RANGES) blockList.addSubnet(a, p, 'ipv6');

function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) return blockList.check(ip, 'ipv4');
  if (!net.isIPv6(ip)) return true;
  const lower = ip.toLowerCase();
  // IPv4-mapped / NAT64 addresses: check the embedded IPv4 address.
  const embedded = lower.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (embedded) return isBlockedIp(embedded[1]!);
  const hex = lower.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return isBlockedIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return blockList.check(ip, 'ipv6');
}

async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new HttpError(
      404,
      `לא הצלחנו למצוא את האתר "${host}". בדקו שהכתובת מאויתת נכון ושיש חיבור לאינטרנט.`,
    );
  }
  if (addresses.length === 0 || addresses.some((a) => isBlockedIp(a.address))) {
    throw new HttpError(
      403,
      'הכתובת מפנה לרשת פנימית או מקומית, ולכן נחסמה מטעמי אבטחה. אפשר לטעון רק עמודים ציבוריים באינטרנט.',
    );
  }
}

function parseTargetUrl(raw: unknown): URL {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new HttpError(400, 'חסרה כתובת. הדביקו קישור לכתבה, למשל https://example.com/article');
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new HttpError(400, 'הכתובת אינה תקינה. ודאו שהיא מתחילה ב־https:// ושאין בה רווחים.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'אפשר לטעון רק כתובות http או https.');
  }
  if (url.username || url.password) {
    throw new HttpError(400, 'כתובות עם שם משתמש או סיסמה אינן נתמכות.');
  }
  return url;
}

/* ------------------------------------------------------------------ */
/* Fetching                                                            */
/* ------------------------------------------------------------------ */

async function fetchWithRedirects(start: URL, signal: AbortSignal): Promise<{ res: globalThis.Response; url: URL }> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url);
    const res = await fetch(url, {
      redirect: 'manual',
      signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'he,en;q=0.8',
      },
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {});
      url = new URL(location, url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new HttpError(502, 'האתר הפנה לכתובת שאינה http/https, ולכן לא ניתן להמשיך.');
      }
      continue;
    }
    return { res, url };
  }
  throw new HttpError(502, 'האתר הפנה יותר מדי פעמים (לולאת הפניות). נסו לפתוח את הכתובת בדפדפן ולהעתיק את הכתובת הסופית.');
}

async function readBody(res: globalThis.Response): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) throw tooLarge();
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function tooLarge(): HttpError {
  return new HttpError(413, 'העמוד גדול מדי לעיבוד (מעל 8MB). נסו קישור ישיר לכתבה עצמה.');
}

/* ------------------------------------------------------------------ */
/* Charset detection                                                   */
/* ------------------------------------------------------------------ */

function detectCharset(contentType: string | null, bytes: Uint8Array): string {
  // 1. BOM
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';

  // 2. HTTP header
  const fromHeader = contentType?.match(/charset\s*=\s*["']?([\w.:-]+)/i)?.[1];
  if (fromHeader && isSupportedCharset(fromHeader)) return fromHeader;

  // 3. <meta charset> / <meta http-equiv content="...; charset=...">
  const head = Buffer.from(bytes.subarray(0, 4096)).toString('latin1');
  const fromMeta =
    head.match(/<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i)?.[1];
  if (fromMeta && isSupportedCharset(fromMeta)) return fromMeta;

  // 4. No declaration: valid UTF-8? Otherwise assume legacy Hebrew.
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'utf-8';
  } catch {
    return 'windows-1255';
  }
}

function isSupportedCharset(label: string): boolean {
  try {
    new TextDecoder(label);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Extraction                                                          */
/* ------------------------------------------------------------------ */

interface Block {
  tag: string;
  text: string;
}

const LEAF = new Set([
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'LI', 'BLOCKQUOTE', 'PRE',
  'FIGCAPTION', 'DT', 'DD', 'TD', 'TH', 'CAPTION', 'SUMMARY',
]);
const CONTAINER = new Set([
  'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'UL', 'OL', 'DL',
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'FIGURE', 'DETAILS', 'FORM', 'FIELDSET', 'CENTER',
  'ADDRESS', 'HR',
]);
const SKIP = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'OBJECT', 'EMBED', 'BUTTON',
  'SELECT', 'TEXTAREA', 'INPUT', 'IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'CANVAS', 'MATH',
]);
const BLOCK_SELECTOR = [...LEAF, ...CONTAINER].map((t) => t.toLowerCase()).join(',');
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

function isStructural(el: Element): boolean {
  return LEAF.has(el.tagName) || CONTAINER.has(el.tagName) || el.querySelector(BLOCK_SELECTOR) !== null;
}

function inlineText(node: Node): string {
  if (node.nodeType === TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== ELEMENT_NODE) return '';
  const el = node as Element;
  if (SKIP.has(el.tagName)) return '';
  if (el.tagName === 'BR') return '\n';
  let s = '';
  for (const child of el.childNodes) s += inlineText(child);
  return s;
}

function normalizeText(raw: string, preserveLines: boolean): string {
  if (preserveLines) return raw.replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '');
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * Collect leaf text blocks. Inline text that sits directly in a block next to
 * nested blocks (e.g. "<li>text<ul>…</ul></li>") becomes its own block, so
 * every piece of text appears exactly once.
 */
function collectBlocks(el: Element, out: Block[]): void {
  const ownTag = LEAF.has(el.tagName) ? el.tagName.toLowerCase() : 'p';
  let buffer = '';
  const flush = () => {
    const text = normalizeText(buffer, ownTag === 'pre');
    buffer = '';
    if (/[\p{L}\p{N}]/u.test(text)) out.push({ tag: ownTag, text });
  };
  for (const node of el.childNodes) {
    if (node.nodeType === TEXT_NODE) {
      buffer += node.textContent ?? '';
    } else if (node.nodeType === ELEMENT_NODE) {
      const child = node as Element;
      if (SKIP.has(child.tagName)) continue;
      if (ownTag !== 'pre' && isStructural(child)) {
        flush();
        collectBlocks(child, out);
      } else {
        buffer += inlineText(child);
      }
    }
  }
  flush();
}

const comparable = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

function detectLang(blocks: Block[], pageLang: string): string {
  const text = blocks.map((b) => b.text).join(' ');
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const hebrew = text.match(/[֐-׿]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-zÀ-ɏ]/g)?.length ?? 0;
  const attr = normalizeLang(pageLang);
  if (letters > 0 && hebrew / letters >= 0.3) return 'he';
  // A page declared as Hebrew whose text is mostly Latin is not really Hebrew.
  if (attr && !(attr.startsWith('he') && latin / Math.max(letters, 1) > 0.5)) return attr;
  if (letters > 0 && latin / letters > 0.5) return 'en';
  return attr;
}

function normalizeLang(lang: string | null | undefined): string {
  if (!lang) return '';
  const [primary = '', ...rest] = lang.trim().replace(/_/g, '-').toLowerCase().split('-');
  return [primary === 'iw' ? 'he' : primary, ...rest].join('-');
}

function extract(html: string, url: URL): { title: string; lang: string; blocks: Block[] } {
  const virtualConsole = new VirtualConsole(); // swallow CSS/script parse noise
  const dom = new JSDOM(html, { url: url.href, virtualConsole });
  const doc = dom.window.document;
  const pageLang = doc.documentElement.getAttribute('lang') ?? doc.documentElement.getAttribute('xml:lang') ?? '';
  const docTitle = doc.title;

  const article = new Readability(doc).parse();
  if (!article || !article.content) {
    throw new HttpError(
      422,
      'לא הצלחנו לזהות טקסט ראשי בעמוד. ייתכן שזה עמוד בית או רשימת קישורים — נסו קישור ישיר לכתבה מסוימת.',
    );
  }

  const container = doc.createElement('div');
  container.innerHTML = article.content;
  const blocks: Block[] = [];
  collectBlocks(container, blocks);
  dom.window.close();

  if (blocks.length === 0) {
    throw new HttpError(
      422,
      'העמוד נטען אך לא נמצא בו טקסט לקריאה. ייתכן שהתוכן נטען ב־JavaScript או חסום (paywall).',
    );
  }

  const title = normalizeText(article.title || docTitle || '', false);
  if (title) {
    const t = comparable(title);
    const alreadyThere = blocks
      .slice(0, 3)
      .some((b, k) => (k === 0 || /^h[1-3]$/.test(b.tag)) && comparable(b.text) === t);
    if (!alreadyThere) blocks.unshift({ tag: 'h1', text: title });
  }

  return { title, lang: detectLang(blocks, pageLang || article.lang || ''), blocks };
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

const app = express();
app.disable('x-powered-by');

app.get('/api/extract', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const target = parseTargetUrl(req.query.url);
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);

    let fetched: { res: globalThis.Response; url: URL };
    let bytes: Uint8Array;
    try {
      fetched = await fetchWithRedirects(target, signal);
      const { res: upstream } = fetched;
      if (!upstream.ok) {
        await upstream.body?.cancel().catch(() => {});
        throw upstreamStatusError(upstream.status);
      }
      const type = upstream.headers.get('content-type') ?? '';
      if (type && !/html|xml/i.test(type)) {
        await upstream.body?.cancel().catch(() => {});
        throw new HttpError(
          415,
          `הכתובת אינה עמוד אינטרנט אלא קובץ מסוג ${type.split(';')[0]}. אפשר להקריא רק עמודי HTML.`,
        );
      }
      bytes = await readBody(upstream);
    } catch (err) {
      throw toFetchError(err);
    }

    const charset = detectCharset(fetched.res.headers.get('content-type'), bytes);
    const html = new TextDecoder(charset).decode(bytes);
    const result = extract(html, fetched.url);
    res.set('Cache-Control', 'no-store').json({ ...result, url: fetched.url.href });
  } catch (err) {
    next(err);
  }
});

function upstreamStatusError(status: number): HttpError {
  if (status === 401 || status === 403) {
    return new HttpError(502, `האתר חסם את הגישה (קוד ${status}). ייתכן שנדרשת התחברות, שיש חומת תשלום או שהאתר חוסם גישה אוטומטית.`);
  }
  if (status === 404 || status === 410) {
    return new HttpError(502, `העמוד לא נמצא באתר (קוד ${status}). בדקו שהקישור מלא ועדכני.`);
  }
  if (status === 429) {
    return new HttpError(502, 'האתר מגביל את קצב הבקשות (קוד 429). נסו שוב בעוד כמה דקות.');
  }
  if (status >= 500) {
    return new HttpError(502, `שגיאה בצד האתר (קוד ${status}). נסו שוב מאוחר יותר.`);
  }
  return new HttpError(502, `האתר החזיר תשובה לא צפויה (קוד ${status}).`);
}

function toFetchError(err: unknown): unknown {
  if (err instanceof HttpError) return err;
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return new HttpError(504, 'האתר לא הגיב תוך 15 שניות. נסו שוב, או בדקו שהאתר זמין בדפדפן.');
    }
    const code = (err.cause as { code?: string } | undefined)?.code ?? '';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      return new HttpError(404, 'לא הצלחנו למצוא את האתר. בדקו שהכתובת נכונה.');
    }
    if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') {
      return new HttpError(502, 'האתר סירב לחיבור או ניתק אותו. נסו שוב מאוחר יותר.');
    }
    if (/CERT|SSL|TLS/i.test(code)) {
      return new HttpError(502, 'לאתר יש בעיה בתעודת האבטחה (SSL), ולכן לא ניתן לטעון אותו בבטחה.');
    }
  }
  return new HttpError(502, 'לא הצלחנו להוריד את העמוד. בדקו את הכתובת ונסו שוב.');
}

/* ------------------------------------------------------------------ */
/* Static files (production)                                           */
/* ------------------------------------------------------------------ */

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'נתיב API לא קיים.' });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'אירעה שגיאה בלתי צפויה בעיבוד העמוד. נסו שוב או נסו כתבה אחרת.' });
});

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});
