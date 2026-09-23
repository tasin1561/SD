# Admin restyle — area AD "Money 1" (sellers' money): motion coverage

Shared pieces: `seller-wallets/_components/money-kit.css` (prefix `mk-`, tokens only,
every grid `minmax(0, …)`) and `money-parts.tsx` (MkCard, MkSection, MkCallout, MkAlert,
MkDl, WithdrawalChip, TopupChip, FreightChip). Every figure is still the original
`<Money>` / `<Num>` with its original props.

| Pattern | Where used | n/a (why) |
|---|---|---|
| Rolling-label AsyncButton | top-up credit/reject; bank change approve/reject; withdrawal resolve; move-seller-cash; allocate / record payout; wallet transfer Preview; freight record, waive, void, cost only, pay forwarder; store top-up credit/reject, store withdrawal approve/reject/pay | Remittance and FX override submit through a native `<form>` (the button stays a submit `Button` with `loading`, so Enter-to-submit and native validation are unchanged) |
| Liquid-bead Tabs | seller wallets filter (All / In credit / In debt / Pending payout, with counts); seller wallet detail (Ledger / Top-ups / Withdrawal requests — replaced the `aria-current` buttons) | — |
| Skeletons | every list and the wallet KPI rows | — |
| EmptyState (u27) | every empty list; `positive` tone for empty queues (top-ups pending, withdrawals pending, bank changes, nothing overdue, store queues) | — |
| Toasts (app `useToast`) | withdrawals, resolve, remittances, settlements, bank changes, freight, FX, seller wallets | top-ups, reseller store wallets keep the legacy `useToast` (their tests mount only the legacy Toaster) |
| KpiCard | seller wallets (4 money tiles, `<Money>` as figure, taka as secondary, footer word), wallet detail (4), withdrawals (3), settlements (3), freight (3) | No count-up anywhere: these are money screens and queues, not dashboards |
| ConfirmDialog | re-check ledgers; approve withdrawal; record remittance; post wallet transfer; settle freight bill | — |
| ParachuteProgress | re-check ledgers (while running); reading a courier remittance file | — |
| Timeline / Stepper | — | No event history or multi-step flow in this area (FX "Timeline" is a rate table) |
| SegmentedCode / PaperPlane | — | No six-digit code; no ticket reply |
| Pagination (u16) | withdrawals | Other lists are unpaginated today |
