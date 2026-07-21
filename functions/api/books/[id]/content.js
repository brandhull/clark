import { checkPin, unauthorized, json, pickFormat } from '../../_utils.js';

// Note: params.id here is the Gutenberg ID, not the Baserow row id used by
// the sibling books/[id].js route — content caching is keyed by Gutenberg ID
// since it has nothing to do with the Baserow row.

const GUTENDEX_BOOK_URL = (id) => `https://gutendex.com/books/${id}/`;

// Modern Gutenberg plaintext wraps the actual book between these markers.
// "this"/"the" both appear across older and newer releases.
const START_RE = /\*\*\*\s*start of (?:this|the) project gutenberg ebook[^\n]*\*\*\*/i;
const END_RE = /\*\*\*\s*end of (?:this|the) project gutenberg ebook[^\n]*\*\*\*/i;

function stripPlaintextBoilerplate(raw) {
  const startMatch = raw.match(START_RE);
  const endMatch = raw.match(END_RE);
  if (!startMatch || !endMatch) return raw; // no markers found — rare, use full text rather than fail
  const start = startMatch.index + startMatch[0].length;
  const end = endMatch.index;
  if (end <= start) return raw;
  return raw.slice(start, end).trim();
}

// HTML sources are left as fetched (no string-slicing — that risks producing
// unclosed tags, which then breaks DOMPurify/DOMParser downstream). Gutenberg
// wraps the license/metadata boilerplate in <header id="pg-header"
// class="pg-boilerplate"> and <footer id="pg-footer" class="pg-boilerplate">,
// so the client's block-splitter skips elements with that class instead.

// gutenberg.org's own redirect chain for some format URLs dips through a
// plain http:// hop before landing on https:// (e.g. /ebooks/84.html.images
// -> http://.../cache/epub/84/pg84-images.html -> https://...). Cloudflare's
// production fetch() is stricter about following that downgrade than local
// dev's Miniflare simulation — same root cause as the Baserow pagination
// gotcha, so handle it the same way: follow redirects manually, rewriting
// http -> https at every hop instead of trusting the runtime to do it.
async function fetchFollowingRedirects(url, maxHops = 5) {
  let current = url;
  for (let i = 0; i < maxHops; i++) {
    const res = await fetch(current, { redirect: 'manual' });
    console.log('[clark debug] hop', i, current, '->', res.status, res.headers.get('location'));
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = new URL(res.headers.get('location'), current);
      if (next.protocol === 'http:') next.protocol = 'https:';
      current = next.toString();
      continue;
    }
    return res;
  }
  throw new Error(`Too many redirects fetching ${url}`);
}

async function fetchAndClean(gutenbergId) {
  const detailRes = await fetch(GUTENDEX_BOOK_URL(gutenbergId));
  if (!detailRes.ok) return { error: json({ error: 'gutendex', status: detailRes.status }, { status: 502 }) };
  const detail = await detailRes.json();

  const format = pickFormat(detail.formats);
  if (!format) return { error: json({ error: 'no-readable-format' }, { status: 422 }) };

  const sourceRes = await fetchFollowingRedirects(format.url);
  if (!sourceRes.ok) return { error: json({ error: 'gutenberg-fetch', status: sourceRes.status }, { status: 502 }) };
  let raw = await sourceRes.text();

  if (format.type === 'text') raw = stripPlaintextBoilerplate(raw);

  return { content: { source_type: format.type, raw } };
}

export async function onRequestGet({ request, env, params }) {
  if (!checkPin(request, env)) return unauthorized();

  const gutenbergId = params.id;
  const cacheKey = `book:${gutenbergId}`;

  const cached = await env.BOOK_CACHE.get(cacheKey);
  if (cached) return json(await cached.json(), { headers: { 'X-Cache': 'hit' } });

  const { content, error } = await fetchAndClean(gutenbergId);
  if (error) return error;

  await env.BOOK_CACHE.put(cacheKey, JSON.stringify(content));
  return json(content, { headers: { 'X-Cache': 'miss' } });
}
