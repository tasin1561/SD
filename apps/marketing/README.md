# @skydrop/marketing

Public marketing site for Skydrop — `skydrop.online`.

- Static landing page (no auth, no API calls).
- Pitched at Bangladeshi e-commerce sellers exploring the BD → IN lane.
- Invite-only positioning — primary CTA is a `mailto:hello@skydrop.online`.
- Inherits the dark theme + design tokens from `@skydrop/ui`; styled with Tailwind v4.

## Scripts

| Command          | What                              |
| ---------------- | --------------------------------- |
| `pnpm dev`       | Dev server on port 3006           |
| `pnpm build`     | Production build (Next.js)        |
| `pnpm start`     | Run production build on port 3006 |
| `pnpm typecheck` | `tsc --noEmit`                    |
| `pnpm lint`      | Next.js / TypeScript lint         |

## Deploy

A static export (`output: 'export'`). `scripts/deploy.sh` builds it and
rsyncs `out/` to `/var/www/skydrop-marketing`, which Caddy file-serves for
`skydrop.online` — there is no pm2 process and no port in production.
Locally it serves on port 3006 (3005 belongs to the reseller portal,
RS-12).
