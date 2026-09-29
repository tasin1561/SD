/**
 * The one HTTP helper the seeding uses.
 *
 * Extracted from `seed-demo-data.mjs` when the lifecycle pass needed the
 * same thing: two copies would have meant two error formats, and the
 * error format is the whole value of this function. A failure here is a
 * seed dying forty calls in, and "POST /seller/orders → 400 {…}" is the
 * difference between a fix and an afternoon.
 */
export const API = process.env.SKYDROP_API_URL ?? 'http://127.0.0.1:4000';

export async function call(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.token === undefined ? {} : { authorization: `Bearer ${init.token}` }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${text.slice(0, 400)}`);
  }
  return text === '' ? {} : JSON.parse(text);
}

/** Wait for `check()` to answer non-null, or give up saying what it wanted. */
export async function waitFor(what, check, { tries = 30, everyMs = 1000 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    const got = await check();
    if (got !== null && got !== undefined) return got;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`Gave up waiting for ${what} after ${(tries * everyMs) / 1000}s`);
}
