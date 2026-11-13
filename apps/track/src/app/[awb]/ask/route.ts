import { apiOrigin } from '@/lib/api-origin';

/**
 * Same-origin bridge for the "Ask about this parcel" chat (FE-3: the browser
 * never calls the API origin). The AWB is the page's own route segment; the
 * body is re-built field by field, so nothing else the browser sends reaches
 * the API.
 *
 * It also holds a per-visitor limit IN FRONT of the API's own throttles. The
 * API sees this server's address, not the visitor's, so only here can one
 * visitor be told apart (the address is the one Caddy sets from
 * CF-Connecting-IP, never a value the browser can choose).
 */
export const dynamic = 'force-dynamic';

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 6;
const MAX_TRACKED = 5_000;
const hits = new Map<string, number[]>();

function limited(ip: string, now: number): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > MAX_TRACKED) {
    for (const [k, v] of hits) {
      if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
    }
  }
  return false;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export async function POST(
  req: Request,
  ctx: { params: Promise<{ awb: string }> },
): Promise<Response> {
  const { awb } = await ctx.params;
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (limited(forwarded ?? 'unknown', Date.now())) return json(429, { code: 'TOO_MANY' });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json(400, { code: 'BAD_BODY' });
  }
  if (raw === null || typeof raw !== 'object') return json(400, { code: 'BAD_BODY' });
  const b = raw as Record<string, unknown>;
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  const visitorKey = typeof b.visitorKey === 'string' ? b.visitorKey : '';
  const conversationId = typeof b.conversationId === 'string' ? b.conversationId : undefined;
  if (text.length === 0 || text.length > 300 || !UUID.test(visitorKey)) {
    return json(400, { code: 'BAD_BODY' });
  }
  if (conversationId !== undefined && !UUID.test(conversationId)) {
    return json(400, { code: 'BAD_BODY' });
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${apiOrigin()}/public/parcel-assistant/${encodeURIComponent(decodeURIComponent(awb))}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          text,
          visitorKey,
          ...(conversationId === undefined ? {} : { conversationId }),
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(60_000),
      },
    );
  } catch {
    return json(502, { code: 'UNAVAILABLE' });
  }
  if (!upstream.ok || upstream.body === null) {
    // 404 / 429 / 4xx pass through as a bare status: the page has its own words.
    return json(upstream.status === 404 || upstream.status === 429 ? upstream.status : 502, {
      code: 'UNAVAILABLE',
    });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
