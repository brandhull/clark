import { checkPin, unauthorized, json, baserow, HIGHLIGHTS_NUMBER_FIELDS } from './_utils.js';

export async function onRequestGet({ request, env }) {
  if (!checkPin(request, env)) return unauthorized();
  const { results, error } = await baserow(env, env.BASEROW_HIGHLIGHTS_TABLE_ID, { numberFields: HIGHLIGHTS_NUMBER_FIELDS }).list();
  if (error) return error;
  return json(results);
}

// `fields.book` must be an array of Books row IDs, e.g. { book: [123] } —
// that's how Baserow's API expects a link-to-table field on write.
export async function onRequestPost({ request, env }) {
  if (!checkPin(request, env)) return unauthorized();
  const fields = await request.json();
  const { row, error } = await baserow(env, env.BASEROW_HIGHLIGHTS_TABLE_ID, { numberFields: HIGHLIGHTS_NUMBER_FIELDS }).create(fields);
  if (error) return error;
  return json(row, { status: 201 });
}
