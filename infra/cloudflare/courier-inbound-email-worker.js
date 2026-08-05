/**
 * Cloudflare Email Worker — forwards courier ticket mail into the API.
 *
 * Deployed by hand (see infra/cloudflare/README.md). It lives in the
 * repo because a Worker pasted into a dashboard is a piece of production
 * with no history, no review and no way to answer "what changed?".
 *
 * WHAT IT DOES
 *   1. Receives a message addressed to the dedicated courier mailbox.
 *   2. Extracts subject / text / html / Message-ID / Date.
 *   3. Signs the exact JSON bytes with HMAC-SHA256.
 *   4. POSTs to the API's inbound-email endpoint.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   - Parse the ticket id. That is the API's job, it is a GUESS that will
 *     need correcting against real mail, and correcting it should not
 *     require redeploying a Worker.
 *   - Rewrite the body. The seller is meant to read what the courier
 *     wrote; anything that edits text here is invisible downstream.
 *   - Retry on 4xx. A rejected message is rejected for a reason (bad
 *     signature, unparsable) and retrying it just repeats the failure.
 *
 * SECRETS (wrangler secret put)
 *   SKYDROP_INBOUND_SECRET — must equal COURIER_INBOUND_EMAIL_SECRET in
 *                            the API's environment.
 * VARS (wrangler.toml)
 *   SKYDROP_API_URL — https://api.skydrop.online/public/courier/inbound-email
 */

/** Read a ReadableStream to a string, capped so one huge mail cannot OOM. */
async function readCapped(stream, limitBytes) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limitBytes) break;
    chunks.push(value);
  }
  return new TextDecoder().decode(
    chunks.reduce(
      (acc, c) => {
        acc.set(c, acc.offset);
        acc.offset += c.length;
        return acc;
      },
      Object.assign(new Uint8Array(Math.min(total, limitBytes)), { offset: 0 }),
    ),
  );
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sign(body, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
}

export default {
  async email(message, env, ctx) {
    // 1 MB of message is far more than a support notification; beyond
    // that we are being fed something, not written to.
    const raw = await readCapped(message.raw, 1_000_000);

    // Split headers from body at the first blank line, then pull the
    // parts we forward. Deliberately minimal: a full MIME parser here
    // would be a dependency in a place that must not fail.
    const sep = raw.indexOf('\r\n\r\n');
    const headerBlock = sep === -1 ? raw : raw.slice(0, sep);
    const bodyBlock = sep === -1 ? '' : raw.slice(sep + 4);

    const header = (name) => {
      const m = new RegExp(`^${name}:\\s*(.*)$`, 'im').exec(headerBlock);
      return m ? m[1].trim() : undefined;
    };

    const contentType = (header('content-type') ?? '').toLowerCase();
    const isHtml = contentType.includes('text/html');

    const payload = {
      from: message.from,
      to: message.to,
      subject: message.headers.get('subject') ?? header('subject') ?? '',
      // One of the two, never both invented. The API prefers text.
      ...(isHtml ? { html: bodyBlock } : { text: bodyBlock }),
      messageId: message.headers.get('message-id') ?? header('message-id'),
      // The courier's own Date:, not our receipt time.
      receivedAt: (() => {
        const d = message.headers.get('date') ?? header('date');
        if (!d) return undefined;
        const parsed = new Date(d);
        return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
      })(),
    };
    // Drop undefined keys: the API runs forbidNonWhitelisted and an
    // explicit `undefined` serialises away anyway — this keeps the
    // signed bytes stable and the intent obvious.
    for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];

    // Sign the EXACT bytes that will be sent. Serialise once, sign that
    // string, post that string — never re-stringify between the two.
    const body = JSON.stringify(payload);
    const signature = await sign(body, env.SKYDROP_INBOUND_SECRET);

    const res = await fetch(env.SKYDROP_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-skydrop-signature': signature,
      },
      body,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      // Throwing tells Cloudflare the message was not handled, which
      // surfaces it in the Worker's error log rather than losing it
      // quietly. 4xx is not retried by us; it is a bug to fix.
      throw new Error(`Skydrop inbound-email rejected: ${res.status} ${detail.slice(0, 300)}`);
    }
  },
};
