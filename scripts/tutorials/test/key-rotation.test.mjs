/**
 * Key rotation, proven against a stub rather than against the accounts.
 *
 *   node --test scripts/tutorials/test/
 *
 * The whole point of this file is that it costs NOTHING. Rotation only
 * happens when an account runs out, which is the one condition you
 * cannot arrange on purpose without spending the account — so the
 * behaviour that matters most is the behaviour least likely to be
 * exercised before it is needed. An injected `fetch` makes exhaustion a
 * thing the test decides, so "it rotates" stops being a hope.
 *
 * It also pins the two ways rotation goes wrong, both of which are
 * silent: rotating on a failure that was NOT exhaustion (which spends
 * the next account on a bad request), and retrying a spent key forever
 * (which never finishes and never says why).
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  KeyRing,
  QuotaExhaustedError,
  classifyFailure,
  parseKeyList,
} from '../lib/elevenlabs-keys.mjs';
import { assertSameVoice, synthesise } from '../generate-voice.mjs';

/** The shapes ElevenLabs actually answers with. */
const QUOTA_401 = JSON.stringify({
  detail: {
    type: 'authentication_error',
    code: 'unauthorized',
    message: 'You have exceeded your quota.',
    status: 'quota_exceeded',
  },
});
// Observed LIVE on this project's own key, which is scoped to
// text-to-speech only. The docs call this a 403 `insufficient_
// permissions`; the API returns a 401. The live shape is what is pinned.
const PERMISSIONS_401 = JSON.stringify({
  detail: {
    type: 'authentication_error',
    code: 'unauthorized',
    message: 'The API key you used is missing the permission user_read to execute this operation.',
    status: 'missing_permissions',
  },
});
const RATE_429 = JSON.stringify({
  detail: { type: 'rate_limit_error', code: 'rate_limit_exceeded', message: 'Too many requests' },
});

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]);
const ok = () => ({ ok: true, status: 200, arrayBuffer: async () => MP3.buffer });
const fail = (status, body) => ({ ok: false, status, text: async () => body });

let tmp;
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'skydrop-voice-'));
});
after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});
const outFile = () => path.join(tmp, `${Math.random().toString(36).slice(2)}.mp3`);
const noSleep = async () => {};

describe('classifyFailure', () => {
  it('reads a spent account off the marker, not the status code', () => {
    assert.equal(classifyFailure(401, QUOTA_401), 'EXHAUSTED');
    // Their rate-limit code carrying a quota marker is still exhaustion.
    // Retrying this on the same key is an infinite loop.
    assert.equal(classifyFailure(429, QUOTA_401), 'EXHAUSTED');
    assert.equal(classifyFailure(402, '{}'), 'EXHAUSTED');
  });

  it('does NOT read a scope problem as a spent account', () => {
    // The expensive mistake: both are 401. Rotating here would retire a
    // perfectly funded key and then report "out of quota" about a key
    // that was only missing a permission.
    assert.equal(classifyFailure(401, PERMISSIONS_401), 'FATAL');
  });

  it('retries their side, and stops on ours', () => {
    assert.equal(classifyFailure(429, RATE_429), 'TRANSIENT');
    assert.equal(classifyFailure(503, ''), 'TRANSIENT');
    assert.equal(classifyFailure(500, 'not json at all'), 'TRANSIENT');
    assert.equal(classifyFailure(400, '{"detail":"text is required"}'), 'FATAL');
    assert.equal(classifyFailure(404, ''), 'FATAL');
  });
});

describe('the ring', () => {
  it('names keys by position and never by value', () => {
    const ring = new KeyRing(['sk_aaaaaaaaaaaa', 'sk_bbbbbbbbbbbb']);
    assert.equal(ring.position, 1);
    assert.ok(ring.rotate());
    assert.equal(ring.position, 2);
    assert.equal(ring.rotate(), false, 'a two-key ring has nowhere to go from key 2');
    assert.deepEqual(ring.spentPositions, [1, 2]);
  });

  it('redacts a key that reached a message', () => {
    const ring = new KeyRing(['sk_secret_one_aaa', 'sk_secret_two_bbb']);
    const scrubbed = ring.redact('boom: sk_secret_two_bbb failed');
    assert.ok(!scrubbed.includes('sk_secret_two_bbb'));
    assert.match(scrubbed, /key 2 redacted/);
  });

  it('skips blanks and comments in the key file', () => {
    assert.deepEqual(parseKeyList('# main account\nsk_one\n\n  sk_two  \n# spare\n'), [
      'sk_one',
      'sk_two',
    ]);
  });
});

describe('synthesise', () => {
  it('rotates on exhaustion and retries THE SAME clip', async () => {
    const ring = new KeyRing(['k1', 'k2']);
    const seen = [];
    const fetchImpl = async (_url, init) => {
      seen.push({ key: init.headers['xi-api-key'], text: JSON.parse(init.body).text });
      return init.headers['xi-api-key'] === 'k1' ? fail(401, QUOTA_401) : ok();
    };

    const res = await synthesise(ring, 'the line', outFile(), { fetchImpl, sleep: noSleep });

    assert.equal(res.keyPosition, 2);
    assert.deepEqual(
      seen.map((s) => s.key),
      ['k1', 'k2'],
    );
    // The clip that failed is the clip that was retried. Moving on to
    // the next line instead would leave a hole in the middle of a video
    // at the exact moment the run looked like it had recovered.
    assert.deepEqual(new Set(seen.map((s) => s.text)), new Set(['the line']));
  });

  it('stops cleanly when every key is spent', async () => {
    const ring = new KeyRing(['k1', 'k2', 'k3']);
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return fail(401, QUOTA_401);
    };

    await assert.rejects(
      () => synthesise(ring, 'x', outFile(), { fetchImpl, sleep: noSleep }),
      QuotaExhaustedError,
    );
    assert.equal(calls, 3, 'each key is tried exactly once, then it gives up');
  });

  it('does not burn a second key on a failure it does not recognise', async () => {
    const ring = new KeyRing(['k1', 'k2']);
    const used = new Set();
    const fetchImpl = async (_u, init) => {
      used.add(init.headers['xi-api-key']);
      return fail(401, PERMISSIONS_401);
    };

    await assert.rejects(() => synthesise(ring, 'x', outFile(), { fetchImpl, sleep: noSleep }));
    assert.deepEqual([...used], ['k1'], 'key 2 is untouched');
    assert.equal(ring.position, 1);
  });

  it('retries a rate limit on the same key, then succeeds', async () => {
    const ring = new KeyRing(['k1', 'k2']);
    let n = 0;
    const fetchImpl = async () => {
      n += 1;
      return n < 3 ? fail(429, RATE_429) : ok();
    };

    const res = await synthesise(ring, 'x', outFile(), { fetchImpl, sleep: noSleep });
    assert.equal(res.keyPosition, 1, 'a wobble must not move the run onto another account');
    assert.equal(n, 3);
  });

  it('gives up on a key that only ever rate-limits', async () => {
    const ring = new KeyRing(['k1']);
    const fetchImpl = async () => fail(429, RATE_429);
    await assert.rejects(
      () => synthesise(ring, 'x', outFile(), { fetchImpl, sleep: noSleep }),
      /kept failing on key 1/,
    );
  });

  it('writes the bytes it was given', async () => {
    const ring = new KeyRing(['k1']);
    const file = outFile();
    await synthesise(ring, 'x', file, { fetchImpl: async () => ok(), sleep: noSleep });
    assert.deepEqual(new Uint8Array(await fs.readFile(file)), MP3);
  });

  it('never puts a key in the error it throws', async () => {
    const ring = new KeyRing(['sk_live_do_not_log_me']);
    const fetchImpl = async () => fail(418, 'the key sk_live_do_not_log_me is odd');
    await assert.rejects(
      () => synthesise(ring, 'x', outFile(), { fetchImpl, sleep: noSleep }),
      (e) => !e.message.includes('sk_live_do_not_log_me') && /redacted/.test(e.message),
    );
  });
});

describe('the voice is the same person on every account', () => {
  const voice = (name, category) => ({
    ok: true,
    status: 200,
    json: async () => ({ name, category, settings: null }),
  });

  it('refuses to film when the accounts disagree', async () => {
    const ring = new KeyRing(['k1', 'k2']);
    const fetchImpl = async (_u, init) =>
      init.headers['xi-api-key'] === 'k1' ? voice('Sarah', 'premade') : voice('Sarah', 'cloned'); // somebody cloned over the id

    await assert.rejects(
      () => assertSameVoice(ring, { fetchImpl, log: () => {} }),
      /NOT the same on every account/,
    );
  });

  it('refuses when it cannot tell — with two keys, unknown is not fine', async () => {
    const ring = new KeyRing(['k1', 'k2']);
    const fetchImpl = async (_u, init) =>
      init.headers['xi-api-key'] === 'k1' ? voice('Sarah', 'premade') : fail(401, PERMISSIONS_401);

    await assert.rejects(
      () => assertSameVoice(ring, { fetchImpl, log: () => {} }),
      /Cannot confirm the voice is the same/,
    );
  });

  it('passes a single key without asking anything of it', async () => {
    // One account cannot disagree with itself. Blocking production on a
    // missing scope here would be the tail wagging the dog.
    const ring = new KeyRing(['k1']);
    const fetchImpl = async () => fail(401, PERMISSIONS_401);
    const res = await assertSameVoice(ring, { fetchImpl, log: () => {} });
    assert.equal(res.agreed, true);
    assert.equal(res.compared, false);
  });

  it('agrees when both accounts see the same voice', async () => {
    const ring = new KeyRing(['k1', 'k2']);
    const res = await assertSameVoice(ring, {
      fetchImpl: async () => voice('Sarah', 'premade'),
      log: () => {},
    });
    assert.equal(res.compared, true);
  });
});
