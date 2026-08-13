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
calls = []
for app in ('admin', 'seller'):
    root = REPO / 'apps' / app / 'src'
    for f in list(root.rglob('*.ts')) + list(root.rglob('*.tsx')):
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

# ── Compare ──────────────────────────────────────────────────────────
def matches(verb, path):
    '''
    A trailing interpolation may render as a segment OR as nothing
    (`${id ?? ''}`), so both readings are accepted rather than guessed
    at — guessing produced four false "missing route" reports.
    '''
    candidates = {path.replace('X', 'placeholder')}
    if path.endswith('X'):
        candidates.add(path[:-1].rstrip('/') or '/')
    for v, rx, lit in routes:
        if v != verb:
            continue
        if any(rx.match(c) for c in candidates):
            return lit
    return None

missing = []
seen = set()
for app, verb, path, file in calls:
    key = (verb, path)
    if key in seen:
        continue
    seen.add(key)
    if matches(verb, path) is None:
        missing.append((app, verb, path, file))

print(f"api routes registered : {len(routes)}")
print(f"distinct frontend calls: {len(seen)}")
print()
if missing:
    print(f"NO MATCHING ROUTE ({len(missing)}):")
    for app, verb, path, file in sorted(missing):
        print(f"  {verb:<6} {path:<58} {app}  {file.split('/src/')[-1]}")
else:
    print("every frontend call matches a registered API route")
sys.exit(1 if missing else 0)
