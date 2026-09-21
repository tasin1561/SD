#!/usr/bin/env bash
# Lighthouse MOBILE (simulated Slow 4G, 4× CPU — Lighthouse's default mobile
# throttling) against an EXISTING preview build, on ONE static server that
# is killed on every exit path. Prints the four scores and the vitals per URL.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3999}"
if ss -ltn 2>/dev/null | grep -q ":${PORT} "; then echo "port ${PORT} is busy — refusing to start"; exit 2; fi
OUT="${LH_OUT:-scripts/screenshots/lighthouse}"; mkdir -p "$OUT"
export CHROME_PATH="$(node -e "console.log(require('playwright').chromium.executablePath())")"
SERVER_PID=""
cleanup() { if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then kill "$SERVER_PID" 2>/dev/null || true; sleep 1; kill -9 "$SERVER_PID" 2>/dev/null || true; fi; }
trap cleanup EXIT INT TERM
node ../../scripts/serve-static.mjs out "$PORT" > "$OUT/serve.log" 2>&1 & SERVER_PID=$!
for i in $(seq 1 30); do sleep 1; curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PORT}/" | grep -q 200 && break; done
for r in "${@:-dev/hero-only ''}"; do
  n=$([ -z "$r" ] && echo root || echo "$(echo "$r" | tr '/' '-')")
  npx --yes lighthouse@12 "http://localhost:${PORT}/$r" --quiet \
    --chrome-flags="--headless=new --no-sandbox" \
    --form-factor=mobile --screenEmulation.mobile --throttling-method=simulate \
    --only-categories=performance,accessibility,best-practices,seo \
    --output=json --output=html --output-path="$OUT/$n" >/dev/null 2>&1 || true
  node -e '
    const r = require(require("path").resolve(process.argv[1])); const c = r.categories; const a = r.audits;
    const s = (k) => Math.round(c[k].score * 100);
    console.log(process.argv[2], "perf", s("performance"), "a11y", s("accessibility"), "bp", s("best-practices"), "seo", s("seo"));
    console.log("  LCP", a["largest-contentful-paint"].displayValue, "FCP", a["first-contentful-paint"].displayValue, "CLS", a["cumulative-layout-shift"].displayValue, "TBT", a["total-blocking-time"].displayValue, "SI", a["speed-index"].displayValue);
    const el = a["largest-contentful-paint-element"]; const it = el?.details?.items?.[0]; const node = it?.items?.[0]?.node ?? it?.node;
    console.log("  LCP element:", (node?.snippet ?? "?").slice(0, 140));
    const fails = Object.values(a).filter((x) => x.score !== null && x.score < 0.9 && x.scoreDisplayMode === "binary" || (x.score !== null && x.score < 0.9 && x.scoreDisplayMode === "numeric")).map((x) => x.id + ":" + x.score);
    console.log("  <0.9:", fails.join(", ") || "none");
  ' "$OUT/$n.report.json" "$n"
done
