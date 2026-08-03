/**
 * pm2 process definitions for the droplet.
 *
 * ── WHY THIS IS IN THE REPO (2026-07-28) ─────────────────────────────
 * It wasn't, until now. It lived only at ~/app/ecosystem.config.cjs on
 * the server, untracked — so it was unreviewable, unbackupable, and a
 * rebuild of the droplet would have had to reconstruct it from memory.
 * It also meant a bug in it could sit there indefinitely, which is
 * exactly what happened: a `skydrop-marketing` entry kept running
 * `next start` against a static-export build, which exits immediately,
 * so pm2 respawned it about nineteen times a minute for weeks. Nobody
 * noticed because the marketing site was never broken — Caddy serves it
 * from disk and nothing ever talked to that port.
 *
 * ── WHAT READS IT ────────────────────────────────────────────────────
 * Only `pm2 start|reload ecosystem.config.cjs`, run by hand. The deploy
 * path (`scripts/deploy.sh`) restarts named processes and does not read
 * this file, and a reboot resurrects from `~/.pm2/dump.pm2`. So editing
 * it changes nothing until someone runs pm2 against it — and after
 * doing so, run `pm2 save` or the change is lost at the next reboot.
 *
 * ── SECRETS ──────────────────────────────────────────────────────────
 * None here, deliberately. Values are read from ~/app/.env (mode 0600)
 * at pm2-start time, which is why this file is safe to track.
 */
const fs = require('node:fs');
const path = require('node:path');

// The repo root — this file sits at the top of the checkout. Derived
// rather than hardcoded to /home/skydrop/app so the config is correct
// wherever the repo lives, and so a second environment does not need a
// forked copy.
const ROOT = __dirname;

const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const shared = { NODE_ENV: 'production' };
for (const line of envText.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
  const eq = trimmed.indexOf('=');
  const k = trimmed.slice(0, eq).trim();
  const v = trimmed.slice(eq + 1).trim();
  shared[k] = v;
}

// Next.js frontends use pnpm's shell-script wrapper at node_modules/.bin/next,
// so pm2 needs `interpreter: 'none'` — otherwise it tries to eval the wrapper
// as JS and hits `SyntaxError: missing ) after argument list`.
const nextApp = (name, port) => ({
  name,
  cwd: path.join(ROOT, 'apps', name.replace('skydrop-', '')),
  script: './node_modules/.bin/next',
  // -H 127.0.0.1: loopback only. Caddy reverse-proxies to these from this
  // host; binding 0.0.0.0 also put them on the droplet's DigitalOcean VPC
  // address, leaving one ufw rule as the only thing in front of them.
  args: `start -p ${port} -H 127.0.0.1`,
  interpreter: 'none',
  instances: 1,
  exec_mode: 'fork',
  max_memory_restart: '512M',
  env: { ...shared, PORT: port, API_ORIGIN: 'http://127.0.0.1:4000' },
});

module.exports = {
  apps: [
    {
      name: 'skydrop-api',
      cwd: path.join(ROOT, 'apps', 'api'),
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      // BIND_HOST defaults to 127.0.0.1 in the env schema; same reasoning
      // as the -H flag above.
      env: { ...shared, PORT: 4000 },
    },
    nextApp('skydrop-admin', 3002),
    nextApp('skydrop-seller', 3003),
    nextApp('skydrop-track', 3004),
    // NO marketing process, and do not add one back. apps/marketing is
    // `output: 'export'`; `next start` refuses to run that build and
    // exits, so an entry here does nothing but respawn forever. Caddy
    // file-serves the export from /var/www/skydrop-marketing (published
    // by scripts/deploy.sh) and nothing proxies to port 3005.
  ],
};
