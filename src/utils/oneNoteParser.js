// OneNote → Playbook importer (pure client-side, zero dependencies).
//
// Parses a OneNote "Single File Web Page (.mht)" export. MHTML is a MIME
// `multipart/related` document: one (or more) text/html parts plus the page's
// images as base64 parts. We decode it with built-in browser APIs (DOMParser,
// TextDecoder, atob, Range) — no libraries.
//
// Mapping (confirmed with the user):
//   • One OneNote *page* = one setup's whole history → one dashboard Playbook.
//   • A Section/Notebook export = one .mht with many pages → we split pages.
//
// Each page becomes a draft:
//   { title, date, context, charts:[{id,dataUrl,caption}], setup_name,
//     catalysts, outcome, instruments, event_key }
// Charts hold the page's embedded images as data URLs (downscaled later, at
// import time, by the modal — this module stays sync + side-effect-free).

import { TICKERS } from './instruments';

const uid = () => Math.random().toString(36).slice(2, 10);

// ── Transfer-encoding decoders ──────────────────────────────────────────────

// Quoted-printable → text. Reassembles raw bytes then decodes with the part's
// charset so multi-byte UTF-8 (e.g. "–", "%") survives intact.
export function decodeQuotedPrintable(input, charset = 'utf-8') {
  if (!input) return '';
  const text = input.replace(/=\r?\n/g, ''); // drop soft line breaks
  const bytes = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(text.substr(i + 1, 2))) {
      bytes.push(parseInt(text.substr(i + 1, 2), 16));
      i += 2;
    } else {
      bytes.push(text.charCodeAt(i) & 0xff);
    }
  }
  try {
    return new TextDecoder(charset).decode(new Uint8Array(bytes));
  } catch {
    return text;
  }
}

// base64 → text (for the rare base64-encoded HTML part).
export function decodeBase64Text(b64, charset = 'utf-8') {
  try {
    const clean = (b64 || '').replace(/\s+/g, '');
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return '';
  }
}

// ── MIME header parsing ─────────────────────────────────────────────────────

function parseHeaders(headerText) {
  // Unfold continuation lines (RFC 2822: a header line wrapped onto the next
  // line begins with whitespace).
  const unfolded = (headerText || '').replace(/\r?\n[ \t]+/g, ' ');
  const map = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) map[m[1].toLowerCase().trim()] = m[2].trim();
  }
  return map;
}

function charsetOf(contentType) {
  const m = /charset\s*=\s*"?([^";]+)"?/i.exec(contentType || '');
  return m ? m[1].trim().toLowerCase() : 'utf-8';
}

function basename(path) {
  if (!path) return '';
  return String(path).split(/[\\/]/).pop().split('?')[0].split('#')[0].trim();
}

// ── parseMhtml: raw text → { htmlParts:[{html,charset}], images:Map } ────────

export function parseMhtml(text) {
  const images = new Map(); // key (location | basename | cid:id | id) → dataUrl
  const htmlParts = [];

  if (!text || typeof text !== 'string') {
    return { htmlParts, images };
  }

  // Find the multipart boundary from the root headers.
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^\s;]+))/i.exec(text);
  const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]) : null;

  // Not a multipart container → treat the whole payload as a single HTML doc.
  if (!boundary) {
    htmlParts.push({ html: text, charset: 'utf-8' });
    return { htmlParts, images };
  }

  const rawParts = text.split('--' + boundary);
  for (const raw of rawParts) {
    const part = raw.replace(/^\r?\n/, '');
    if (!part || part === '--' || part.startsWith('--')) continue; // preamble / closing
    // Split headers from body at the first blank line.
    const sep = part.search(/\r?\n\r?\n/);
    if (sep === -1) continue;
    const headerText = part.slice(0, sep);
    let body = part.slice(sep).replace(/^\r?\n\r?\n/, '');

    const headers = parseHeaders(headerText);
    const ctype = (headers['content-type'] || '').toLowerCase();
    const cte = (headers['content-transfer-encoding'] || '').toLowerCase();
    const location = headers['content-location'] || '';
    const contentId = (headers['content-id'] || '').replace(/^<|>$/g, '');
    const cs = charsetOf(headers['content-type']);

    if (ctype.startsWith('text/html')) {
      let html;
      if (cte === 'base64') html = decodeBase64Text(body, cs);
      else if (cte === 'quoted-printable') html = decodeQuotedPrintable(body, cs);
      else html = body;
      htmlParts.push({ html, charset: cs });
    } else if (ctype.startsWith('image/')) {
      const mime = ctype.split(';')[0].trim();
      const b64 = body.replace(/\s+/g, '');
      if (!b64) continue;
      const dataUrl = `data:${mime};base64,${b64}`;
      if (location) {
        images.set(location, dataUrl);
        images.set(basename(location), dataUrl);
      }
      if (contentId) {
        images.set('cid:' + contentId, dataUrl);
        images.set(contentId, dataUrl);
      }
    }
    // other part types (css, etc.) are ignored
  }

  return { htmlParts, images };
}

// Resolve an <img src> against the decoded image map (handles cid:, absolute
// file:// locations, and bare basenames).
function resolveImg(src, images) {
  if (!src) return null;
  if (images.has(src)) return images.get(src);
  if (src.startsWith('cid:')) {
    const id = src.slice(4);
    if (images.has('cid:' + id)) return images.get('cid:' + id);
    if (images.has(id)) return images.get(id);
  }
  const base = basename(src);
  if (base && images.has(base)) return images.get(base);
  return null;
}

// ── Text + title + date extraction ──────────────────────────────────────────

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'TABLE', 'UL', 'OL', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'PRE', 'HR'
]);

// innerText-like extraction that works on detached DOMParser nodes / fragments
// (where element.innerText returns '' because there's no layout).
function extractText(node) {
  let out = '';
  function walk(n) {
    if (!n) return;
    if (n.nodeType === 3) { out += (n.nodeValue || '').replace(/\s+/g, ' '); return; }
    if (n.nodeType !== 1 && n.nodeType !== 11) return;
    const tag = n.tagName;
    if (tag === 'STYLE' || tag === 'SCRIPT') return;
    if (tag === 'BR') { out += '\n'; return; }
    const block = tag && BLOCK_TAGS.has(tag);
    if (block && out && !out.endsWith('\n')) out += '\n';
    for (const c of n.childNodes) walk(c);
    if (block && out && !out.endsWith('\n')) out += '\n';
  }
  walk(node);
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// font-size in px from an inline style string (handles pt and px).
function fontSizePx(styleAttr) {
  const m = /font-size\s*:\s*([\d.]+)\s*(pt|px)/i.exec(styleAttr || '');
  if (!m) return 0;
  const v = parseFloat(m[1]);
  return m[2].toLowerCase() === 'pt' ? v * 1.3333 : v;
}

// OneNote page titles are the largest text on a page (~20pt ≈ 26px); body text
// is ~11pt ≈ 15px. Treat large short text (or h1/h2) as page-title markers.
const TITLE_MIN_PX = 18;

function findTitleCandidates(root) {
  const els = [...root.querySelectorAll('h1,h2,p,div,span,td,b,strong')];
  const cands = els.filter(el => {
    const txt = (el.textContent || '').trim();
    if (!txt || txt.length > 140) return false;
    const tag = el.tagName;
    if (tag === 'H1' || tag === 'H2') return true;
    return fontSizePx(el.getAttribute && el.getAttribute('style')) >= TITLE_MIN_PX;
  });
  // Keep only the outermost of any nested candidates (drop a candidate whose
  // ancestor is also a candidate) to avoid counting one title twice.
  const set = new Set(cands);
  return cands.filter(el => {
    let p = el.parentElement;
    while (p) { if (set.has(p)) return false; p = p.parentElement; }
    return true;
  });
}

function pad2(n) { return String(n).padStart(2, '0'); }
function toIsoDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Portuguese month names (accents stripped for matching).
const PT_MONTH_MAP = {
  janeiro: 0, fevereiro: 1, marco: 2, abril: 3, maio: 4, junho: 5,
  julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11
};
function normMonth(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
// Parse Portuguese date like "30 de outubro de 2024" or "30 outubro 2024".
function parsePtDate(text) {
  const m = /(\d{1,2})\s+(?:de\s+)?([A-Za-zÀ-ɏ]+)(?:\s+de)?\s+(\d{4})/i.exec(text);
  if (!m) return '';
  const month = PT_MONTH_MAP[normMonth(m[2])];
  if (month === undefined) return '';
  const day = parseInt(m[1], 10);
  const year = parseInt(m[3], 10);
  if (year < 2000 || year > 2100 || day < 1 || day > 31) return '';
  return toIsoDate(new Date(year, month, day));
}

// Scan the first few lines of a page's text for a date (OneNote renders the
// page's created date/time just under the title).
function parseLooseDate(textBlock) {
  if (!textBlock) return '';
  const lines = textBlock.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 5);
  for (const line of lines) {
    const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(line);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  for (const line of lines) {
    // Try Portuguese months first.
    const pt = parsePtDate(line);
    if (pt) return pt;
    // Trim a leading weekday so Date.parse is happy ("Tuesday, March 24, 2026").
    const cleaned = line.replace(/^[A-Za-z]+day,?\s*/i, '');
    const ts = Date.parse(cleaned);
    if (!Number.isNaN(ts)) {
      const d = new Date(ts);
      const y = d.getFullYear();
      if (y >= 2000 && y <= 2100) return toIsoDate(d);
    }
  }
  return '';
}

// Light, conservative ticker detection from free text (uppercase, whole-word).
function detectInstruments(textBlock) {
  if (!textBlock) return [];
  const found = new Set();
  for (const t of TICKERS) {
    // escape the few tickers that start with a digit ("6A" etc.) for the regex
    const re = new RegExp('(?:^|[^A-Za-z0-9])' + t + '(?:$|[^A-Za-z0-9])');
    if (re.test(textBlock)) found.add(t);
  }
  return [...found];
}

// ── Node → playbook draft ───────────────────────────────────────────────────

export function mapPageToPlaybook(node, images, explicitTitle, splitMethod) {
  const context = extractText(node);
  const charts = [];
  const imgs = node.querySelectorAll ? node.querySelectorAll('img') : [];
  for (const im of imgs) {
    const dataUrl = resolveImg(im.getAttribute('src'), images);
    if (dataUrl) charts.push({ id: uid(), dataUrl, caption: '' });
  }

  let title = (explicitTitle || '').trim();
  if (!title) {
    const firstLine = context.split('\n').map(l => l.trim()).find(Boolean);
    title = (firstLine && firstLine.length <= 120) ? firstLine : '';
  }
  if (!title) title = 'Untitled OneNote page';

  return {
    id: uid(),
    title,
    date: parseLooseDate(context),
    setup_name: '',
    event_key: '',
    instruments: detectInstruments(context),
    catalysts: [],
    context,
    charts,
    outcome: '',
    _meta: { splitMethod, charCount: context.length }
  };
}

// ── Date-based page splitting ────────────────────────────────────────────────
//
// OneNote files often store one recurring event per page (e.g. "AUD CPI"),
// with individual dated releases as sections headed by a bare date like
// "26 Feb 2025" or "30 de outubro de 2024". We detect these date headers and
// slice the DOM at each one to produce one draft per release date.

const EN_MONTHS_PAT = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
const PT_MONTHS_PAT = 'janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro';

// Matches a line whose ENTIRE content is a date (with optional leading weekday).
const DATE_HEADER_RE = new RegExp(
  '^\\s*(?:[A-Za-z]{3,9}day,?\\s*)?' +
  '(?:' +
    `\\d{1,2}\\s+(?:de\\s+)?(?:${EN_MONTHS_PAT}|${PT_MONTHS_PAT})(?:\\s+de)?\\s+\\d{4}` +
    `|(?:${EN_MONTHS_PAT}|${PT_MONTHS_PAT})\\s+\\d{1,2},?\\s+\\d{4}` +
    '|\\d{4}-\\d{2}-\\d{2}' +
  ')' +
  '\\s*$',
  'i'
);

// Walk block-level elements; return those whose complete text is a date header.
function findDateSplitters(root) {
  const results = [];
  const seen = new Set();
  for (const el of root.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6')) {
    const txt = (el.textContent || '').trim();
    if (!txt || txt.length > 60 || !DATE_HEADER_RE.test(txt)) continue;
    // Reject if an ancestor element is already a splitter (avoids double-counting
    // a container whose only content is the date).
    let nested = false;
    let p = el.parentElement;
    while (p && p !== root) {
      if (seen.has(p)) { nested = true; break; }
      p = p.parentElement;
    }
    if (nested) continue;
    seen.add(el);
    results.push({ el, text: txt, isoDate: parsePtDate(txt) || parseLooseDate(txt) });
  }
  return results;
}

// Slice a document body at date-header elements. Returns an array of drafts
// (one per date section) or null if fewer than 2 date headers are found.
function splitByDates(doc, body, images) {
  const splitters = findDateSplitters(body);
  if (splitters.length < 2) return null;
  const drafts = [];
  for (let i = 0; i < splitters.length; i++) {
    const range = doc.createRange();
    range.setStartBefore(splitters[i].el);
    if (i + 1 < splitters.length) range.setEndBefore(splitters[i + 1].el);
    else range.setEndAfter(body.lastChild || body);
    const frag = range.cloneContents();
    const draft = mapPageToPlaybook(frag, images, splitters[i].text, 'dates');
    if (splitters[i].isoDate) draft.date = splitters[i].isoDate;
    drafts.push(draft);
  }
  return drafts;
}

// ── splitPages: one HTML doc → [draft, ...] ─────────────────────────────────

export function splitPages(html, images) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.body;
  if (!body) return [];

  // Prefer date-based splitting: each date header = one release.
  const byDates = splitByDates(doc, body, images);
  if (byDates) return byDates;

  const titles = findTitleCandidates(body);

  // Multiple title markers → slice the DOM between them with the Range API
  // (handles arbitrary nesting cleanly).
  if (titles.length >= 2) {
    const drafts = [];
    for (let i = 0; i < titles.length; i++) {
      const range = doc.createRange();
      range.setStartBefore(titles[i]);
      if (i + 1 < titles.length) range.setEndBefore(titles[i + 1]);
      else range.setEndAfter(body.lastChild || body);
      const frag = range.cloneContents();
      drafts.push(mapPageToPlaybook(frag, images, titles[i].textContent, 'headings'));
    }
    return drafts;
  }

  // Single page (or undetectable boundaries) → whole doc is one playbook.
  const explicitTitle =
    (doc.title && doc.title.trim()) ||
    (titles[0] && titles[0].textContent) || '';
  return [mapPageToPlaybook(body, images, explicitTitle, 'single')];
}

// ── Top-level orchestrator the importer calls ───────────────────────────────

// Returns { drafts, meta } or throws with a readable message.
export function parseOneNoteMhtml(text, sourceName = '') {
  const { htmlParts, images } = parseMhtml(text);
  if (!htmlParts.length) {
    throw new Error(`No HTML content found in ${sourceName || 'file'} — is this a OneNote .mht export?`);
  }

  let drafts = [];
  let splitMethod;

  if (htmlParts.length > 1) {
    // OneNote emitted one HTML part per page → per-page split.
    // Within each page, try to further split by date headers (one date = one release).
    splitMethod = 'mime-parts';
    for (const part of htmlParts) {
      const doc = new DOMParser().parseFromString(part.html, 'text/html');
      const body = doc.body;
      if (!body) continue;
      const byDates = splitByDates(doc, body, images);
      if (byDates && byDates.length >= 2) {
        drafts.push(...byDates);
      } else {
        const titles = findTitleCandidates(body);
        const explicitTitle =
          (doc.title && doc.title.trim()) || (titles[0] && titles[0].textContent) || '';
        drafts.push(mapPageToPlaybook(body, images, explicitTitle, 'mime-parts'));
      }
    }
  } else {
    // One combined HTML doc → split by in-page title markers.
    drafts = splitPages(htmlParts[0].html, images);
    splitMethod = drafts.length > 1 ? 'headings' : 'single';
  }

  // Drop empty drafts (no text and no charts).
  drafts = drafts.filter(d => (d.context && d.context.trim()) || d.charts.length);

  // Tag each draft with its source filename for the review UI.
  for (const d of drafts) d._meta = { ...d._meta, source: sourceName };

  const imageCount = drafts.reduce((n, d) => n + d.charts.length, 0);
  return {
    drafts,
    meta: { splitMethod, htmlPartCount: htmlParts.length, imageCount, source: sourceName }
  };
}
