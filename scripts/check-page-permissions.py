#!/usr/bin/env python3
"""
Every page asks only for what its visitor may have.

── WHAT THIS CATCHES ────────────────────────────────────────────────────
A page is reachable by whoever holds the permission it is gated on. If it
then fires a query needing a DIFFERENT permission, anybody holding only
the gate gets a 403 they did nothing to cause — a red box on a page that
is working exactly as designed.

It happened twice for real. A call agent opened the admin dashboard and
was met with "403 — does not hold reports.view" plus two tiles stuck as
grey rectangles, because a tile whose request failed only knows how to
show a skeleton. A seller VIEWER got the same on their own landing page.
Both times nothing was broken: the server refused correctly, the error
surfaced verbatim as FE-2 requires, and the page was simply asking for
things its viewer was never allowed to have.

The same applies to a write button on a read-gated page — it looks
available and refuses on click.

── HOW IT DECIDES ───────────────────────────────────────────────────────
For each page it resolves:
  its GATE            from the app's page-access.ts
  what it CALLS       the query/mutation hooks its own files reference
  what each NEEDS     from the @Require*Permissions the endpoint declares

Anything needing more than the gate must be GATED IN CODE, and "gated"
means the permission STRING appears literally in the page's own files or
in the body of the hook itself — which is exactly what `can(identity,
'x')` and `usePermission('x')` contain. Checking for the specific
permission rather than for "does this file mention permissions anywhere"
is what makes the check trustworthy enough to block a build.

── ITS LIMITS, STATED ───────────────────────────────────────────────────
It reads source, not a running app, so it knows what is DECLARED.

Three earlier versions were wrong, and every one of them was wrong by
passing — which is the only way a check can fail that nobody notices:

  - Sweeping a page directory with rglob picked up CHILD routes, so
    /call-center was blamed for queries belonging to /call-center/queue.
    Each page is scoped to its own files now.
  - Deciding a page was "gated" because it mentioned permissions
    ANYWHERE. It now looks for the specific permission, which found nine
    more real gaps in apps/admin the moment it was tightened.
  - Reading a hook URL with one regex, which broke on nested template
    literals and on `??` inside an interpolation. Both produced "no
    endpoint matched", which was then SKIPPED — so the check passed a
    dashboard whose gate had been deliberately deleted.

That last one is why anything unmatched is now COUNTED AND PRINTED
rather than passed over. If this check ever reports zero problems and a
long list of unmatched calls, it is not telling you the app is fine.

Verified to fail on a real regression, not just to pass today: deleting
the dashboard's `reports.view` gate, and the FX page's `fx.manage` gate,
each make it exit 1.
"""

from __future__ import annotations

import collections
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

APPS = [
    {
        "name": "admin",
        "app": "apps/admin",
        "guard": "StaffJwtGuard",
        "decorator": "RequirePermissions",
        "self_service": "StaffSelfService",
    },
    {
        "name": "seller",
        "app": "apps/seller",
        "guard": "SellerJwtGuard",
        "decorator": "RequireSellerPermissions",
        "self_service": "SellerSelfService",
    },
]

HTTP = "Get|Post|Patch|Put|Delete"


def controller_routes(guard: str, decorator: str, self_service: str):
    """(path, METHOD, [permissions]) for every handler behind `guard`."""
    files = subprocess.run(
        ["grep", "-rl", guard, "apps/api/src", "--include=*.controller.ts"],
        capture_output=True,
        text=True,
        cwd=ROOT,
    ).stdout.split()
    out = []
    for f in files:
        src = (ROOT / f).read_text()
        prefix = re.search(r"@Controller\('([^']*)'\)", src)
        if prefix is None:
            continue
        prefix = prefix.group(1)
        is_self = f"\n@{self_service}()" in src
        cls = re.search(rf"\n@{decorator}\(([^)]*)\)", src)
        cls_perms = re.findall(r"'([^']+)'", cls.group(1)) if cls else []
        for block in re.split(rf"\n  (?=@(?:{HTTP})\()", src)[1:]:
            head = re.match(rf"@({HTTP})\('?([^')]*)'?", block)
            if head is None:
                continue
            own = re.search(rf"\n  @{decorator}\(([^)]*)\)", block)
            perms = re.findall(r"'([^']+)'", own.group(1)) if own else cls_perms
            path = ("/" + prefix + ("/" + head.group(2) if head.group(2) else "")).replace(
                "//", "/"
            )
            out.append((path, head.group(1).upper(), ["SELF"] if is_self else perms))
    return out


def perms_for(routes, url: str, method: str):
    """Longest controller-path match wins; `:param` segments are wildcards."""
    parts = [p for p in url.split("?")[0].strip("/").split("/") if p != ""]
    best, best_len = None, -1
    for path, m, perms in routes:
        if m != method:
            continue
        fp = [p for p in path.strip("/").split("/") if p != ""]
        if len(fp) > len(parts):
            continue
        matched = all(fp[i].startswith(":") or fp[i] == parts[i] for i in range(len(fp)))
        if matched and len(fp) > best_len:
            best, best_len = perms, len(fp)
    return best


def endpoint_path(body: str) -> str | None:
    """
    The API path a hook calls, as the router would see it.

    Getting this right is the difference between a check and a
    decoration. An earlier version read the URL with one regex and was
    wrong twice over:

      - `/admin/reports/summary${sp ? `?${sp}` : ''}` — a NESTED template
        literal, whose inner backtick ended the match early.
      - `/admin/tickets${qs(query)}` — a QUERY STRING turned into a fake
        path segment `/admin/tickets:param`, matching no route.

    Both produced "no route found", which the check then SKIPPED. It
    passed a deliberately broken dashboard because of it.

    So: a `${...}` directly after a slash is a path parameter; anything
    else ends the path.
    """
    at = body.find("/api/")
    if at == -1:
        return None
    raw = body[at:]
    # ORDER MATTERS. Path parameters are substituted FIRST, because an
    # interpolation can contain the characters every later step cuts on:
    # `${sellerId ?? ''}` holds both a `?` and a quote, and cutting at
    # either produced a path matching no route — which the check then
    # skipped in silence.
    raw = re.sub(r"/\$\{[^}]*\}", "/:param", raw)  # /${id} is a segment
    raw = raw.split("?")[0]                      # a real query string ends it
    raw = re.split(r"\$\{", raw)[0]               # any other ${…} ends it
    raw = re.split(r"[\s'\"`,)]", raw)[0]
    return raw[len("/api") :].rstrip("/") or "/"


def app_hooks(app: str):
    """hook name → (url, METHOD, is_query, body), plus what could not be read."""
    hooks = {}
    unreadable = []
    for lib in sorted((ROOT / app / "src/lib").glob("*.ts")):
        src = lib.read_text()
        for block in re.split(r"\nexport function ", src)[1:]:
            name = re.match(r"(\w+)", block)
            if name is None:
                continue
            body = block.split("\nexport ")[0]
            if "/api/" not in body:
                continue
            path = endpoint_path(body)
            if path is None:
                unreadable.append(name.group(1))
                continue
            method = "GET"
            m = re.search(r"method: '(\w+)'", body)
            if m:
                method = m.group(1).upper()
            hooks[name.group(1)] = (path, method, "useQuery(" in body, body)
    return hooks, unreadable


def page_gates(app: str):
    src = (ROOT / app / "src/lib/page-access.ts").read_text()
    return dict(re.findall(r"\['([^']+)', '([^']+)'\]", src))


def audit(spec) -> list[str]:
    app = spec["app"]
    routes = controller_routes(spec["guard"], spec["decorator"], spec["self_service"])
    hooks, unreadable = app_hooks(app)
    gates = page_gates(app)

    pages = sorted((ROOT / app / "src/app/(authed)").rglob("page.tsx"))
    page_dirs = {p.parent for p in pages}
    problems: list[str] = []
    unmatched: set[str] = set()
    checked = 0

    for page in pages:
        rel = page.parent.relative_to(ROOT / app / "src/app/(authed)")
        route = "/" + re.sub(r"/\[[^\]]+\]", "/:id", str(rel).replace("\\", "/"))

        # This page's OWN files. A nested route is its own page with its
        # own gate; sweeping into it attributes its calls here.
        own_files = [
            f
            for f in list(page.parent.rglob("*.tsx")) + list(page.parent.rglob("*.ts"))
            if not any(d != page.parent and d in f.parents for d in page_dirs)
        ]
        own_src = "\n".join(f.read_text() for f in own_files)

        gate, gate_len = None, -1
        for prefix, perm in gates.items():
            if route == prefix or route.startswith(prefix + "/"):
                if len(prefix) > gate_len:
                    gate, gate_len = perm, len(prefix)

        for name in sorted(hooks):
            if not re.search(rf"\b{name}\(", own_src):
                continue
            path, method, is_query, body = hooks[name]
            needed = perms_for(routes, path, method)
            if needed == ["SELF"]:
                continue
            if needed is None:
                # No endpoint matched. Counted and reported rather than
                # skipped in silence — a check that quietly ignores what
                # it cannot parse is a check that passes for the wrong
                # reason, which is how this one first passed a broken
                # dashboard.
                unmatched.add(f"{name}() → {method} {path}")
                continue
            checked += 1
            for perm in needed:
                if gate is not None and perm == gate:
                    continue
                # Gated when the permission is named in the page, or
                # inside the hook itself (a self-gating lookup).
                if f"'{perm}'" in own_src or f"'{perm}'" in body:
                    continue
                kind = "query" if is_query else "action"
                problems.append(
                    f"  {spec['name']:7} {route:26} gate={str(gate):24} "
                    f"{kind} {name}() needs '{perm}'"
                )

    print(
        f"{spec['name']}: {len(pages)} pages, {len(hooks)} hooks, "
        f"{checked} permission-bearing calls checked"
    )
    if unreadable:
        print(f"  hooks whose URL could not be read ({len(unreadable)}): {', '.join(sorted(unreadable)[:6])}")
    if unmatched:
        print(f"  calls matching no endpoint ({len(unmatched)}):")
        for u in sorted(unmatched)[:12]:
            print(f"    {u}")
    return problems


def main() -> int:
    all_problems: list[str] = []
    for spec in APPS:
        all_problems.extend(audit(spec))

    if not all_problems:
        print("\nEvery page asks only for what its gate allows, or gates the difference in code.")
        return 0

    queries = [p for p in all_problems if " query " in p]
    print(f"\n{len(all_problems)} call(s) need more than their page's gate and are not gated:\n")
    print("\n".join(all_problems))
    print(
        "\nFix by gating the call in code — `usePermission('x')` / `can(identity, 'x')`,"
        "\npassed to the query's `enabled` as well, so a request nobody may make is never"
        "\nsent rather than sent and hidden. If the page genuinely needs that permission,"
        "\nput it in the app's page-access.ts instead so the nav hides the page too."
    )
    if queries:
        print(
            f"\n{len(queries)} of these fire ON LOAD — somebody sees a 403 for doing nothing."
        )
    return 1


if __name__ == "__main__":
    sys.exit(main())
