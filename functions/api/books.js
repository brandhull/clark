import { checkPin, unauthorized, json, baserow, BOOKS_NUMBER_FIELDS } from './_utils.js';

export async function onRequestGet({ request, env }) {
  if (!checkPin(request, env)) return unauthorized();
  const { results, error } = await baserow(env, env.BASEROW_BOOKS_TABLE_ID, { numberFields: BOOKS_NUMBER_FIELDS }).list();
  if (error) return error;
  return json(results);
}

export async function onRequestPost({ request, env }) {
  if (!checkPin(request, env)) return unauthorized();
  const fields = await request.json();
  const { row, error } = await baserow(env, env.BASEROW_BOOKS_TABLE_ID, { numberFields: BOOKS_NUMBER_FIELDS }).create(fields);
  if (error) return error;
  return json(row, { status: 201 });
}
