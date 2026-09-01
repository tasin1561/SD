/**
 * Delhivery's own "Raise a ticket" taxonomy, as it appears in their
 * portal (captured 2026-09-01).
 *
 * WHY THIS IS HAND-WRITTEN rather than fetched: the fetcher that would
 * read this from Delhivery goes through their MCP, which is not
 * provisioned. Without the tree the seller's ticket form has no
 * categories to offer and every ticket arrives as untyped free text —
 * which is exactly what an ops queue cannot triage. So it is recorded
 * from the portal by eye, and the fetcher will overwrite it verbatim
 * the day it works: `externalId` is the match key, and re-seeding is an
 * upsert.
 *
 * `externalId` is OURS until then, and deliberately readable rather
 * than a number we invented — when the real ids arrive, a mismatch is
 * a visible relabel rather than a silent one.
 *
 * NOT every category has subcategories. Self-collect, cancel, and a
 * behaviour complaint go straight to the description in their portal,
 * and forcing an invented sub-choice would be asking the seller a
 * question the courier never asks.
 */
export interface SeedIssueCategory {
  readonly externalId: string;
  readonly label: string;
  readonly parentExternalId?: string;
  /** Never actionable unattended — money, or a person's conduct. */
  readonly isHumanOnly?: boolean;
}

export const DELHIVERY_ISSUE_TAXONOMY: readonly SeedIssueCategory[] = [
  // ── 1. Reattempt / delay ───────────────────────────────────────────
  {
    externalId: 'reattempt-delay',
    label: 'Reattempt or Delay in delivery / consignee pickup / return',
  },
  {
    externalId: 'reattempt-delay.delivery',
    label: 'Reattempt or Delay in delivery / consignee pickup',
    parentExternalId: 'reattempt-delay',
  },
  {
    externalId: 'reattempt-delay.dto-rto',
    label: 'Delay in delivery to seller/merchant (DTO/RTO)',
    parentExternalId: 'reattempt-delay',
  },
  {
    externalId: 'reattempt-delay.urgent',
    label: 'Urgent connection required',
    parentExternalId: 'reattempt-delay',
  },

  // ── 2. Not delivered / fake remark ─────────────────────────────────
  { externalId: 'not-delivered', label: 'Shipment not delivered (need POD) / Fake remark' },
  {
    externalId: 'not-delivered.need-pod',
    label: 'Shipment marked delivered incorrectly / Need POD',
    parentExternalId: 'not-delivered',
  },
  {
    externalId: 'not-delivered.pickup-not-updated',
    label: 'Consignee pickup done but status not updated',
    parentExternalId: 'not-delivered',
  },
  {
    externalId: 'not-delivered.fake-remark',
    label: 'Delivery or consignee pickup failed due to incorrect / fake remark',
    parentExternalId: 'not-delivered',
  },

  // ── 3. Self collect / drop — no subcategories in their portal ──────
  { externalId: 'self-collect', label: 'Self collect / drop' },

  // ── 4. Damage / missing / mismatch ─────────────────────────────────
  { externalId: 'damage-missing', label: 'Damage / Missing / Mismatch' },
  {
    externalId: 'damage-missing.damage',
    label: 'Damage in delivered/returned shipment',
    parentExternalId: 'damage-missing',
  },
  {
    externalId: 'damage-missing.missing',
    label: 'Missing shipment delivered/returned',
    parentExternalId: 'damage-missing',
  },
  {
    externalId: 'damage-missing.mismatch',
    label: 'Mismatch in delivered/returned shipment',
    parentExternalId: 'damage-missing',
  },

  // ── 5. Update shipment details ─────────────────────────────────────
  { externalId: 'update-details', label: 'Update shipment details' },
  {
    externalId: 'update-details.payment',
    label: 'Update payment mode / COD amount',
    parentExternalId: 'update-details',
  },
  {
    externalId: 'update-details.consignee',
    label: 'Update consignee address or phone number',
    parentExternalId: 'update-details',
  },
  {
    externalId: 'update-details.other',
    label: 'Update other shipment details (E-waybill number, Pickup quantity, MOT)',
    parentExternalId: 'update-details',
  },

  // ── 6. Cancel — no subcategories ───────────────────────────────────
  { externalId: 'cancel', label: 'Cancel delivery / pickup' },

  // ── 7. Claims / finance. Money: never unattended ───────────────────
  {
    externalId: 'claims-finance',
    label: 'Claims / Finance (disputes, remittance, bank details, etc.)',
    isHumanOnly: true,
  },
  {
    externalId: 'claims-finance.claim',
    label: 'Raise claim for damage/missing shipment',
    parentExternalId: 'claims-finance',
    isHumanOnly: true,
  },
  {
    externalId: 'claims-finance.weight-zone',
    label: 'Weight or zone dispute',
    parentExternalId: 'claims-finance',
    isHumanOnly: true,
  },
  {
    externalId: 'claims-finance.rate',
    label: 'Rate dispute',
    parentExternalId: 'claims-finance',
    isHumanOnly: true,
  },
  {
    externalId: 'claims-finance.invoice',
    label: 'Download invoice / credit or debit notes',
    parentExternalId: 'claims-finance',
    isHumanOnly: true,
  },
  {
    externalId: 'claims-finance.cod-remittance',
    label: 'COD remittance',
    parentExternalId: 'claims-finance',
    isHumanOnly: true,
  },
  {
    externalId: 'claims-finance.bank-details',
    label: 'Update bank account details',
    parentExternalId: 'claims-finance',
    isHumanOnly: true,
  },
  {
    externalId: 'claims-finance.other',
    label: 'Other claim/finance related queries',
    parentExternalId: 'claims-finance',
    isHumanOnly: true,
  },

  // ── 8. Protect VAS ─────────────────────────────────────────────────
  { externalId: 'protect-vas', label: 'Protect VAS' },
  {
    externalId: 'protect-vas.fees',
    label: 'Protect fees dispute',
    parentExternalId: 'protect-vas',
    isHumanOnly: true,
  },
  { externalId: 'protect-vas.other', label: 'Others', parentExternalId: 'protect-vas' },

  // ── 9. Behaviour complaint — a person's conduct, never unattended ──
  {
    externalId: 'behaviour-complaint',
    label: 'Behaviour complaint against staff',
    isHumanOnly: true,
  },
];
