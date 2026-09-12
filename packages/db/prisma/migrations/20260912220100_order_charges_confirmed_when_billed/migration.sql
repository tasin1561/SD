-- An order charge that has been BILLED is CONFIRMED, not ESTIMATED.
--
-- Charges are written ESTIMATED when they are computed at order create.
-- The one charge written at the moment it is billed — the RTO fee, at
-- receive — is written CONFIRMED, which is the convention: CONFIRMED means
-- the wallet has been debited for it. The ORDER_CHARGES debit never moved
-- the lines it summed, so an order's delivery fee read "estimated" on the
-- order page long after the seller had paid it, beside a "confirmed" return
-- fee. `OrderChargesAccrualService.debitIfNeeded` now confirms the lines it
-- bills in the same transaction as the debit; this brings the rows billed
-- before that change into line.
--
-- Status only. No amount changes, and nothing reads the status to compute
-- money (the P&L, the accrual and the refund all read type and amount).
-- Exactly the rows the debit summed: live, not REFUND, not RTO_FEE (which
-- has its own direction and is already CONFIRMED), on an order that
-- carries an ORDER_CHARGES wallet entry. A charge added after the debit
-- was never billed and stays ESTIMATED — correctly.
UPDATE "order_charges" oc
   SET "status"     = 'confirmed',
       "updated_at" = now()
 WHERE oc."status" = 'estimated'
   AND oc."deleted_at" IS NULL
   AND oc."type" NOT IN ('refund', 'rto_fee')
   AND oc."created_at" <= (
         SELECT MIN(e."created_at")
           FROM "seller_wallet_entries" e
          WHERE e."linked_order_id" = oc."order_id"
            AND e."direction" = 'order_charges'
       );
