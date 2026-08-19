import { checkPin, unauthorized, json, pickFormat } from './_utils.js';

// Gutendex requires the trailing slash on /books/ — without it you get a 301.
const GUTENDEX_BASE = 'https://gutendex.com/books/';

// Topic (category browse) results are cached — popularity rankings for a
// fixed set of categories don't shift fast enough to justify a live Gutendex
// round-trip on every app open, and it makes repeat opens near-instant.
const BROWSE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeKey(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Gutendex has no notion of "the same work" — a popular classic can show up
// as 5+ near-identical entries (different transcriptions/translators). Not
// aiming for perfect canonicalization here, just collapsing exact
// title+author matches down to whichever has the most downloads.
function dedupeByTitleAuthor(results) {
  const best = new Map();
  for (const r of results) {
    const key = `${normalizeKey(r.title)}|${normalizeKey(r.author)}`;
    const existing = best.get(key);
    if (!existing || r.download_count > existing.download_count) best.set(key, r);
  }
  return Array.from(best.values());
}

async function fetchAndShape(params) {
  const res = await fetch(`${GUTENDEX_BASE}?${params.toString()}`);
  if (!res.ok) return { error: json({ error: 'gutendex', status: res.status }, { status: 502 }) };
  const data = await res.json();

  const mapped = data.results
    .map((r) => {
      const format = pickFormat(r.formats);
      if (!format) return null; // no readable text source (audio/image-only entries)
      return {
        gutenberg_id: r.id,
        title: r.title,
        author: (r.authors || []).map((a) => a.name).join(', ') || 'Unknown',
        format: format.type,
        download_count: r.download_count || 0,
      };
    })
    .filter(Boolean);

  const results = dedupeByTitleAuthor(mapped).map(({ download_count, ...rest }) => rest);
  return { results, count: data.count };
}

export async function onRequestGet({ request, env }) {
  if (!checkPin(request, env)) return unauthorized();

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  const topic = searchParams.get('topic');
  console.log('[clark debug] request.url=', request.url, 'q=', JSON.stringify(q), 'topic=', JSON.stringify(topic));
  if (!q && !topic) return json({ results: [] });

  if (topic) {
    const cacheKey = `browse:${topic}`;
    const cached = await env.BOOK_CACHE.get(cacheKey);
    if (cached) {
      const parsed = await cached.json();
      if (Date.now() - parsed.fetchedAt < BROWSE_CACHE_TTL_MS) {
        return json({ results: parsed.results, count: parsed.count }, { headers: { 'X-Cache': 'hit' } });
      }
    }

    const params = new URLSearchParams({ topic, sort: 'popular' });
    const { results, count, error } = await fetchAndShape(params);
    if (error) return error;

    await env.BOOK_CACHE.put(cacheKey, JSON.stringify({ fetchedAt: Date.now(), results, count }));
    return json({ results, count }, { headers: { 'X-Cache': 'miss' } });
  }

  const { results, count, error } = await fetchAndShape(new URLSearchParams({ search: q }));
  if (error) return error;
  return json({ results, count });
}
