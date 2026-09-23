# First-load JS baseline — Phase 0 (2026-09-23)

Production `next build` of each app on `main` at 9fc408fa, before any restyle change. Figures are Next's own gzipped "First Load JS" per route. The Phase 6 budget is relative to these: no route may grow by more than 15 KB gz.

Every app shares a 102 kB runtime (React 19 + Next 15). Middleware is 34.3 kB (not first-load).

## apps/track

| Route | Page JS | First load |
|---|---|---|
| `/` | 1.54 kB | 118 kB |
| `/_not-found` | 991 B | 103 kB |
| `/[awb]` | 4.26 kB | 120 kB |
| `/apple-icon.png` | 0 B | 0 B |
| `/icon.png` | 0 B | 0 B |

## apps/reseller

| Route | Page JS | First load |
|---|---|---|
| `/` | 132 B | 103 kB |
| `/_not-found` | 995 B | 103 kB |
| `/account` | 2.28 kB | 133 kB |
| `/apple-icon.png` | 0 B | 0 B |
| `/auth/accept-invitation` | 2.26 kB | 147 kB |
| `/auth/reset-password` | 1.14 kB | 146 kB |
| `/auth/verify-email` | 994 B | 146 kB |
| `/catalogue` | 4.51 kB | 120 kB |
| `/customers` | 6.14 kB | 125 kB |
| `/customers/[id]` | 11.2 kB | 180 kB |
| `/dashboard` | 3.44 kB | 164 kB |
| `/expenses` | 4.5 kB | 137 kB |
| `/icon.png` | 0 B | 0 B |
| `/integrations` | 10.9 kB | 137 kB |
| `/login` | 981 B | 146 kB |
| `/notifications` | 5.18 kB | 127 kB |
| `/notifications/settings` | 6.32 kB | 128 kB |
| `/orders` | 8.61 kB | 166 kB |
| `/orders/[id]` | 8.92 kB | 188 kB |
| `/orders/call-reviews` | 2.33 kB | 179 kB |
| `/orders/import` | 5.78 kB | 163 kB |
| `/orders/new` | 8.7 kB | 127 kB |
| `/password-reset` | 3.08 kB | 120 kB |
| `/reports` | 4.27 kB | 168 kB |
| `/reports/analysis` | 3.09 kB | 128 kB |
| `/settings` | 3.93 kB | 135 kB |
| `/team` | 4.63 kB | 136 kB |
| `/terms` | 8.61 kB | 135 kB |
| `/tickets` | 3.07 kB | 165 kB |
| `/tickets/[id]` | 5.15 kB | 167 kB |
| `/tickets/new` | 4.11 kB | 161 kB |
| `/wallet` | 12.9 kB | 181 kB |

## apps/seller

| Route | Page JS | First load |
|---|---|---|
| `/` | 136 B | 102 kB |
| `/_not-found` | 997 B | 103 kB |
| `/apple-icon.png` | 0 B | 0 B |
| `/auth/accept-invitation` | 1.81 kB | 107 kB |
| `/auth/accept-team-invitation` | 1.6 kB | 106 kB |
| `/auth/reset-password` | 1.49 kB | 106 kB |
| `/auth/verify-email` | 2.67 kB | 105 kB |
| `/customers` | 11.3 kB | 185 kB |
| `/dashboard` | 6.36 kB | 176 kB |
| `/freight` | 6.98 kB | 170 kB |
| `/holds` | 7.65 kB | 184 kB |
| `/icon.png` | 0 B | 0 B |
| `/inbound` | 4.92 kB | 191 kB |
| `/inbound/[id]` | 9.29 kB | 195 kB |
| `/inventory` | 4.5 kB | 132 kB |
| `/inventory/units` | 8.11 kB | 171 kB |
| `/login` | 1.25 kB | 106 kB |
| `/needs-attention` | 2.82 kB | 169 kB |
| `/notifications` | 10.1 kB | 128 kB |
| `/notifications/settings` | 8.74 kB | 137 kB |
| `/orders` | 7.57 kB | 177 kB |
| `/orders/[id]` | 13.8 kB | 203 kB |
| `/orders/[id]/edit` | 8.25 kB | 162 kB |
| `/orders/import` | 276 B | 152 kB |
| `/orders/import/[id]` | 3.71 kB | 125 kB |
| `/orders/new` | 13.4 kB | 156 kB |
| `/orders/pending` | 6.55 kB | 131 kB |
| `/password-reset` | 2.8 kB | 105 kB |
| `/products` | 7.24 kB | 174 kB |
| `/products/[id]` | 9.11 kB | 176 kB |
| `/products/[id]/variants/[variantId]` | 10.1 kB | 188 kB |
| `/products/import` | 3.56 kB | 197 kB |
| `/products/import/jobs` | 4.52 kB | 167 kB |
| `/products/import/jobs/[id]` | 5.91 kB | 169 kB |
| `/products/new` | 12.6 kB | 160 kB |
| `/profile` | 8.16 kB | 175 kB |
| `/reseller-stores` | 8.26 kB | 182 kB |
| `/reseller-stores/[storeId]` | 16.5 kB | 197 kB |
| `/reseller-stores/price-list` | 7.94 kB | 144 kB |
| `/reseller-stores/reports` | 7.54 kB | 184 kB |
| `/reseller-stores/requests` | 9.05 kB | 183 kB |
| `/reseller-stores/stock-forecast` | 5.29 kB | 168 kB |
| `/settings` | 5.07 kB | 140 kB |
| `/settings/api-keys` | 7.76 kB | 171 kB |
| `/settings/notifications` | 136 B | 102 kB |
| `/settings/orders` | 5.29 kB | 156 kB |
| `/settings/security` | 6.42 kB | 133 kB |
| `/settings/stock` | 5.62 kB | 156 kB |
| `/settings/stores` | 8.22 kB | 182 kB |
| `/settings/webhooks` | 8.4 kB | 183 kB |
| `/team` | 4.7 kB | 187 kB |
| `/team/roles` | 5.31 kB | 142 kB |
| `/tickets` | 9.02 kB | 186 kB |
| `/tickets/[id]` | 8.79 kB | 171 kB |
| `/tracking` | 6.55 kB | 173 kB |
| `/wallet` | 15 kB | 192 kB |
| `/wallet/limits` | 9.79 kB | 132 kB |

## apps/admin

| Route | Page JS | First load |
|---|---|---|
| `/` | 136 B | 102 kB |
| `/_not-found` | 997 B | 103 kB |
| `/account` | 7.11 kB | 133 kB |
| `/apple-icon.png` | 0 B | 0 B |
| `/auth/accept-invitation` | 5.24 kB | 118 kB |
| `/auth/forgot-password` | 8.99 kB | 147 kB |
| `/auth/reset-password` | 9.32 kB | 147 kB |
| `/auth/verify-email` | 8.78 kB | 146 kB |
| `/bank-accounts` | 8.81 kB | 180 kB |
| `/bank-accounts/history` | 4.11 kB | 164 kB |
| `/bank-changes` | 8.81 kB | 185 kB |
| `/call-center` | 13 kB | 207 kB |
| `/call-center/agents` | 6.05 kB | 177 kB |
| `/call-center/queue` | 9.5 kB | 184 kB |
| `/cost-sync` | 10.3 kB | 175 kB |
| `/courier-accounts` | 8.99 kB | 185 kB |
| `/courier-decisions` | 5.26 kB | 169 kB |
| `/courier-escalation` | 6.54 kB | 176 kB |
| `/courier-escalation/portal` | 7.91 kB | 173 kB |
| `/courier-escalation/templates` | 7.53 kB | 173 kB |
| `/courier-escalation/threads` | 8.54 kB | 174 kB |
| `/courier-wallet` | 9.77 kB | 183 kB |
| `/dashboard` | 8.82 kB | 137 kB |
| `/delhivery` | 9.09 kB | 191 kB |
| `/delivery-actions` | 6.29 kB | 183 kB |
| `/expenses` | 7.58 kB | 189 kB |
| `/expenses/categories` | 1.87 kB | 183 kB |
| `/freight` | 13.2 kB | 197 kB |
| `/fx` | 8.22 kB | 138 kB |
| `/holds` | 6.11 kB | 172 kB |
| `/icon.png` | 0 B | 0 B |
| `/inventory` | 136 B | 102 kB |
| `/inventory-units` | 7.95 kB | 174 kB |
| `/inventory/adjustments` | 8.54 kB | 179 kB |
| `/inventory/cycle-counts` | 7.12 kB | 183 kB |
| `/inventory/movements` | 3.69 kB | 130 kB |
| `/inventory/transfers` | 3.79 kB | 127 kB |
| `/leads` | 9.92 kB | 181 kB |
| `/liabilities` | 6.21 kB | 172 kB |
| `/liabilities/instant-pay` | 7.32 kB | 131 kB |
| `/login` | 3.59 kB | 106 kB |
| `/manual-placement` | 6.62 kB | 185 kB |
| `/margin` | 7.04 kB | 173 kB |
| `/notifications` | 5.47 kB | 124 kB |
| `/notifications/broadcasts` | 6.17 kB | 162 kB |
| `/notifications/settings` | 4.94 kB | 123 kB |
| `/nsa` | 9.8 kB | 145 kB |
| `/orders` | 5 kB | 169 kB |
| `/orders/[id]` | 20.1 kB | 212 kB |
| `/pnl` | 6.45 kB | 133 kB |
| `/pnl/carry-forward` | 12.2 kB | 150 kB |
| `/pricing` | 11.3 kB | 143 kB |
| `/reattempt-requests` | 3.18 kB | 177 kB |
| `/remittances` | 13.8 kB | 153 kB |
| `/reports` | 5.58 kB | 125 kB |
| `/reseller-store-wallets` | 9.99 kB | 194 kB |
| `/reseller-stores` | 8.11 kB | 183 kB |
| `/reseller-stores/[storeId]` | 6.01 kB | 184 kB |
| `/reseller-stores/analysis` | 2.24 kB | 180 kB |
| `/roles` | 4.18 kB | 136 kB |
| `/seller-wallets` | 5.79 kB | 174 kB |
| `/seller-wallets/[id]` | 5.68 kB | 186 kB |
| `/sellers` | 3.6 kB | 185 kB |
| `/sellers/[id]` | 11.5 kB | 200 kB |
| `/settings` | 5.58 kB | 177 kB |
| `/settlements` | 11.1 kB | 149 kB |
| `/shiprocket` | 3.36 kB | 174 kB |
| `/staff` | 3.46 kB | 140 kB |
| `/stores` | 7 kB | 184 kB |
| `/system-issues` | 8.11 kB | 143 kB |
| `/system/capacity` | 5.39 kB | 124 kB |
| `/tickets` | 7.18 kB | 173 kB |
| `/tickets/[id]` | 9.59 kB | 186 kB |
| `/topups` | 8.29 kB | 143 kB |
| `/treasury` | 10.6 kB | 194 kB |
| `/wallet-transfers` | 10.4 kB | 136 kB |
| `/warehouse` | 6.59 kB | 137 kB |
| `/warehouse/bins` | 11.2 kB | 152 kB |
| `/warehouse/bins/[binId]` | 1.74 kB | 128 kB |
| `/warehouse/consignments` | 6.19 kB | 191 kB |
| `/warehouse/consignments/[id]` | 9.7 kB | 188 kB |
| `/warehouse/handover` | 6.95 kB | 184 kB |
| `/warehouse/manifests` | 7.43 kB | 155 kB |
| `/warehouse/manifests/[id]` | 8.54 kB | 180 kB |
| `/warehouse/pack` | 12.2 kB | 165 kB |
| `/warehouse/pick` | 10.4 kB | 158 kB |
| `/warehouse/pickups` | 9.13 kB | 182 kB |
| `/warehouse/printing` | 10.8 kB | 195 kB |
| `/warehouse/receive` | 7.7 kB | 155 kB |
| `/warehouse/receive/[id]` | 7.52 kB | 144 kB |
| `/warehouse/rto` | 13.3 kB | 202 kB |
| `/webhooks` | 6.96 kB | 129 kB |
| `/withdrawals` | 9.71 kB | 186 kB |
