import { checkPin, unauthorized, json, pickFormat } from './_utils.js';

// Gutendex requires the trailing slash on /books/ — without it you get a 301.
const GUTENDEX_BASE = 'https://gutendex.com/books/';

export async function onRequestGet({ request, env }) {
  if (!checkPin(request, env)) return unauthorized();

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  if (!q) return json({ results: [] });

  const res = await fetch(`${GUTENDEX_BASE}?search=${encodeURIComponent(q)}`);
  if (!res.ok) return json({ error: 'gutendex', status: res.status }, { status: 502 });
  const data = await res.json();

  const results = data.results
    .map((r) => {
      const format = pickFormat(r.formats);
      if (!format) return null; // no readable text source (audio/image-only entries)
      return {
        gutenberg_id: r.id,
        title: r.title,
        author: (r.authors || []).map((a) => a.name).join(', ') || 'Unknown',
        format: format.type,
      };
    })
    .filter(Boolean);

  return json({ results, count: data.count });
}
