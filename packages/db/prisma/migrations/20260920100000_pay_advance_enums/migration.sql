-- PAY_ADVANCE inbound freight: the enum values, on their own.
--
-- THREE VALUES, IN THEIR OWN MIGRATION FILE, ON PURPOSE. Prisma runs each
-- migration in one transaction, and Postgres refuses to USE a new enum
-- value in the same transaction that added it ("unsafe use of new value
-- of enum type"). The next migration writes a partial unique index whose
-- predicate is `mode = 'pay_advance'`, so the value has to be committed
-- before that statement can reference it. Splitting the file is the whole
-- fix, and is why these three lines are not in the migration that uses
-- them.

-- AlterEnum
--
-- Billed at the BANGLADESH INTAKE, before the goods fly: the rate is
-- agreed by phone (per kg or per piece), Dhaka counts and weighs, and we
-- raise the final bill against THAT count with the wallet debited there
-- and then. What the forwarder later charges us is a separate fact; the
-- gap between the two is our margin on the leg, not a correction to be
-- reconciled with the seller.
ALTER TYPE "inbound_freight_mode" ADD VALUE 'pay_advance';

-- AlterEnum
--
-- The bill was WRONG (a mistyped rate, a recount) and has been withdrawn
-- so a fresh one can be raised. Deliberately distinct from 'waived',
-- which means correct-and-forgiven and stays countable as money we chose
-- not to collect; a void says this bill should never have existed.
ALTER TYPE "inbound_freight_status" ADD VALUE 'voided';

-- AlterEnum
--
-- The compensating CREDIT a void writes, returning exactly what the
-- voided bill had charged. The wallet ledger is append-only, so giving
-- money back is a new entry and never a deletion.
ALTER TYPE "wallet_entry_direction" ADD VALUE 'inbound_freight_refund';
