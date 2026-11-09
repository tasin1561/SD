#!/usr/bin/env node
/*
  One live call to Solustation Address, to prove the key in the server's
  own `.env` works.

  ── WHY THIS IS A SCRIPT AND NOT A COMMAND SOMEBODY PASTES ────────────
  The key must never reach a terminal transcript, a chat log or an agent's
  context. So this reads `.env` itself and prints only the first 8
  characters — the same prefix Solustation stores alongside the hash, and
  the only part of a key that is safe to say out loud. There is no flag to
  make it print more.

  Usage:  node scripts/solustation-probe.mjs [--pincode 743383]

  It spends ONE billable unit the first time a given reference_id is used
  in a month; re-running it the same month is free and returns the stored
  answer (`billable: false`), which is why the reference is stable per day
  rather than random.
*/
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env reader — no dependency, no export into the environment. */
function readEnvFile(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const out = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

/*
  The app's env lives in `apps/api/.env`, not at the repo root — the root
  only ships an `.env.example`. Searched in the order the app itself would
  resolve them, and the file that supplied the key is reported by PATH, so
  a wrong-file mistake is visible without anybody printing a value.
*/
const ENV_FILES = ['apps/api/.env.local', 'apps/api/.env', '.env'];
const loaded = ENV_FILES.map((rel) => ({ rel, vars: readEnvFile(resolve(ROOT, rel)) }));

const pick = (...names) => {
  for (const n of names) {
    const fromProcess = (process.env[n] ?? '').trim();
    if (fromProcess !== '') return { name: n, value: fromProcess, from: 'process env' };
    for (const { rel, vars } of loaded) {
      const v = (vars[n] ?? '').trim();
      if (v !== '') return { name: n, value: v, from: rel };
    }
  }
  return { name: names[0], value: '', from: null };
};

// Both spellings accepted: the brief of 2026-11-03 names
// SOLUSTATION_ADDRESS_*, the module shipped earlier reads SOLADDR_API_KEY.
const key = pick('SOLUSTATION_ADDRESS_KEY', 'SOLADDR_API_KEY');
const url = pick('SOLUSTATION_ADDRESS_URL', 'SOLADDR_BASE_URL');
const base = (url.value || 'https://address-api.solustation.site').replace(/\/+$/, '');

if (key.value === '') {
  console.error(
    'No key found. Looked for SOLUSTATION_ADDRESS_KEY then SOLADDR_API_KEY, in the\n' +
      `process environment and then in: ${ENV_FILES.join(', ')}`,
  );
  process.exit(1);
}

const pincodeArg = process.argv.indexOf('--pincode');
const pincode = pincodeArg === -1 ? '743383' : (process.argv[pincodeArg + 1] ?? '743383');

// Stable per day: a re-run inside the same day is free and returns the
// stored answer, so repeated probing cannot quietly spend units.
const day = new Date().toISOString().slice(0, 10);
const referenceId = `SKY-PROBE-${day}`;

/*
  No name, no phone, no email — the request is built field by field from
  named scalars for the same reason the API client is (an unknown field
  is a 422, and a leaked one would be a privacy incident).
*/
const body = {
  reference_id: referenceId,
  address: 'H.No 12, near Hanuman Mandir, Vill Raydighi',
  pincode: String(pincode),
  landmark: 'Hanuman Mandir',
  payment_type: 'cod',
};

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 3_000);
const started = Date.now();

let res;
let parsed = null;
let transportError = null;
try {
  res = await fetch(`${base}/v1/validate`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key.value}`,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: controller.signal,
    redirect: 'error',
  });
  const text = await res.text();
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text.slice(0, 400);
  }
} catch (e) {
  transportError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
} finally {
  clearTimeout(timer);
}

const ms = Date.now() - started;

console.log('Solustation Address probe');
console.log('─'.repeat(52));
console.log(`base URL       ${base}`);
/*
  EVERY file that defines a key, not just the winner.

  `.env.local` overrides `.env`, so a repo can hold a live key and still
  be calling the test API without anything saying so — which is exactly
  what was happening when this script was first run. Listing all of them
  by prefix makes the shadowing visible; the prefix is the only part
  printed, so this stays safe to paste.
*/
const definitions = [];
for (const name of ['SOLUSTATION_ADDRESS_KEY', 'SOLADDR_API_KEY']) {
  for (const { rel, vars } of loaded) {
    const v = (vars[name] ?? '').trim();
    if (v !== '') definitions.push(`${rel}: ${name}=${v.slice(0, 8)}…`);
  }
}
if (definitions.length > 1) {
  console.log('keys defined   ' + definitions[0]);
  for (const d of definitions.slice(1)) console.log('               ' + d + '  (shadowed)');
}
console.log(`key from       ${key.name} in ${key.from}`);
console.log(
  `url from       ${url.value === '' ? 'built-in default' : `${url.name} in ${url.from}`}`,
);
// The ONLY part of the key this script will ever print.
console.log(`key prefix     ${key.value.slice(0, 8)}`);
console.log(`reference_id   ${referenceId}`);

if (transportError !== null) {
  console.log(`HTTP status    — (${transportError} after ${ms}ms)`);
  process.exit(2);
}

console.log(`HTTP status    ${res.status} ${res.statusText} (${ms}ms)`);
const reqId = res.headers.get('x-request-id');
if (reqId !== null) console.log(`X-Request-Id   ${reqId}`);

if (parsed !== null && typeof parsed === 'object') {
  const f = (k) => (parsed[k] === undefined ? '—' : JSON.stringify(parsed[k]));
  console.log('─'.repeat(52));
  console.log(`validation_id      ${f('validation_id')}`);
  console.log(`recommended_action ${f('recommended_action')}`);
  console.log(`validity_score     ${f('validity_score')}`);
  console.log(`status             ${f('status')}`);
  console.log(`verdict.level      ${JSON.stringify(parsed.verdict?.level ?? null)}`);
  console.log(`rto_risk_status    ${f('rto_risk_status')}`);
  console.log(`providers_used     ${f('providers_used')}`);
  console.log(`billable           ${f('billable')}`);
  console.log(`degraded           ${f('degraded')}`);
  const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
  const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
  console.log(`issues             ${issues.length}`);
  for (const i of issues) console.log(`  · ${i.code ?? '?'}: ${i.message ?? ''}`);
  console.log(`questions          ${questions.length}`);
  for (const q of questions) console.log(`  · ${typeof q === 'string' ? q : JSON.stringify(q)}`);
}

process.exit(res.ok ? 0 : 3);
