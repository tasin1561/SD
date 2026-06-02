# @skydrop/marketing

Public marketing site for Skydrop — `skydrop.online`.

- Static landing page (no auth, no API calls).
- Pitched at Bangladeshi e-commerce sellers exploring the BD → IN lane.
- Invite-only positioning — primary CTA is a `mailto:hello@skydrop.online`.
- Inherits the dark theme + design tokens from `@skydrop/ui`; styled with Tailwind v4.

## Scripts

| Command          | What                                  |
| ---------------- | ------------------------------------- |
| `pnpm dev`       | Dev server on port 3005               |
| `pnpm build`     | Production build (Next.js)            |
| `pnpm start`     | Run production build on port 3005     |
| `pnpm typecheck` | `tsc --noEmit`                        |
| `pnpm lint`      | Next.js / TypeScript lint             |

## Deploy

Restarted by `scripts/deploy.sh` as `skydrop-marketing` via pm2 (port
3005). Cloudflare DNS points `skydrop.online` → droplet; nginx
terminates TLS and proxies to 127.0.0.1:3005.
