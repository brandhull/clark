import { checkPin, unauthorized, json, baserow, BOOKS_NUMBER_FIELDS } from '../_utils.js';

export async function onRequestPatch({ request, env, params }) {
  if (!checkPin(request, env)) return unauthorized();
  const fields = await request.json();
  const { row, error } = await baserow(env, env.BASEROW_BOOKS_TABLE_ID, { numberFields: BOOKS_NUMBER_FIELDS }).update(params.id, fields);
  if (error) return error;
  return json(row);
}
