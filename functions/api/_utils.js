export function checkPin(request, env) {
  const pin = request.headers.get('X-Pin');
  return pin && pin === env.PIN;
}

export function unauthorized() {
  return new Response('Unauthorized', { status: 401 });
}

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}

/**
 * Given a Gutendex `formats` map, prefer an HTML source and fall back to
 * plaintext. Keys are MIME types with charset suffixes (e.g.
 * "text/plain; charset=us-ascii"), so match by prefix, not equality.
 */
export function pickFormat(formats) {
  const keys = Object.keys(formats || {});
  const html = keys.find((k) => k.startsWith('text/html'));
  if (html) return { type: 'html', url: formats[html] };
  const plainKeys = keys.filter((k) => k.startsWith('text/plain'));
  const plain = plainKeys.find((k) => k.includes('utf-8')) || plainKeys[0];
  if (plain) return { type: 'text', url: formats[plain] };
  return null;
}

async function baserowError(res, context) {
  const text = await res.text();
  console.log(`Baserow error (${context})`, res.status, text);
  return json({ error: 'baserow', status: res.status }, { status: 502 });
}

/**
 * Baserow's REST API (even with user_field_names=true) doesn't return plain
 * JS primitives: single_select fields come back as {id, value, color},
 * link_row fields as an array of {id, value, order}, and number fields as
 * strings. Flatten those to what a client actually wants — a plain string
 * for select fields, a plain array of linked row ids for link fields.
 * Number-string-to-Number conversion is done per-field (not generically —
 * a text field could legitimately hold an all-digit string, e.g. a book
 * titled "1984") via the caller-supplied `numberFields` list.
 */
function normalizeValue(v) {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) {
    if (v.length && v[0] && typeof v[0] === 'object' && 'id' in v[0]) {
      return v.map((item) => item.id); // link_row -> plain array of linked row ids
    }
    return v;
  }
  if (typeof v === 'object' && 'value' in v) return v.value; // single_select -> plain string
  return v;
}

function normalizeRow(row, numberFields) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = normalizeValue(v);
  for (const field of numberFields) {
    if (out[field] !== null && out[field] !== undefined) out[field] = Number(out[field]);
  }
  return out;
}

/**
 * Minimal Baserow REST client scoped to one table.
 * `next` comes back as http:// even over https, which makes fetch() drop
 * the Authorization header on redirect — always rewrite before following it.
 */
export function baserow(env, tableId, { numberFields = [] } = {}) {
  const baseUrl = env.BASEROW_API_URL || 'https://api.baserow.io';
  const headers = { Authorization: `Token ${env.BASEROW_TOKEN}`, 'Content-Type': 'application/json' };

  async function list() {
    const results = [];
    let url = `${baseUrl}/api/database/rows/table/${tableId}/?user_field_names=true&size=200`;
    while (url) {
      const res = await fetch(url, { headers });
      if (!res.ok) return { error: await baserowError(res, 'list') };
      const data = await res.json();
      results.push(...data.results);
      url = data.next ? data.next.replace(/^http:/, 'https:') : null;
    }
    return { results: results.map((r) => normalizeRow(r, numberFields)) };
  }

  async function create(fields) {
    const res = await fetch(`${baseUrl}/api/database/rows/table/${tableId}/?user_field_names=true`, {
      method: 'POST',
      headers,
      body: JSON.stringify(fields),
    });
    if (!res.ok) return { error: await baserowError(res, 'create') };
    return { row: normalizeRow(await res.json(), numberFields) };
  }

  async function update(id, fields) {
    const res = await fetch(`${baseUrl}/api/database/rows/table/${tableId}/${id}/?user_field_names=true`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(fields),
    });
    if (!res.ok) return { error: await baserowError(res, 'update') };
    return { row: normalizeRow(await res.json(), numberFields) };
  }

  async function remove(id) {
    const res = await fetch(`${baseUrl}/api/database/rows/table/${tableId}/${id}/`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok && res.status !== 204) return { error: await baserowError(res, 'delete') };
    return { ok: true };
  }

  return { list, create, update, remove };
}

export const BOOKS_NUMBER_FIELDS = ['gutenberg_id', 'last_block_index'];
export const HIGHLIGHTS_NUMBER_FIELDS = ['highlight_id', 'block_index'];
