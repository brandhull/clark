import { checkPin, unauthorized, json, baserow, HIGHLIGHTS_NUMBER_FIELDS } from '../_utils.js';

export async function onRequestPatch({ request, env, params }) {
  if (!checkPin(request, env)) return unauthorized();
  const fields = await request.json();
  const { row, error } = await baserow(env, env.BASEROW_HIGHLIGHTS_TABLE_ID, { numberFields: HIGHLIGHTS_NUMBER_FIELDS }).update(params.id, fields);
  if (error) return error;
  return json(row);
}

export async function onRequestDelete({ request, env, params }) {
  if (!checkPin(request, env)) return unauthorized();
  const { error } = await baserow(env, env.BASEROW_HIGHLIGHTS_TABLE_ID, { numberFields: HIGHLIGHTS_NUMBER_FIELDS }).remove(params.id);
  if (error) return error;
  return new Response(null, { status: 204 });
}
