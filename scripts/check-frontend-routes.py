#!/usr/bin/env python3
"""
Match every frontend API call against the API's registered routes.

Run from the repo root:  python3 scripts/check-frontend-routes.py

This exists because three separate bugs in one day were all the same
shape — the API was right, the page was right, and the STRING BETWEEN
THEM was wrong:

  * 92 calls omitted the /api proxy prefix and hit Next's 404
  * the seller image upload called /seller/images; the route is
    seller/variants/:variantId/images
  * password-reset and verify-email mailed URLs to pages that did not
    exist

Unit tests cannot see this class: each side passes its own tests. Only
comparing the two finds it.

Static on purpose. Probing production is method-blind — a GET at a
POST-only path returns 404 and looks like a missing route — and probing
with the real method would mutate live data. The route table is in the
source; comparing against it is exact and free.

Reports two kinds of fault:
  NO ROUTE     the frontend calls a path+method the API does not serve
  ORPHAN       (informational) an API route no frontend calls
"""
import re, pathlib, sys
from collections import defaultdict

REPO = pathlib.Path('.')
API = REPO / 'apps/api/src'

# ── Build the API route table ────────────────────────────────────────
# A bare `@Controller()` is legal Nest and means an EMPTY prefix — the
# routes carry their full paths on the methods. Requiring a quoted string
# here dropped the whole controller silently, so its four real endpoints
# reported as NO MATCHING ROUTE and any dead one in it was unfindable.
CONTROLLER = re.compile(r"@Controller\(\s*(?:'([^']*)')?\s*\)")
METHOD = re.compile(r"@(Get|Post|Patch|Put|Delete)\(\s*(?:'([^']*)')?\s*\)")

routes = []  # (METHOD, regex, literal)
for f in API.rglob('*.controller.ts'):
    text = f.read_text()
    m = CONTROLLER.search(text)
    if not m:
        continue
    prefix = (m.group(1) or '').strip('/')
    for mm in METHOD.finditer(text):
        verb = mm.group(1).upper()
        sub = (mm.group(2) or '').strip('/')
        full = '/' + '/'.join(p for p in (prefix, sub) if p)
        # :param → one path segment
        pattern = re.sub(r':[A-Za-z0-9_]+', '[^/]+', full)
        routes.append((verb, re.compile('^' + pattern + '$'), full))


def strip_interpolations(raw: str) -> str:
    """
    Replace every `${...}` with a marker, counting braces.

    A naive `[^}]*` stops at the first `}`, which is wrong the moment an
    interpolation nests — `${c ? '' : `?s=${v}`}` is extremely common in
    these query builders and truncating it invents a path that matches
    nothing.

    An interpolation that CONTAINS a `?` is building a query string, not
    a path segment, so it collapses to nothing rather than to a segment.
    """
    out, i = [], 0
    while i < len(raw):
        if raw.startswith('${', i):
            depth, j = 1, i + 2
            while j < len(raw) and depth:
                if raw[j] == '{':
                    depth += 1
                elif raw[j] == '}':
                    depth -= 1
                j += 1
            inner = raw[i + 2 : j - 1]
            # `?` alone is not a reliable tell — `??` (nullish
            # coalescing) is everywhere in these paths and contains one.
            # Look for a real query builder instead.
            builds_query = 'qs(' in inner or '?' in inner.replace('??', '')
            out.append('' if builds_query else 'X')
            i = j
        else:
            out.append(raw[i])
            i += 1
    return ''.join(out)


# ── Extract frontend calls ───────────────────────────────────────────
CALL = re.compile(
    r"client\.request(?:<[^(]*?>)?\(\s*[`'\"](/api/[^`'\"]*)[`'\"]\s*(?:,\s*\{(.*?)\})?",
    re.S,
)
# The two dashboards are not the only callers. `packages/api-client` and
# `packages/auth` own the whole session flow (/auth/*/login, /refresh,
# /me), and apps/track calls the public tracking endpoints. Scanning only
# apps/admin + apps/seller reported all fourteen auth routes as dead.
SOURCES = [
    ('admin', REPO / 'apps/admin/src'),
    ('seller', REPO / 'apps/seller/src'),
    ('track', REPO / 'apps/track/src'),
    ('api-client', REPO / 'packages/api-client/src'),
    ('auth', REPO / 'packages/auth/src'),
]

def is_source(f) -> bool:
    """
    Tests are not callers. Adding packages/api-client to the scan brought
    its own fixtures with it — `/api/probe-a` is a stub URL in a
    single-flight-refresh test, not a route anyone serves.
    """
    parts = set(f.parts)
    if 'tests' in parts or '__tests__' in parts:
        return False
    return not any(f.name.endswith(x) for x in ('.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'))


calls = []
for app, root in SOURCES:
    if not root.exists():
        continue
    for f in list(root.rglob('*.ts')) + list(root.rglob('*.tsx')):
        if not is_source(f):
            continue
        text = f.read_text()
        for m in CALL.finditer(text):
            raw, opts = m.group(1), (m.group(2) or '')
            verb_m = re.search(r"method:\s*'(\w+)'", opts)
            verb = (verb_m.group(1) if verb_m else 'GET').upper()
            # Drop the query string, then turn interpolations into a
            # single-segment wildcard. `${qs(q)}` at the END is a query
            # builder, not a path segment — strip it rather than treat it
            # as one, or every list call looks like a different route.
            p = strip_interpolations(raw)
            p = p.split('?')[0]
            p = p[4:].rstrip('/') or '/'
            calls.append((app, verb, p, str(f).replace('apps/', '')))

# ── A SECOND, LOOSER scan, for the reverse direction only ────────────
#
# The two questions need different extractions, and using one for both is
# what made the orphan half unusable.
#
#   call -> route  needs PRECISION. Every call it finds must be a real
#                  call, or it reports a missing route that is not.
#   route -> call  needs RECALL. It must find EVERY caller, because a
#                  caller it misses is reported as a dead endpoint.
#
# The strict scan above only sees a path written as a literal directly
# inside `client.request(...)`. It cannot see a path COMPOSED by a
# builder — `opsBase(id)` returning `/api/admin/courier-ops/shipments/
# ${id}`, then used as `${opsBase(id)}/insight` — and eleven courier-ops
# endpoints with real, working callers were reported dead because of it.
#
# So for the reverse direction, take every `/api/...` path-shaped string
# anywhere in the frontend sources, however it was assembled. The trade
# is deliberate: this may credit a path that only appears in a comment,
# which loses us a true positive. A false "this is dead" is worse — it is
# noise, and noise is what stops a check from being run at all.
PATHISH = re.compile(r"['\"`](/api/[A-Za-z0-9_\-/:${}.?&=\[\]']*)")

mentioned = set()
for _app, root in SOURCES:
    if not root.exists():
        continue
    for f in list(root.rglob('*.ts')) + list(root.rglob('*.tsx')):
        if not is_source(f):
            continue
        for m in PATHISH.finditer(f.read_text()):
            raw = strip_interpolations(m.group(1)).split('?')[0]
            body = raw[4:].rstrip('/') or '/'
            mentioned.add(body)


def is_mentioned(lit: str) -> bool:
    """Does any frontend string plausibly denote this route literal?"""
    rx = re.compile('^' + re.sub(r':[A-Za-z0-9_]+', '[^/]+', lit) + '$')
    for cand in mentioned:
        for c in {cand.replace('X', 'placeholder'), cand.rstrip('X').rstrip('/') or '/'}:
            if rx.match(c):
                return True
        # And the OTHER direction: the wildcard may be on the CALL side.
        # `/api/auth/${identityKind}/login` is one string serving both
        # `/auth/staff/login` and `/auth/seller/login`, and testing only
        # route-pattern-against-call reported all fourteen auth routes as
        # dead while the client plainly calls them.
        if 'X' in cand:
            crx = re.compile('^' + re.escape(cand).replace('X', '[^/]+') + '$')
            if crx.match(lit) or crx.match(re.sub(r':[A-Za-z0-9_]+', 'p', lit)):
                return True
        # A base contributes only its PREFIX and the rest is appended
        # outside the string — either by a builder (`${opsBase(id)}/insight`)
        # or by a prop (`endpointBase="/api/seller/order-imports"` in one
        # file, `${endpointBase}/preview` in another). Credit a prefix of
        # two or more segments; one segment would credit half the API.
        base = cand.rstrip('X').rstrip('/')
        if base.count('/') >= 2 and lit.startswith(base + '/'):
            return True
    return False


# ── Compare ──────────────────────────────────────────────────────────
def matches(verb, path):
    '''
    A trailing interpolation may render as a segment OR as nothing
    (`${id ?? ''}`), so both readings are accepted rather than guessed
    at — guessing produced four false "missing route" reports.
    Returns EVERY literal the call could be, not just the first.
    Returning one was enough to answer "does this call hit something",
    but the orphan direction asks the opposite question, and crediting
    only the first match left the other reading looking uncalled:
    a call to `/seller/products/<id>` resolved to `/seller/products`
    and reported `/seller/products/:id` — a route with an obvious
    caller — as dead.
    '''
    candidates = {path.replace('X', 'placeholder')}
    if path.endswith('X'):
        candidates.add(path[:-1].rstrip('/') or '/')
    hits = []
    for v, rx, lit in routes:
        if v != verb:
            continue
        if any(rx.match(c) for c in candidates):
            hits.append(lit)
    return hits

missing = []
seen = set()
reached = set()  # route literals some frontend call resolves to
for app, verb, path, file in calls:
    key = (verb, path)
    if key in seen:
        continue
    seen.add(key)
    hits = matches(verb, path)
    if not hits:
        missing.append((app, verb, path, file))
    for lit in hits:
        reached.add((verb, lit))

# ── The reverse direction: a route nothing calls ─────────────────────
#
# This half was described in the docstring for months and never
# implemented, which is exactly why eleven unreachable capabilities had
# to be found by reading every controller against every page by hand.
# A capability with an endpoint and no caller is invisible to every
# other check we run: the API tests pass, the frontend tests pass, and
# the feature simply does not exist for anyone using the product.
#
# Not every orphan is a fault. Some routes are called by something that
# is not our two dashboards, and those are listed here BY NAME rather
# than by a clever pattern — a pattern quietly absorbs the next real
# dead end that happens to look similar.
EXPECTED_ORPHANS = {
    # Open, called by couriers / customers / probes, never by a dashboard.
    'public/', 'health', 'metrics',
    # apps/track is a separate frontend and is not scanned here.
    'public/tracking/',
    # Seller B2B integration surface: called by the SELLER's own systems
    # with an API key. A dashboard caller would be the surprise.
    'v1/',
    # Decided, not overlooked: the seller-addresses screen was REMOVED on
    # purpose (we do not store a seller's own address — goods ship to our
    # Indian warehouse, and the pickup location is ours). The endpoints
    # are kept for the existing rows; nothing should call them.
    'seller/addresses',
    # Superseded, not missing: GET /admin/courier-escalation/channel
    # already returns the same OpsQueueCounts, and the console reads it
    # from there. A second caller for the same five numbers would be a
    # second thing to keep in step, not a feature.
    'admin/courier-escalation/outbox/counts',
}

def expected(lit: str) -> bool:
    body = lit.lstrip('/')
    return any(body == e or body.startswith(e) for e in EXPECTED_ORPHANS)

orphans = sorted(
    {(v, lit) for v, _rx, lit in routes} - reached,
    key=lambda t: (t[1], t[0]),
)
orphans = [
    (v, lit) for v, lit in orphans if not expected(lit) and not is_mentioned(lit)
]

print(f"api routes registered : {len(routes)}")
print(f"distinct frontend calls: {len(seen)}")
print()
if missing:
    print(f"NO MATCHING ROUTE ({len(missing)}):")
    for app, verb, path, file in sorted(missing):
        print(f"  {verb:<6} {path:<58} {app}  {file.split('/src/')[-1]}")
    print()
else:
    print("every frontend call matches a registered API route")

if orphans:
    # INFORMATIONAL — deliberately not a build failure.
    #
    # This direction cannot be made precise the way the other one can. To
    # say "nothing calls this" you must find EVERY caller, and a path
    # assembled from a builder, a prop, or a helper is invisible to a
    # static string scan however hard it is chased. A gate that fails on
    # a call it simply could not see teaches people to skip the gate.
    #
    # So it prints. The list is a place to LOOK, not a verdict — and it
    # is worth looking, because every one of the eleven capabilities that
    # shipped with no screen would have appeared here first.
    print(f"NO OBVIOUS CALLER ({len(orphans)}) — informational, not a failure:")
    for verb, lit in orphans:
        print(f"  {verb:<6} {lit}")
    print()
    print("  A route here is EITHER unreachable in the product OR called")
    print("  through a composed path this scan cannot see. Check before")
    print("  believing it; build the screen if it is real.")
else:
    print("every API route has an obvious caller")

# Only the call -> route direction gates. It is exact: every call it finds
# is a real call, so a miss is a real bug.
sys.exit(1 if missing else 0)
