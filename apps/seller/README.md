# @skydrop/seller

Seller portal — `app.skydrop.online`. Next.js 15 + Tailwind v4 + TanStack Query 5.

The second consumer of the shared frontend foundation (`@skydrop/api-client`,
`@skydrop/auth`, `@skydrop/ui`) — its presence is what forced the M12
component extraction. Same SSR-auth model as apps/admin (FE-3 same-origin
proxy + FE-4 cookie→/me) with `IdentityKind = 'seller'`.

Dev: `pnpm --filter @skydrop/seller dev` (port 3003).
