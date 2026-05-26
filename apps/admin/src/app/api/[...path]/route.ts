/**
 * Same-origin /api/* proxy — the linchpin of the SSR-auth model.
 *
 * The browser ONLY talks to admin.skydrop.online (the Next.js app).
 * Any request to /api/* lands here; we forward it to the upstream
 * API server-to-server. Cookies (the __Host-staffRefresh in
 * particular) flow through in BOTH directions:
 *
 *   - Request: the browser sends the cookie to /api/auth/staff/me;
 *     we copy the Cookie header verbatim onto the upstream fetch.
 *   - Response: when the API issues Set-Cookie (login, refresh,
 *     logout), we copy those headers back to the browser response.
 *     The browser then stores/clears the cookie bound to
 *     admin.skydrop.online — exactly as if the API were colocated.
 *
 * This is the FE-3 invariant in code form: the browser sees ONE
 * origin; the cookie is bound to that origin; the proxy moves bytes
 * between the browser and the API.
 *
 * Implementation notes:
 *   - We use a route handler (NOT next.config.mjs rewrites) so the
 *     upstream URL resolves at request time via env. Build artifacts
 *     don't bake the destination.
 *   - All methods (GET / POST / PATCH / PUT / DELETE / OPTIONS /
 *     HEAD) share the same forwarder.
 *   - We pass the full request body through (no JSON parse step) so
 *     PATCH/POST bodies + content-type are preserved.
 *   - `cache: 'no-store'` on the upstream fetch — admin data is
 *     authenticated + dynamic; never cache.
 *   - Hop-by-hop headers (connection, keep-alive, etc.) are not
 *     copied — they're hop-specific per RFC 7230.
 */

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';

// RFC 7230 hop-by-hop headers, plus a couple Next/Node ones we
// shouldn't forward to upstream.
const REQUEST_DROP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  // 'x-forwarded-*' would be useful upstream but we let the API
  // handle its own client info from the original request; if needed
  // we can add an explicit forward-for chain later.
  'content-length', // Node sets this from the body automatically
]);

const RESPONSE_DROP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-encoding', // Node already decompressed
  'content-length',
]);

async function forward(req: Request, params: { path: string[] }): Promise<Response> {
  const path = (params.path ?? []).join('/');
  const url = new URL(req.url);
  const upstream = `${API_ORIGIN}/${path}${url.search}`;

  const headers = new Headers();
  for (const [name, value] of req.headers) {
    if (REQUEST_DROP.has(name.toLowerCase())) continue;
    headers.set(name, value);
  }

  // Build body: GET/HEAD have none; others stream the original.
  const method = req.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';

  const upstreamRes = await fetch(upstream, {
    method,
    headers,
    ...(hasBody ? { body: await req.arrayBuffer() } : {}),
    cache: 'no-store',
    redirect: 'manual',
  });

  const outHeaders = new Headers();
  for (const [name, value] of upstreamRes.headers) {
    if (RESPONSE_DROP.has(name.toLowerCase())) continue;
    outHeaders.append(name, value);
  }

  // Stream the response body unchanged — preserves Set-Cookie + the
  // exact body the API produced.
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers: outHeaders,
  });
}

interface ProxyParams {
  readonly params: Promise<{ readonly path: string[] }>;
}

export async function GET(req: Request, ctx: ProxyParams): Promise<Response> {
  return forward(req, await ctx.params);
}
export async function POST(req: Request, ctx: ProxyParams): Promise<Response> {
  return forward(req, await ctx.params);
}
export async function PATCH(req: Request, ctx: ProxyParams): Promise<Response> {
  return forward(req, await ctx.params);
}
export async function PUT(req: Request, ctx: ProxyParams): Promise<Response> {
  return forward(req, await ctx.params);
}
export async function DELETE(req: Request, ctx: ProxyParams): Promise<Response> {
  return forward(req, await ctx.params);
}
export async function HEAD(req: Request, ctx: ProxyParams): Promise<Response> {
  return forward(req, await ctx.params);
}
export async function OPTIONS(req: Request, ctx: ProxyParams): Promise<Response> {
  return forward(req, await ctx.params);
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
