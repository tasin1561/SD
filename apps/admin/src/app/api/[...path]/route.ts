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
  // The CLIENT does not get to say who it is.
  //
  // `client-info.decorator.ts` reads the LEFTMOST value of
  // `x-forwarded-for` for `audit_logs.metadata.ipAddress`, and Caddy
  // rewrites that header from `CF-Connecting-IP` on the real hop — so a
  // browser-supplied copy arriving through this proxy would be prepended
  // to the chain and become the address every audit row records. The
  // throttler is unaffected (it uses `req.ip` with `trust proxy: 1`),
  // which is exactly why this would be silent: the forged address only
  // shows up in the trail somebody reads afterwards.
  'x-forwarded-for',
  'x-real-ip',
  'forwarded',
  // The BROWSER's accept-encoding, not ours.
  //
  // We strip `content-encoding` off the response below on the grounds
  // that undici already decompressed it — true for gzip, deflate and
  // br, which is everything undici negotiates for itself. It is NOT
  // true for anything else the browser happens to advertise: forward
  // `zstd` and a CDN will answer in zstd, undici will hand the bytes
  // through untouched, and we then tell the browser it is plain JSON.
  // The failure is silent and total — every response body arrives as
  // binary noise, so the access token cannot be read out of a refresh
  // and every authenticated call 401s with nothing in the log to say
  // why. Dropping the header lets undici ask for what it can decode.
  'accept-encoding',
]);

const RESPONSE_DROP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-encoding', // Node already decompressed
  'content-length',
  // CORS is the UPSTREAM's answer to a question this proxy never asked.
  //
  // Every browser request here is same-origin (FE-3), so the browser
  // enforces nothing from these headers — but relaying them publishes
  // the API's cross-origin policy on OUR origin, where it is neither
  // checked nor meant to apply, and an `Allow-Origin: *` alongside
  // `Allow-Credentials` would be read as this app's own posture. The
  // proxy does no `Origin` check of its own and should not appear to.
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-expose-headers',
  'access-control-max-age',
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
