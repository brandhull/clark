import { checkPin, unauthorized, json } from './_utils.js';

export async function onRequestGet({ request, env }) {
  if (!checkPin(request, env)) return unauthorized();
  return json({ ok: true });
}
